---
name: evals
description: "Skill for the Evals area of bloxforge. 22 symbols across 4 files."
---

# Evals

22 symbols | 4 files | Cohesion: 90%

## When to Use

- Working with code in `evals/`
- Understanding how runSuite, mean, bootstrapTax work
- Modifying evals-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `evals/metrics.ts` | bootstrapTax, effectivePaidForEvent, effectivePaidInput, warmBootstrapTax, firstValidActionTokens (+3) |
| `evals/harness.ts` | startServer, runTask, stopServer, runSuite, mean (+2) |
| `evals/run.ts` | resolveModelConfig, loadCases, printBucketBreakdown, median, aggregateRepeats (+1) |
| `evals/adapters/claude-mcp-adapter.ts` | ClaudeMcpAdapter |

## Entry Points

Start here when exploring this area:

- **`runSuite`** (Function) — `evals/harness.ts:73`
- **`mean`** (Function) — `evals/harness.ts:116`
- **`bootstrapTax`** (Function) — `evals/metrics.ts:55`
- **`effectivePaidInput`** (Function) — `evals/metrics.ts:84`
- **`warmBootstrapTax`** (Function) — `evals/metrics.ts:93`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `ClaudeMcpAdapter` | Class | `evals/adapters/claude-mcp-adapter.ts` | 42 |
| `runSuite` | Function | `evals/harness.ts` | 73 |
| `mean` | Function | `evals/harness.ts` | 116 |
| `bootstrapTax` | Function | `evals/metrics.ts` | 55 |
| `effectivePaidInput` | Function | `evals/metrics.ts` | 84 |
| `warmBootstrapTax` | Function | `evals/metrics.ts` | 93 |
| `firstValidActionTokens` | Function | `evals/metrics.ts` | 105 |
| `recoveryCostAfterFirstError` | Function | `evals/metrics.ts` | 116 |
| `successPer1kInputTokens` | Function | `evals/metrics.ts` | 127 |
| `scoreTrajectory` | Function | `evals/metrics.ts` | 139 |
| `evaluateGates` | Function | `evals/harness.ts` | 132 |
| `McpHarnessAdapter` | Interface | `evals/harness.ts` | 40 |
| `startServer` | Method | `evals/harness.ts` | 41 |
| `runTask` | Method | `evals/harness.ts` | 42 |
| `stopServer` | Method | `evals/harness.ts` | 43 |
| `effectivePaidForEvent` | Function | `evals/metrics.ts` | 74 |
| `resolveModelConfig` | Function | `evals/run.ts` | 38 |
| `loadCases` | Function | `evals/run.ts` | 60 |
| `printBucketBreakdown` | Function | `evals/run.ts` | 76 |
| `median` | Function | `evals/run.ts` | 94 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `Main → ExtractText` | cross_community | 6 |
| `Main → StopServer` | cross_community | 5 |
| `Main → Sleep` | cross_community | 5 |
| `Main → ListTools` | cross_community | 4 |
| `Main → ApproxTokens` | cross_community | 4 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Adapters | 3 calls |

## How to Explore

1. `context({name: "runSuite"})` — see callers and callees
2. `query({search_query: "evals"})` — find related execution flows
3. Read key files listed above for implementation details
4. `explain({target: "<file or symbol>"})` — persisted taint findings (source→sink data flows), when indexed with `--pdg`
