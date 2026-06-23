// Eval runner: A/B the MCP server in `upfront` vs `lazy` tool-loading mode against
// the benchmark cases, print per-mode metrics, and apply the CI gates.
//
// Model wiring (auto-detected, in priority order):
//   1. OPENMODEL_API_KEY  -> OpenModel gateway (baseURL https://api.openmodel.ai),
//      model from EVAL_MODEL or default `deepseek-v4-flash` (free until 2026-06-26).
//   2. ANTHROPIC_API_KEY  -> real Anthropic API, model from EVAL_MODEL or
//      default `claude-opus-4-8`.
// Override the base URL with OPENMODEL_BASE_URL / ANTHROPIC_BASE_URL if needed.
//
// Prereqs: an API key (above), a connected Roblox Studio, and the server built
// (`npm run build`). Then from the repo root:
//   cd evals && npm install
//   OPENMODEL_API_KEY=om-... npx tsx run.ts
//
// Add --mode=lazy or --mode=upfront to run a single mode.

import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import { runSuite, evaluateGates, type EvalCase, type HarnessMode, type SuiteReport } from './harness.js';
import { ClaudeMcpAdapter } from './adapters/claude-mcp-adapter.js';

const here = dirname(fileURLToPath(import.meta.url));
const serverEntry = resolve(here, '..', 'packages', 'robloxstudio-mcp', 'dist', 'index.js');

const DEFAULT_OPENMODEL_BASE_URL = 'https://api.openmodel.ai';
const DEFAULT_OPENMODEL_MODEL = 'deepseek-v4-flash';
const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-4-8';

interface ModelConfig {
  apiKey: string;
  baseURL?: string;
  model: string;
  label: string;
}

/** Pick the model provider from the environment (OpenModel first, then Anthropic). */
function resolveModelConfig(): ModelConfig | undefined {
  if (process.env.OPENMODEL_API_KEY) {
    return {
      apiKey: process.env.OPENMODEL_API_KEY,
      baseURL: process.env.OPENMODEL_BASE_URL ?? DEFAULT_OPENMODEL_BASE_URL,
      model: process.env.EVAL_MODEL ?? DEFAULT_OPENMODEL_MODEL,
      label: 'OpenModel',
    };
  }
  if (process.env.ANTHROPIC_API_KEY) {
    return {
      apiKey: process.env.ANTHROPIC_API_KEY,
      baseURL: process.env.ANTHROPIC_BASE_URL,
      model: process.env.EVAL_MODEL ?? DEFAULT_ANTHROPIC_MODEL,
      label: 'Anthropic',
    };
  }
  return undefined;
}

/** Load every `cases/*.json` bucket (not just discovery), tagging each case with
 *  its source bucket so the report can break results down per bucket. */
function loadCases(): EvalCase[] {
  const dir = join(here, 'cases');
  const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  const all: EvalCase[] = [];
  for (const f of files) {
    const bucket = f.replace(/\.json$/, '');
    const cases = JSON.parse(readFileSync(join(dir, f), 'utf8')) as EvalCase[];
    for (const c of cases) all.push({ ...c, bucket });
    console.log(`  loaded ${cases.length} case(s) from ${f}`);
  }
  return all;
}

/** Per-bucket success + mean tool-selection recall — the breakdown that tells you
 *  WHERE a mode struggles (e.g. low recall on the semantic scene bucket is the
 *  data-gated trigger to revisit embedding-based scene search / Track H). */
function printBucketBreakdown(report: SuiteReport): void {
  const byBucket = new Map<string, { total: number; passed: number; recallSum: number }>();
  for (const c of report.cases) {
    const key = c.bucket ?? 'unknown';
    const agg = byBucket.get(key) ?? { total: 0, passed: 0, recallSum: 0 };
    agg.total += 1;
    if (c.success) agg.passed += 1;
    agg.recallSum += c.scores.toolSelectionRecall;
    byBucket.set(key, agg);
  }
  console.log(`  per-bucket:`);
  for (const [bucket, agg] of [...byBucket.entries()].sort()) {
    const successPct = ((agg.passed / agg.total) * 100).toFixed(0);
    const recallPct = ((agg.recallSum / agg.total) * 100).toFixed(0);
    console.log(`    ${bucket.padEnd(16)} success ${successPct.padStart(3)}% (${agg.passed}/${agg.total})  mean recall ${recallPct}%`);
  }
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Collapse N repeated runs of one mode into a single report whose headline numbers
 *  are the across-repeat medians (so the gate sees the central tendency, not one
 *  noisy draw). Keeps the last repeat's per-case list for the bucket breakdown. */
function aggregateRepeats(mode: HarnessMode, runs: SuiteReport[]): SuiteReport {
  return {
    mode,
    cases: runs[runs.length - 1].cases,
    successRate: median(runs.map((r) => r.successRate)),
    successPer1kInputTokens: median(runs.map((r) => r.successPer1kInputTokens)),
    meanBootstrapTax: median(runs.map((r) => r.meanBootstrapTax)),
    meanWarmBootstrapTax: median(runs.map((r) => r.meanWarmBootstrapTax)),
    meanEffectivePaidInput: median(runs.map((r) => r.meanEffectivePaidInput)),
    meanFirstValidActionTokens: median(runs.map((r) => r.meanFirstValidActionTokens)),
    meanRecoveryCostAfterFirstError: median(runs.map((r) => r.meanRecoveryCostAfterFirstError)),
  };
}

async function main(): Promise<void> {
  const config = resolveModelConfig();
  if (!config) {
    console.error('Set OPENMODEL_API_KEY (recommended — free deepseek-v4-flash) or ANTHROPIC_API_KEY first.');
    process.exit(1);
  }
  console.log(`Provider: ${config.label}  |  model: ${config.model}${config.baseURL ? `  |  baseURL: ${config.baseURL}` : ''}`);
  const only = process.argv.find((a) => a.startsWith('--mode='))?.split('=')[1] as HarnessMode | undefined;
  console.log('\nLoading benchmark cases:');
  const cases = loadCases();
  console.log(`Total: ${cases.length} cases.`);
  // Free gateways (e.g. OpenModel deepseek) enforce a per-user rate limit; throttle
  // between model calls. Override with EVAL_REQUEST_DELAY_MS.
  const defaultDelay = config.label === 'OpenModel' ? 2000 : 0;
  const requestDelayMs = process.env.EVAL_REQUEST_DELAY_MS
    ? Number(process.env.EVAL_REQUEST_DELAY_MS)
    : defaultDelay;
  const adapter = new ClaudeMcpAdapter({
    serverEntry,
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    model: config.model,
    requestDelayMs,
  });

  // Repeat each mode N times and gate on the median, so one noisy draw (a weak
  // model thrashing on a single case) doesn't decide the outcome. Default 1.
  const repeats = Math.max(1, Number(process.env.EVAL_REPEATS) || 1);

  // startServer() now waits for the Studio plugin to (re)connect and aborts with
  // an actionable message if it never does — no separate preflight spawn needed
  // (that just thrashed the bridge by binding/freeing the port an extra time).
  const modes: HarnessMode[] = only ? [only] : ['upfront', 'lazy'];
  const reports = new Map<HarnessMode, SuiteReport>();
  for (const mode of modes) {
    const runs: SuiteReport[] = [];
    for (let rep = 1; rep <= repeats; rep++) {
      const label = repeats > 1 ? ` (repeat ${rep}/${repeats})` : '';
      console.log(`\n=== Running ${cases.length} cases in "${mode}" mode${label} ===`);
      const report = await runSuite(adapter, cases, mode);
      runs.push(report);
      if (repeats > 1) {
        console.log(
          `  repeat ${rep}: success ${(report.successRate * 100).toFixed(0)}%,` +
            ` bootstrap ${report.meanBootstrapTax.toFixed(0)} tok`,
        );
      }
    }
    const agg = aggregateRepeats(mode, runs);
    reports.set(mode, agg);
    console.log(`\n  --- "${mode}" ${repeats > 1 ? `median of ${repeats}` : 'summary'} ---`);
    console.log(`  success rate:            ${(agg.successRate * 100).toFixed(0)}%`);
    console.log(`  mean bootstrap tax:      ${agg.meanBootstrapTax.toFixed(0)} input tokens (cold/raw)`);
    console.log(`  warm bootstrap tax:      ${agg.meanWarmBootstrapTax.toFixed(0)} effective-paid tokens (cache-weighted)`);
    console.log(`  mean effective paid in:  ${agg.meanEffectivePaidInput.toFixed(0)} tokens/task`);
    console.log(`  first-valid-action tax:  ${agg.meanFirstValidActionTokens.toFixed(0)} input tokens`);
    console.log(`  recovery cost (post-err):${agg.meanRecoveryCostAfterFirstError.toFixed(0)} input tokens`);
    console.log(`  success per 1k input:    ${agg.successPer1kInputTokens.toFixed(3)}`);
    printBucketBreakdown(agg);
  }

  const upfront = reports.get('upfront');
  const lazy = reports.get('lazy');
  if (upfront && lazy) {
    const gate = evaluateGates(upfront, lazy, { maxSuccessDropPct: 3, minBootstrapDropPct: 20 });
    console.log(`\n=== Gate (lazy vs upfront): ${gate.pass ? 'PASS' : 'FAIL'} ===`);
    for (const r of gate.reasons) console.log(`  - ${r}`);
    if (!gate.pass) process.exit(1);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
