# MCP eval harness

Measures whether the token/discovery optimizations actually help — not by feel, but
across three layers (per the research review): **bootstrap cost**, **trajectory
quality**, and **end-to-end task success**. Lets you A/B `upfront` vs `lazy` tool
loading on a fixed benchmark and gate CI on regressions.

> **What this harness is — and isn't.** Treat eval results as a **differential
> regression gate**, not an absolute-quality oracle. The harness reliably measures
> *deltas with the resolved model, provider, and base URL held fixed* across a design
> change — tool-call count, invalid-call rate, `recoveryCostAfterFirstError`, recall.
> This reduces model confounding; it does not eliminate sampling noise or provider-side
> model changes. For strong-model quality, **dogfood live in your MCP client** — that's
> the real-model signal a flash eval can't provide. Don't over-read absolute numbers
> from any single model.

## Pieces

- `metrics.ts` — pure metrics over a recorded run trace: `bootstrapTax` (raw input
  tokens before the first real, non-meta tool call), `scoreTrajectory` (tool-selection
  precision/recall, unnecessary calls, invalid-call rate), `successPer1kInputTokens`,
  plus a **caching-aware** set so an A/B isn't biased by whether the model caches:
  `effectivePaidInput` (cache-weighted cost — reads 0.1×, 5-min writes 1.25× base;
  equals raw input for a non-caching provider like deepseek), `warmBootstrapTax`
  (bootstrap tax in effective-paid tokens — the recurring per-task discovery cost a
  warm-cache client actually sees), `firstValidActionTokens` (tokens until the first
  non-error real action — stricter than bootstrap, which stops at the first real call
  even if it errors), and `recoveryCostAfterFirstError` (tokens burned after the first
  errored call — flags brittle handling / weak-model thrashing). Each mode's summary
  prints all of these.
- `harness.ts` — `runSuite` + the `McpHarnessAdapter` interface and the CI `evaluateGates`
  (success must not drop > N pp; bootstrap tax must drop ≥ M%).
- `cases/*.json` — the benchmark task set. The runner loads **every** bucket in this
  directory (discovery, marketplace, mutation, runtime, scene, scene_semantic) and tags
  each case with its bucket so the report breaks results down per bucket.
  `scene_semantic.json` describes targets by behaviour, not name (e.g. "the part players
  touch to win") — a low success / recall there is the **data-gated trigger to revisit
  embedding-based scene search (Track H)**, since it means lexical `scene_search` misses.
- `selfcheck.ts` — deterministic check of the graders (no model). `npx tsx evals/selfcheck.ts`.

## Running it

A concrete adapter ships in `adapters/claude-mcp-adapter.ts` (Anthropic-Messages
protocol) and a runner in `run.ts`. Prereqs: the server is built (`npm run build` at
the repo root), an API key is set (below), and Roblox Studio is connected.

The runner auto-detects the provider from the environment, in priority order:

```sh
cd evals
npm install

# 1. OpenModel gateway (if OPENMODEL_API_KEY is set):
OPENMODEL_API_KEY=om-... npx tsx run.ts                 # A/B upfront vs lazy + gate
OPENMODEL_API_KEY=om-... npx tsx run.ts --mode=lazy     # single mode

# 2. Real Anthropic API (used if OPENMODEL_API_KEY is unset):
ANTHROPIC_API_KEY=sk-... npx tsx run.ts
```

Knobs (env):

- `EVAL_MODEL` — override the model id. Defaults depend on the detected provider;
  set explicitly for reproducible comparisons.
- `OPENMODEL_BASE_URL` / `ANTHROPIC_BASE_URL` — override the API base URL.
- `EVAL_REQUEST_DELAY_MS` — fixed delay before each model call (default `2000` for
  OpenModel to respect its per-user rate limit, `0` for Anthropic).
- `EVAL_MAX_ITERATIONS` — agent-loop cap per task (default `20`). Weak free models
  thrash and need headroom or capability shows up as a false FAIL.
- `EVAL_REPEATS` — run each mode N times and gate on the **median** (default `1`).
  Use ≥3 for a decision-grade verdict so one noisy draw doesn't decide the gate.
- `EVAL_STUDIO_TIMEOUT_MS` — how long each server start waits for the Studio plugin
  to (re)connect before aborting (default `30000`).

`ClaudeMcpAdapter` spawns the MCP server over stdio (`ROBLOX_MCP_LAZY_TOOLS` per
mode), lists its tools, runs a manual tool-use loop against the configured model,
re-lists tools after `load_toolset` in lazy mode, and records a `TraceEvent[]` +
`RunMetrics` per task. It drops the gateway's unsolicited `thinking` blocks from the
replayed history and retries 429s with backoff (`maxRetries`, default 8).

> **Note:** the harness spawns its *own* MCP server and needs the Studio bridge.
> Don't run it while another MCP client (e.g. an active Claude Code / Cursor session)
> already holds the bridge — the spawned server falls back to proxy mode and can't
> reach Studio. Close other MCP clients first, or run evals from a clean shell.

On each server (re)start the harness **waits for the Studio plugin to connect**
(polling `get_connected_instances`, up to `EVAL_STUDIO_TIMEOUT_MS`, default 30s) and
aborts with an actionable message if it never does — so you never burn a full run
against a cold or proxy-mode bridge. The plugin long-polls on an interval, so after a
server respawn it takes a few seconds to (re)register; that's what the wait covers.
Progress is logged live — server spawn, tool count, the Studio instances seen, per-case
`running…`/`PASS|FAIL`, and each tool call — and each mode prints a **per-bucket**
success + mean-recall breakdown.

> **Primary vs proxy:** only one MCP server can own port 58741 (the Studio bridge) at a
> time. If you see `entering proxy mode` in the logs, another server (a Claude Code /
> Cursor session, or a leftover process) holds it and tool calls will fail — close it so
> the eval run is the **primary**. After the old primary dies, give the plugin a few
> seconds to reconnect to the new one (the wait above handles this).

The benchmark cases are place-dependent (they ask about a door system, a finish
line, damage scripts…). Run them against a reasonably populated place — a game
template or a real project — not an empty baseplate, or most cases fail for lack of
content rather than a real tool/recall gap.

## Reproducibility

Eval results depend on many factors. Always record and report:

- **Resolved model, provider, and base URL** printed by the runner (record the actual
  values after defaults and environment overrides, not only `EVAL_MODEL` or the key used)
- **BloxForge version** (git commit or package version)
- **Benchmark commit** (cases may change between versions)
- **Benchmark place** (results vary by place content)
- **Number of repeats** (`EVAL_REPEATS`)
- **Date of run** (model behavior may change over time)

Without these, results are not comparable across runs.

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
