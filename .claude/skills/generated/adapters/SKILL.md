---
name: adapters
description: "Skill for the Adapters area of bloxforge. 10 symbols across 1 files."
---

# Adapters

10 symbols | 1 files | Cohesion: 88%

## When to Use

- Working with code in `evals/`
- Understanding how startServer, waitForStudio, stopServer work
- Modifying adapters-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `evals/adapters/claude-mcp-adapter.ts` | startServer, waitForStudio, stopServer, checkStudioConnection, listTools (+5) |

## Entry Points

Start here when exploring this area:

- **`startServer`** (Method) — `evals/adapters/claude-mcp-adapter.ts:59`
- **`waitForStudio`** (Method) — `evals/adapters/claude-mcp-adapter.ts:87`
- **`stopServer`** (Method) — `evals/adapters/claude-mcp-adapter.ts:120`
- **`checkStudioConnection`** (Method) — `evals/adapters/claude-mcp-adapter.ts:133`
- **`listTools`** (Method) — `evals/adapters/claude-mcp-adapter.ts:146`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `startServer` | Method | `evals/adapters/claude-mcp-adapter.ts` | 59 |
| `waitForStudio` | Method | `evals/adapters/claude-mcp-adapter.ts` | 87 |
| `stopServer` | Method | `evals/adapters/claude-mcp-adapter.ts` | 120 |
| `checkStudioConnection` | Method | `evals/adapters/claude-mcp-adapter.ts` | 133 |
| `listTools` | Method | `evals/adapters/claude-mcp-adapter.ts` | 146 |
| `runTask` | Method | `evals/adapters/claude-mcp-adapter.ts` | 151 |
| `sleep` | Function | `evals/adapters/claude-mcp-adapter.ts` | 252 |
| `approxTokens` | Function | `evals/adapters/claude-mcp-adapter.ts` | 256 |
| `extractText` | Function | `evals/adapters/claude-mcp-adapter.ts` | 261 |
| `factsPresent` | Function | `evals/adapters/claude-mcp-adapter.ts` | 269 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `Main → ExtractText` | cross_community | 6 |
| `Main → StopServer` | cross_community | 5 |
| `Main → Sleep` | cross_community | 5 |
| `Main → ListTools` | cross_community | 4 |
| `Main → ApproxTokens` | cross_community | 4 |

## How to Explore

1. `context({name: "startServer"})` — see callers and callees
2. `query({search_query: "adapters"})` — find related execution flows
3. Read key files listed above for implementation details
4. `explain({target: "<file or symbol>"})` — persisted taint findings (source→sink data flows), when indexed with `--pdg`
