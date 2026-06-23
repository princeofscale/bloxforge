// Deterministic self-check for the eval graders — no model/network. Run with:
//   npx tsx evals/selfcheck.ts
// Exits non-zero on failure so it can gate CI even without a live model adapter.

import {
  bootstrapTax,
  warmBootstrapTax,
  effectivePaidInput,
  firstValidActionTokens,
  recoveryCostAfterFirstError,
  scoreTrajectory,
  successPer1kInputTokens,
  type TraceEvent,
  type RunMetrics,
} from './metrics.js';

let failures = 0;
function check(name: string, cond: boolean): void {
  if (!cond) {
    failures += 1;
    console.error(`FAIL: ${name}`);
  } else {
    console.log(`ok: ${name}`);
  }
}

const trace: TraceEvent[] = [
  { t: 0, type: 'model', tokensIn: 1200 },
  { t: 1, type: 'tool_call', name: 'tool_catalog_search' },
  { t: 2, type: 'tool_result', name: 'tool_catalog_search' },
  { t: 3, type: 'model', tokensIn: 300 },
  { t: 4, type: 'tool_call', name: 'load_toolset' },
  { t: 5, type: 'model', tokensIn: 200 },
  { t: 6, type: 'tool_call', name: 'get_world_snapshot' }, // first world read
  { t: 7, type: 'tool_call', name: 'execute_luau', isError: true }, // forbidden + invalid
];

// bootstrap tax counts model tokens before the first *real* tool call; meta tools
// (tool_catalog_search, load_toolset) belong to the bootstrap window, so the boundary
// is get_world_snapshot here: 1200 + 300 + 200 = 1700.
check('bootstrapTax sums model tokens before the first real (non-discovery) tool call', bootstrapTax(trace) === 1700);

// A task that never does a "world read" must still stop at its first real action
// (marketplace_search), not sum the whole run — the old boundary's contamination bug.
const noWorldReadTrace: TraceEvent[] = [
  { t: 0, type: 'model', tokensIn: 500 },
  { t: 1, type: 'tool_call', name: 'marketplace_search' },
  { t: 2, type: 'model', tokensIn: 9999 },
  { t: 3, type: 'tool_call', name: 'asset_preflight_insert' },
];
check('bootstrapTax stops at first real tool when no world read happens', bootstrapTax(noWorldReadTrace) === 500);

// Caching-aware metrics (Track B). A warm-cache turn: 2000 total input, 1800 served
// from cache (read), 0 fresh writes -> effective paid = 200 base + 1800*0.1 = 380.
const cachedTrace: TraceEvent[] = [
  { t: 0, type: 'model', tokensIn: 2000, cacheReadIn: 1800, cacheWriteIn: 0 },
  { t: 1, type: 'tool_call', name: 'load_toolset' }, // meta -> still bootstrap
  { t: 2, type: 'model', tokensIn: 500, cacheReadIn: 400, cacheWriteIn: 0 }, // 100 + 40 = 140
  { t: 3, type: 'tool_call', name: 'get_world_snapshot' }, // first real -> boundary
  { t: 4, type: 'model', tokensIn: 9999, cacheReadIn: 9000, cacheWriteIn: 0 }, // after boundary
];
// effective paid over the whole run: 380 + 140 + (999 + 900) = 2419.
check('effectivePaidInput weights cache reads at 0.1x base', effectivePaidInput(cachedTrace) === 380 + 140 + (999 + 900));
// warm bootstrap tax stops at the first real call (same boundary as bootstrapTax),
// but in effective-paid tokens: 380 + 140 = 520.
check('warmBootstrapTax is cache-weighted up to the first real call', warmBootstrapTax(cachedTrace) === 520);
// A non-caching provider (no cache fields) -> effective paid == raw input.
const uncached: TraceEvent[] = [
  { t: 0, type: 'model', tokensIn: 1000 },
  { t: 1, type: 'tool_call', name: 'search_objects' },
];
check('effectivePaidInput equals raw input without cache fields', effectivePaidInput(uncached) === 1000);

// first-valid-action vs bootstrap: bootstrap stops at the first real call even if it
// errors; first-valid keeps going until a real call that *succeeds*.
const erroredFirstTry: TraceEvent[] = [
  { t: 0, type: 'model', tokensIn: 300 },
  { t: 1, type: 'tool_call', name: 'set_property', isError: true }, // real but failed
  { t: 2, type: 'model', tokensIn: 200 },
  { t: 3, type: 'tool_call', name: 'set_property' }, // real + valid -> boundary
];
check('bootstrapTax stops at first real call even when it errors', bootstrapTax(erroredFirstTry) === 300);
check('firstValidActionTokens waits for the first non-error real call', firstValidActionTokens(erroredFirstTry) === 500);
// recovery cost = model tokens spent after the first errored tool call (200 here).
check('recoveryCostAfterFirstError sums model tokens after the first error', recoveryCostAfterFirstError(erroredFirstTry) === 200);

const scores = scoreTrajectory(trace, {
  goldToolsAnyOf: [['tool_catalog_search', 'load_toolset', 'get_world_snapshot']],
  allowedTools: ['tool_catalog_search', 'load_toolset', 'get_world_snapshot'],
  forbiddenTools: ['execute_luau'],
});
check('recall is full when all gold tools were called', scores.toolSelectionRecall === 1);
check('execute_luau counted as unnecessary (forbidden/not allowed)', scores.unnecessaryCallsPerRun === 1);
check('invalid call rate reflects the errored call', scores.invalidCallRate > 0);

const runs: RunMetrics[] = [
  { initInputTokens: 1700, cumulativeInputTokens: 5000, cumulativeOutputTokens: 400, toolSchemaTokensSeen: 800, toolCalls: 4, distinctToolsCalled: 4, unnecessaryToolCalls: 1, invalidToolCalls: 1, retriesAfterRecoverableError: 0, wallClockMs: 1000, success: true },
  { initInputTokens: 1700, cumulativeInputTokens: 5000, cumulativeOutputTokens: 400, toolSchemaTokensSeen: 800, toolCalls: 4, distinctToolsCalled: 4, unnecessaryToolCalls: 0, invalidToolCalls: 0, retriesAfterRecoverableError: 0, wallClockMs: 1000, success: false },
];
// 1 success / 10000 input tokens * 1000 = 0.1
check('successPer1kInputTokens computes correctly', Math.abs(successPer1kInputTokens(runs) - 0.1) < 1e-9);

if (failures > 0) {
  console.error(`\n${failures} self-check(s) failed.`);
  process.exit(1);
}
console.log('\nAll eval graders pass.');
