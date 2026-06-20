# MCP eval harness

Measures whether the token/discovery optimizations actually help — not by feel, but
across three layers (per the research review): **bootstrap cost**, **trajectory
quality**, and **end-to-end task success**. Lets you A/B `upfront` vs `lazy` tool
loading on a fixed benchmark and gate CI on regressions.

## Pieces

- `metrics.ts` — pure metrics over a recorded run trace: `bootstrapTax` (tokens before
  the first world read), `scoreTrajectory` (tool-selection precision/recall,
  unnecessary calls, invalid-call rate), `successPer1kInputTokens`.
- `harness.ts` — `runSuite` + the `McpHarnessAdapter` interface and the CI `evaluateGates`
  (success must not drop > N pp; bootstrap tax must drop ≥ M%).
- `cases/*.json` — the benchmark task set (discovery / trajectory / e2e buckets).
- `selfcheck.ts` — deterministic check of the graders (no model). `npx tsx evals/selfcheck.ts`.

## Running it

A concrete Claude adapter ships in `adapters/claude-mcp-adapter.ts` and a runner in
`run.ts`. Prereqs: the server is built (`npm run build` at the repo root),
`ANTHROPIC_API_KEY` is set, and Roblox Studio is connected.

```sh
cd evals
npm install
ANTHROPIC_API_KEY=sk-... npx tsx run.ts        # A/B upfront vs lazy + gate
ANTHROPIC_API_KEY=sk-... npx tsx run.ts --mode=lazy   # single mode
```

`ClaudeMcpAdapter` spawns the MCP server over stdio (`ROBLOX_MCP_LAZY_TOOLS` per
mode), lists its tools, runs a manual Claude tool-use loop (`claude-opus-4-8`),
re-lists tools after `load_toolset` in lazy mode, and records a `TraceEvent[]` +
`RunMetrics` per task.

## Wiring a different model

The model-driving part is an interface so it stays provider-agnostic. Implement
`McpHarnessAdapter` (see the Claude adapter as the reference): `startServer(mode)`
launches the MCP server, `runTask` runs the agent loop and records the trace + metrics.

```ts
import { runSuite, evaluateGates } from './harness.js';
import discovery from './cases/discovery.json' assert { type: 'json' };

const upfront = await runSuite(adapter, discovery, 'upfront');
const lazy = await runSuite(adapter, discovery, 'lazy');
const gate = evaluateGates(upfront, lazy, { maxSuccessDropPct: 3, minBootstrapDropPct: 30 });
if (!gate.pass) { console.error(gate.reasons); process.exit(1); }
```

## Grading

Use rule-based graders (schemas, allowed/forbidden tools, trajectory) as the hard
gate, and reserve an LLM-as-judge only for answer sufficiency on `must_contain_facts`.
Keep a small human-calibration set to sanity-check the judge.
