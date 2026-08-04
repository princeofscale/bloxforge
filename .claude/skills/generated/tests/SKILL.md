---
name: tests
description: "Skill for the Tests area of bloxforge. 62 symbols across 6 files."
---

# Tests

62 symbols | 6 files | Cohesion: 82%

## When to Use

- Working with code in `tests/`
- Understanding how assert, assertContains, waitForEditPeer work
- Modifying tests-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `tests/auto-install-plugin-e2e.mjs` | assert, waitPortClosed, compareFiles, removeVariantFiles, launchStudioPlace (+25) |
| `tests/studio-tooling-smoke.mjs` | assertNoError, runEditModeToolSmoke, isPortOpen, waitPortClosed, backupPluginFiles (+5) |
| `tests/lib/mcp-client.mjs` | assert, assertContains, McpClient, start, _waitForLog (+4) |
| `tests/runtime-bridge-lifecycle.mjs` | waitForRoles, waitForNoRuntime, assertEditBridgesAbsent, assertRuntimeEvalWorks, startDirectPlay (+2) |
| `tests/simulation-state-lifecycle.mjs` | networkState, assertNetworkValues, assertDeviceDefault, assertDeviceActive, expectToolFailure |
| `tests/multiplayer-test-lifecycle.mjs` | pickInstanceId |

## Entry Points

Start here when exploring this area:

- **`assert`** (Function) — `tests/lib/mcp-client.mjs:182`
- **`assertContains`** (Function) — `tests/lib/mcp-client.mjs:187`
- **`waitForEditPeer`** (Function) — `tests/lib/mcp-client.mjs:215`
- **`startPlaytestAndWait`** (Function) — `tests/lib/mcp-client.mjs:230`
- **`McpClient`** (Class) — `tests/lib/mcp-client.mjs:48`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `McpClient` | Class | `tests/lib/mcp-client.mjs` | 48 |
| `assert` | Function | `tests/lib/mcp-client.mjs` | 182 |
| `assertContains` | Function | `tests/lib/mcp-client.mjs` | 187 |
| `waitForEditPeer` | Function | `tests/lib/mcp-client.mjs` | 215 |
| `startPlaytestAndWait` | Function | `tests/lib/mcp-client.mjs` | 230 |
| `start` | Method | `tests/lib/mcp-client.mjs` | 64 |
| `_waitForLog` | Method | `tests/lib/mcp-client.mjs` | 107 |
| `stop` | Method | `tests/lib/mcp-client.mjs` | 171 |
| `waitForRoles` | Function | `tests/runtime-bridge-lifecycle.mjs` | 7 |
| `waitForNoRuntime` | Function | `tests/runtime-bridge-lifecycle.mjs` | 20 |
| `assertEditBridgesAbsent` | Function | `tests/runtime-bridge-lifecycle.mjs` | 33 |
| `assertRuntimeEvalWorks` | Function | `tests/runtime-bridge-lifecycle.mjs` | 52 |
| `startDirectPlay` | Function | `tests/runtime-bridge-lifecycle.mjs` | 69 |
| `startDirectMultiplayer` | Function | `tests/runtime-bridge-lifecycle.mjs` | 87 |
| `endDirectTest` | Function | `tests/runtime-bridge-lifecycle.mjs` | 105 |
| `networkState` | Function | `tests/simulation-state-lifecycle.mjs` | 18 |
| `assertNetworkValues` | Function | `tests/simulation-state-lifecycle.mjs` | 22 |
| `assertDeviceDefault` | Function | `tests/simulation-state-lifecycle.mjs` | 29 |
| `assertDeviceActive` | Function | `tests/simulation-state-lifecycle.mjs` | 34 |
| `expectToolFailure` | Function | `tests/simulation-state-lifecycle.mjs` | 39 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `RunMismatchCase → Run` | cross_community | 5 |
| `RunMismatchCase → IsWsl` | cross_community | 5 |
| `Main → IsWsl` | cross_community | 4 |
| `Main → Run` | cross_community | 4 |
| `RunMismatchCase → _waitForLog` | cross_community | 4 |
| `RunMismatchCase → Rpc` | cross_community | 4 |
| `RunMismatchCase → Notify` | cross_community | 4 |
| `Main → _waitForLog` | intra_community | 3 |
| `Main → Rpc` | cross_community | 3 |
| `Main → Notify` | cross_community | 3 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Scripts | 10 calls |
| Cluster_252 | 2 calls |

## How to Explore

1. `context({name: "assert"})` — see callers and callees
2. `query({search_query: "tests"})` — find related execution flows
3. Read key files listed above for implementation details
4. `explain({target: "<file or symbol>"})` — persisted taint findings (source→sink data flows), when indexed with `--pdg`
