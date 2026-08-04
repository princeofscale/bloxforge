---
name: cluster-6
description: "Skill for the Cluster_6 area of bloxforge. 8 symbols across 2 files."
---

# Cluster_6

8 symbols | 2 files | Cohesion: 80%

## When to Use

- Working with code in `packages/`
- Understanding how defaultRequestJournalPath, RequestJournal, constructor work
- Modifying cluster_6-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `packages/core/src/bridge-service.ts` | isTerminalRequestState, constructor, enableJournal, pruneTerminalStatuses |
| `packages/core/src/request-journal.ts` | defaultRequestJournalPath, RequestJournal, load, backupCorruptFile |

## Entry Points

Start here when exploring this area:

- **`defaultRequestJournalPath`** (Function) — `packages/core/src/request-journal.ts:59`
- **`RequestJournal`** (Class) — `packages/core/src/request-journal.ts:66`
- **`constructor`** (Method) — `packages/core/src/bridge-service.ts:303`
- **`enableJournal`** (Method) — `packages/core/src/bridge-service.ts:350`
- **`pruneTerminalStatuses`** (Method) — `packages/core/src/bridge-service.ts:405`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `RequestJournal` | Class | `packages/core/src/request-journal.ts` | 66 |
| `defaultRequestJournalPath` | Function | `packages/core/src/request-journal.ts` | 59 |
| `constructor` | Method | `packages/core/src/bridge-service.ts` | 303 |
| `enableJournal` | Method | `packages/core/src/bridge-service.ts` | 350 |
| `pruneTerminalStatuses` | Method | `packages/core/src/bridge-service.ts` | 405 |
| `load` | Method | `packages/core/src/request-journal.ts` | 69 |
| `backupCorruptFile` | Method | `packages/core/src/request-journal.ts` | 157 |
| `isTerminalRequestState` | Function | `packages/core/src/bridge-service.ts` | 123 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `AttachBridgeWebSocket → PruneTerminalStatuses` | cross_community | 4 |
| `AttachBridgeWebSocket → IsTerminalRequestState` | cross_community | 4 |
| `Run → DefaultRequestJournalPath` | cross_community | 3 |
| `Run → RequestJournal` | cross_community | 3 |
| `Constructor → BackupCorruptFile` | intra_community | 3 |

## How to Explore

1. `context({name: "defaultRequestJournalPath"})` — see callers and callees
2. `query({search_query: "cluster_6"})` — find related execution flows
3. Read key files listed above for implementation details
4. `explain({target: "<file or symbol>"})` — persisted taint findings (source→sink data flows), when indexed with `--pdg`
