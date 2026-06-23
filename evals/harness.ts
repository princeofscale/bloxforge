// Paired A/B harness skeleton for measuring MCP optimizations (research review #6).
// The model-driving adapter is intentionally an interface: plug in your own client
// (Claude/Codex) + an MCP client transport. The harness loads cases, runs each in
// the requested mode, and aggregates metrics + gates so CI can fail on regressions.
//
// Wire an adapter, then: `tsx evals/harness.ts` (or import runSuite from your runner).

import type { RunMetrics, TraceEvent, TrajectoryScores } from './metrics.js';
import {
  bootstrapTax,
  warmBootstrapTax,
  effectivePaidInput,
  firstValidActionTokens,
  recoveryCostAfterFirstError,
  scoreTrajectory,
  successPer1kInputTokens,
} from './metrics.js';

export type HarnessMode = 'upfront' | 'lazy';

export interface EvalCase {
  id: string;
  prompt: string;
  allowed_domains?: string[];
  allowedTools?: string[];
  forbiddenTools?: string[];
  gold_tools_any_of: string[][];
  must_contain_facts?: string[];
  grade_type: 'trajectory' | 'answer' | 'trajectory+answer';
  /** Source bucket file (set by the runner's loader; used for per-bucket reporting). */
  bucket?: string;
}

export interface RunResult {
  finalAnswer: string;
  trace: TraceEvent[];
  metrics: RunMetrics;
}

/** Implement this against your model + MCP client. */
export interface McpHarnessAdapter {
  startServer(mode: HarnessMode): Promise<void>;
  runTask(task: EvalCase): Promise<RunResult>;
  stopServer(): Promise<void>;
}

export interface CaseReport {
  id: string;
  bucket?: string;
  mode: HarnessMode;
  success: boolean;
  bootstrapTax: number;
  warmBootstrapTax: number;
  effectivePaidInput: number;
  firstValidActionTokens: number;
  recoveryCostAfterFirstError: number;
  scores: TrajectoryScores;
  metrics: RunMetrics;
}

export interface SuiteReport {
  mode: HarnessMode;
  cases: CaseReport[];
  successRate: number;
  successPer1kInputTokens: number;
  meanBootstrapTax: number;
  // Caching-aware companions (equal the raw numbers for a non-caching provider):
  meanWarmBootstrapTax: number;
  meanEffectivePaidInput: number;
  meanFirstValidActionTokens: number;
  meanRecoveryCostAfterFirstError: number;
}

export async function runSuite(adapter: McpHarnessAdapter, cases: EvalCase[], mode: HarnessMode): Promise<SuiteReport> {
  await adapter.startServer(mode);
  const reports: CaseReport[] = [];
  try {
    let i = 0;
    for (const c of cases) {
      i += 1;
      console.log(`  [${mode}] ${i}/${cases.length} ${c.id} — running…`);
      const res = await adapter.runTask(c);
      const scores = scoreTrajectory(res.trace, {
        goldToolsAnyOf: c.gold_tools_any_of,
        allowedTools: c.allowedTools,
        forbiddenTools: c.forbiddenTools,
      });
      const tax = bootstrapTax(res.trace);
      const warmTax = warmBootstrapTax(res.trace);
      const effPaid = effectivePaidInput(res.trace);
      const firstValid = firstValidActionTokens(res.trace);
      const recovery = recoveryCostAfterFirstError(res.trace);
      console.log(
        `  [${mode}] ${i}/${cases.length} ${c.id} — ${res.metrics.success ? 'PASS' : 'FAIL'}` +
          ` (recall ${(scores.toolSelectionRecall * 100).toFixed(0)}%,` +
          ` ${res.metrics.toolCalls} calls, ${res.metrics.invalidToolCalls} invalid,` +
          ` bootstrap ${tax} tok)`,
      );
      reports.push({
        id: c.id,
        bucket: c.bucket,
        mode,
        success: res.metrics.success,
        bootstrapTax: tax,
        warmBootstrapTax: warmTax,
        effectivePaidInput: effPaid,
        firstValidActionTokens: firstValid,
        recoveryCostAfterFirstError: recovery,
        scores,
        metrics: res.metrics,
      });
    }
  } finally {
    await adapter.stopServer();
  }
  const metrics = reports.map((r) => r.metrics);
  const mean = (pick: (r: CaseReport) => number) =>
    reports.length === 0 ? 0 : reports.reduce((s, r) => s + pick(r), 0) / reports.length;
  return {
    mode,
    cases: reports,
    successRate: reports.length === 0 ? 0 : reports.filter((r) => r.success).length / reports.length,
    successPer1kInputTokens: successPer1kInputTokens(metrics),
    meanBootstrapTax: mean((r) => r.bootstrapTax),
    meanWarmBootstrapTax: mean((r) => r.warmBootstrapTax),
    meanEffectivePaidInput: mean((r) => r.effectivePaidInput),
    meanFirstValidActionTokens: mean((r) => r.firstValidActionTokens),
    meanRecoveryCostAfterFirstError: mean((r) => r.recoveryCostAfterFirstError),
  };
}

/** CI gates from the review: success must not regress; efficiency must improve. */
export function evaluateGates(baseline: SuiteReport, candidate: SuiteReport, opts = { maxSuccessDropPct: 3, minBootstrapDropPct: 0 }): { pass: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const successDropPct = (baseline.successRate - candidate.successRate) * 100;
  if (successDropPct > opts.maxSuccessDropPct) {
    reasons.push(`success regressed ${successDropPct.toFixed(1)}pp (> ${opts.maxSuccessDropPct})`);
  }
  const bootstrapDropPct = baseline.meanBootstrapTax === 0
    ? 0
    : ((baseline.meanBootstrapTax - candidate.meanBootstrapTax) / baseline.meanBootstrapTax) * 100;
  if (bootstrapDropPct < opts.minBootstrapDropPct) {
    reasons.push(`bootstrap tax improved only ${bootstrapDropPct.toFixed(1)}% (< ${opts.minBootstrapDropPct})`);
  }
  return { pass: reasons.length === 0, reasons };
}
