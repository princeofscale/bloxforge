// Trajectory + token metrics for the MCP eval harness. Pure functions over a
// recorded run trace — no model/network here, so they're deterministic and
// unit-checkable (see selfcheck.ts). The harness (harness.ts) produces traces;
// these turn them into the numbers the research review asked for: bootstrap tax,
// tool-selection precision/recall, unnecessary calls, success-per-1k-tokens.

export interface TraceEvent {
  t: number;
  type: 'model' | 'tool_call' | 'tool_result' | 'error';
  name?: string;
  args?: unknown;
  resultSummary?: unknown;
  tokensIn?: number; // total input tokens for this model turn (incl. cache read+write)
  cacheReadIn?: number; // of tokensIn, how many were served from prompt cache
  cacheWriteIn?: number; // of tokensIn, how many were written to prompt cache
  tokensOut?: number;
  isError?: boolean;
}

export interface RunMetrics {
  initInputTokens: number; // cost up to the first useful world read
  cumulativeInputTokens: number;
  cumulativeOutputTokens: number;
  toolSchemaTokensSeen: number;
  toolCalls: number;
  distinctToolsCalled: number;
  unnecessaryToolCalls: number;
  invalidToolCalls: number;
  retriesAfterRecoverableError: number;
  wallClockMs: number;
  success: boolean;
}

export interface TrajectoryScores {
  toolSelectionPrecision: number; // share of calls that were expected/allowed
  toolSelectionRecall: number; // share of gold tools that were actually called
  unnecessaryCallsPerRun: number;
  invalidCallRate: number;
}

// Discovery/meta tools are not "real work" — in lazy mode the agent calls these
// to find + load the toolset before doing anything useful, so they belong to the
// bootstrap window, not after it.
const bootstrapMetaTools = new Set(['tool_catalog_search', 'load_toolset']);

/**
 * Tokens spent before the first *real* (non-discovery) tool call — the cost lazy
 * loading trades against extra discovery round-trips. The boundary is the first
 * tool call that isn't a meta tool (`tool_catalog_search` / `load_toolset`), so
 * the meta turns count toward bootstrap but the first actual action ends it.
 *
 * This stays well-defined even for tasks that never do a "world read" (marketplace
 * inserts, grep-only scene search) — the previous world-read-only boundary mis-summed
 * those as the *entire* run, which dominated and corrupted the mean.
 */
export function bootstrapTax(trace: TraceEvent[]): number {
  let tokens = 0;
  for (const e of trace) {
    if (e.type === 'model') tokens += e.tokensIn ?? 0;
    if (e.type === 'tool_call' && e.name && !bootstrapMetaTools.has(e.name)) break;
  }
  return tokens;
}

// Anthropic prompt-cache pricing multipliers vs base input (claude.com/pricing):
// a cache *read* costs 0.1× base input, a 5-minute cache *write* 1.25×. Providers
// without caching (e.g. deepseek-v4-flash) report zero cache tokens, so a warm-cache
// model's *effective paid* input is far below its raw token count — and the raw-token
// bootstrap tax over/under-states the real discovery cost for a caching client. These
// metrics correct for that so an A/B isn't biased by whether the model caches.
// ponytail: 5-minute write multiplier only; add the 1h tier (2×) if a case ever uses it.
const CACHE_READ_MULT = 0.1;
const CACHE_WRITE_MULT = 1.25;

function effectivePaidForEvent(e: TraceEvent): number {
  const total = e.tokensIn ?? 0;
  const read = e.cacheReadIn ?? 0;
  const write = e.cacheWriteIn ?? 0;
  const base = Math.max(0, total - read - write);
  return base + write * CACHE_WRITE_MULT + read * CACHE_READ_MULT;
}

/** Cache-weighted input cost across the whole run — what a caching client actually
 *  pays. Equals raw cumulative input for a non-caching provider. */
export function effectivePaidInput(trace: TraceEvent[]): number {
  let tokens = 0;
  for (const e of trace) if (e.type === 'model') tokens += effectivePaidForEvent(e);
  return tokens;
}

/** Bootstrap tax measured in *effective paid* tokens — the recurring discovery cost a
 *  warm-cache client sees per task once the tool prefix is cached. Same boundary as
 *  bootstrapTax (first real, non-meta tool call). */
export function warmBootstrapTax(trace: TraceEvent[]): number {
  let tokens = 0;
  for (const e of trace) {
    if (e.type === 'model') tokens += effectivePaidForEvent(e);
    if (e.type === 'tool_call' && e.name && !bootstrapMetaTools.has(e.name)) break;
  }
  return tokens;
}

/** Raw input tokens spent before the first *valid* (non-meta, non-error) real tool
 *  call — i.e. how long until the agent does something useful that actually works.
 *  Differs from bootstrapTax, which stops at the first real call even if it errors. */
export function firstValidActionTokens(trace: TraceEvent[]): number {
  let tokens = 0;
  for (const e of trace) {
    if (e.type === 'model') tokens += e.tokensIn ?? 0;
    if (e.type === 'tool_call' && e.name && !bootstrapMetaTools.has(e.name) && !e.isError) break;
  }
  return tokens;
}

/** Raw input tokens spent *after* the first errored tool call — the cost of recovery
 *  (or thrashing). A high value flags brittle error handling / weak-model flailing. */
export function recoveryCostAfterFirstError(trace: TraceEvent[]): number {
  let seenError = false;
  let tokens = 0;
  for (const e of trace) {
    if (e.type === 'tool_call' && e.isError) seenError = true;
    if (seenError && e.type === 'model') tokens += e.tokensIn ?? 0;
  }
  return tokens;
}

/** Successful runs per 1k cumulative input tokens — penalizes cheap-but-dumb modes. */
export function successPer1kInputTokens(runs: RunMetrics[]): number {
  const totalInput = runs.reduce((s, r) => s + r.cumulativeInputTokens, 0);
  const successes = runs.filter((r) => r.success).length;
  if (totalInput === 0) return 0;
  return (successes / totalInput) * 1000;
}

/**
 * Score the tool-call trajectory against a gold spec. `goldToolsAnyOf` is a list of
 * acceptable tool-name sets (any one fully satisfies recall); `allowedTools`
 * constrains precision (calls outside it are "unnecessary").
 */
export function scoreTrajectory(
  trace: TraceEvent[],
  spec: { goldToolsAnyOf: string[][]; allowedTools?: string[]; forbiddenTools?: string[] },
): TrajectoryScores {
  const calls = trace.filter((e) => e.type === 'tool_call' && e.name).map((e) => e.name as string);
  const invalid = trace.filter((e) => e.type === 'tool_call' && e.isError).length;
  const allowed = spec.allowedTools ? new Set(spec.allowedTools) : undefined;
  const forbidden = new Set(spec.forbiddenTools ?? []);

  // Best-matching gold set: the one with the highest recall.
  let bestRecall = 0;
  for (const gold of spec.goldToolsAnyOf) {
    if (gold.length === 0) continue;
    const called = new Set(calls);
    const hit = gold.filter((g) => called.has(g)).length;
    bestRecall = Math.max(bestRecall, hit / gold.length);
  }

  const goldUnion = new Set(spec.goldToolsAnyOf.flat());
  const necessary = calls.filter((c) => goldUnion.has(c) && !forbidden.has(c)).length;
  const unnecessary = calls.filter((c) => (allowed ? !allowed.has(c) : !goldUnion.has(c)) || forbidden.has(c)).length;

  return {
    toolSelectionPrecision: calls.length === 0 ? 0 : necessary / calls.length,
    toolSelectionRecall: bestRecall,
    unnecessaryCallsPerRun: unnecessary,
    invalidCallRate: calls.length === 0 ? 0 : invalid / calls.length,
  };
}
