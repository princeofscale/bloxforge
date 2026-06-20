// Eval runner: A/B the MCP server in `upfront` vs `lazy` tool-loading mode against
// the benchmark cases, print per-mode metrics, and apply the CI gates.
//
// Prereqs: ANTHROPIC_API_KEY set, a connected Roblox Studio, and the server built
// (`npm run build`). Then from the repo root:
//   cd evals && npm install && npx tsx run.ts
//
// Add --mode=lazy or --mode=upfront to run a single mode.

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import { runSuite, evaluateGates, type EvalCase, type HarnessMode } from './harness.js';
import { ClaudeMcpAdapter } from './adapters/claude-mcp-adapter.js';

const here = dirname(fileURLToPath(import.meta.url));
const serverEntry = resolve(here, '..', 'packages', 'robloxstudio-mcp', 'dist', 'index.js');

function loadCases(): EvalCase[] {
  const raw = readFileSync(join(here, 'cases', 'discovery.json'), 'utf8');
  return JSON.parse(raw) as EvalCase[];
}

async function main(): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('Set ANTHROPIC_API_KEY first.');
    process.exit(1);
  }
  const only = process.argv.find((a) => a.startsWith('--mode='))?.split('=')[1] as HarnessMode | undefined;
  const cases = loadCases();
  const adapter = new ClaudeMcpAdapter({ serverEntry });

  const modes: HarnessMode[] = only ? [only] : ['upfront', 'lazy'];
  const reports = new Map<HarnessMode, Awaited<ReturnType<typeof runSuite>>>();
  for (const mode of modes) {
    console.log(`\n=== Running ${cases.length} cases in "${mode}" mode ===`);
    const report = await runSuite(adapter, cases, mode);
    reports.set(mode, report);
    console.log(`success rate:            ${(report.successRate * 100).toFixed(0)}%`);
    console.log(`mean bootstrap tax:      ${report.meanBootstrapTax.toFixed(0)} input tokens`);
    console.log(`success per 1k input:    ${report.successPer1kInputTokens.toFixed(3)}`);
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
  console.error(err);
  process.exit(1);
});
