---
name: cluster-107
description: "Skill for the Cluster_107 area of bloxforge. 20 symbols across 2 files."
---

# Cluster_107

20 symbols | 2 files | Cohesion: 81%

## When to Use

- Working with code in `packages/`
- Understanding how upsert, attachInstanceId, findOpenByInstanceId work
- Modifying cluster_107-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `packages/core/src/managed-instance-registry.ts` | sleepSync, isRecord, upsert, attachInstanceId, findOpenByInstanceId (+13) |
| `packages/core/src/studio-instance-manager.ts` | attachInstanceId, markClosedInRegistry |

## Entry Points

Start here when exploring this area:

- **`upsert`** (Method) — `packages/core/src/managed-instance-registry.ts:109`
- **`attachInstanceId`** (Method) — `packages/core/src/managed-instance-registry.ts:113`
- **`findOpenByInstanceId`** (Method) — `packages/core/src/managed-instance-registry.ts:123`
- **`findAnyByInstanceId`** (Method) — `packages/core/src/managed-instance-registry.ts:130`
- **`listOpen`** (Method) — `packages/core/src/managed-instance-registry.ts:136`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `upsert` | Method | `packages/core/src/managed-instance-registry.ts` | 109 |
| `attachInstanceId` | Method | `packages/core/src/managed-instance-registry.ts` | 113 |
| `findOpenByInstanceId` | Method | `packages/core/src/managed-instance-registry.ts` | 123 |
| `findAnyByInstanceId` | Method | `packages/core/src/managed-instance-registry.ts` | 130 |
| `listOpen` | Method | `packages/core/src/managed-instance-registry.ts` | 136 |
| `markClosed` | Method | `packages/core/src/managed-instance-registry.ts` | 143 |
| `delete` | Method | `packages/core/src/managed-instance-registry.ts` | 152 |
| `withLock` | Method | `packages/core/src/managed-instance-registry.ts` | 164 |
| `ensureDir` | Method | `packages/core/src/managed-instance-registry.ts` | 201 |
| `recordPath` | Method | `packages/core/src/managed-instance-registry.ts` | 205 |
| `recordFilesUnlocked` | Method | `packages/core/src/managed-instance-registry.ts` | 209 |
| `readRecordUnlocked` | Method | `packages/core/src/managed-instance-registry.ts` | 215 |
| `readOpenRecordsUnlocked` | Method | `packages/core/src/managed-instance-registry.ts` | 224 |
| `readRecordsUnlocked` | Method | `packages/core/src/managed-instance-registry.ts` | 228 |
| `writeRecordUnlocked` | Method | `packages/core/src/managed-instance-registry.ts` | 242 |
| `deleteRecordUnlocked` | Method | `packages/core/src/managed-instance-registry.ts` | 256 |
| `attachInstanceId` | Method | `packages/core/src/studio-instance-manager.ts` | 391 |
| `markClosedInRegistry` | Method | `packages/core/src/studio-instance-manager.ts` | 665 |
| `sleepSync` | Function | `packages/core/src/managed-instance-registry.ts` | 77 |
| `isRecord` | Function | `packages/core/src/managed-instance-registry.ts` | 90 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `CloseByInstanceId → EnsureDir` | cross_community | 6 |
| `Launch → EnsureDir` | cross_community | 5 |
| `Launch → SleepSync` | cross_community | 5 |
| `Launch → RecordFilesUnlocked` | cross_community | 5 |
| `CloseByInstanceId → SleepSync` | cross_community | 5 |
| `CloseByInstanceId → RecordFilesUnlocked` | cross_community | 5 |
| `Close → SleepSync` | cross_community | 5 |
| `Close → RecordPath` | cross_community | 5 |
| `Close → IsRecord` | cross_community | 5 |
| `Close → EnsureDir` | cross_community | 5 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Cluster_108 | 2 calls |

## How to Explore

1. `context({name: "upsert"})` — see callers and callees
2. `query({search_query: "cluster_107"})` — find related execution flows
3. Read key files listed above for implementation details
4. `explain({target: "<file or symbol>"})` — persisted taint findings (source→sink data flows), when indexed with `--pdg`
