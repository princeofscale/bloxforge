---
name: cluster-110
description: "Skill for the Cluster_110 area of bloxforge. 14 symbols across 2 files."
---

# Cluster_110

14 symbols | 2 files | Cohesion: 68%

## When to Use

- Working with code in `packages/`
- Understanding how cleanupManagedBaseplateFiles, cleanupRecord, logEvent work
- Modifying cluster_110-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `packages/core/src/studio-instance-manager.ts` | isGeneratedBaseplatePlaceFile, cleanupManagedBaseplateFiles, list, get, closeByInstanceId (+8) |
| `packages/core/src/managed-instance-registry.ts` | logEvent |

## Entry Points

Start here when exploring this area:

- **`cleanupManagedBaseplateFiles`** (Function) — `packages/core/src/studio-instance-manager.ts:205`
- **`cleanupRecord`** (Function) — `packages/core/src/studio-instance-manager.ts:615`
- **`logEvent`** (Method) — `packages/core/src/managed-instance-registry.ts:160`
- **`list`** (Method) — `packages/core/src/studio-instance-manager.ts:367`
- **`get`** (Method) — `packages/core/src/studio-instance-manager.ts:383`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `cleanupManagedBaseplateFiles` | Function | `packages/core/src/studio-instance-manager.ts` | 205 |
| `cleanupRecord` | Function | `packages/core/src/studio-instance-manager.ts` | 615 |
| `logEvent` | Method | `packages/core/src/managed-instance-registry.ts` | 160 |
| `list` | Method | `packages/core/src/studio-instance-manager.ts` | 367 |
| `get` | Method | `packages/core/src/studio-instance-manager.ts` | 383 |
| `closeByInstanceId` | Method | `packages/core/src/studio-instance-manager.ts` | 453 |
| `close` | Method | `packages/core/src/studio-instance-manager.ts` | 494 |
| `getCurrentBootId` | Method | `packages/core/src/studio-instance-manager.ts` | 607 |
| `registrySweepOptions` | Method | `packages/core/src/studio-instance-manager.ts` | 611 |
| `sweepRegistry` | Method | `packages/core/src/studio-instance-manager.ts` | 619 |
| `cleanupManagedRecord` | Method | `packages/core/src/studio-instance-manager.ts` | 654 |
| `markClosedInMemory` | Method | `packages/core/src/studio-instance-manager.ts` | 659 |
| `fromRegistryRecord` | Method | `packages/core/src/studio-instance-manager.ts` | 694 |
| `isGeneratedBaseplatePlaceFile` | Function | `packages/core/src/studio-instance-manager.ts` | 199 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `Launch → Ymd` | cross_community | 6 |
| `CloseByInstanceId → EnsureDir` | cross_community | 6 |
| `Launch → EnsureDir` | cross_community | 5 |
| `Launch → SleepSync` | cross_community | 5 |
| `Launch → RecordFilesUnlocked` | cross_community | 5 |
| `Launch → Run` | cross_community | 5 |
| `Launch → IsWsl` | cross_community | 5 |
| `CloseByInstanceId → IsGeneratedBaseplatePlaceFile` | intra_community | 5 |
| `CloseByInstanceId → SleepSync` | cross_community | 5 |
| `CloseByInstanceId → RecordFilesUnlocked` | cross_community | 5 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Cluster_107 | 9 calls |
| Cluster_146 | 2 calls |
| Cluster_143 | 2 calls |
| Cluster_108 | 2 calls |
| Cluster_145 | 1 calls |

## How to Explore

1. `context({name: "cleanupManagedBaseplateFiles"})` — see callers and callees
2. `query({search_query: "cluster_110"})` — find related execution flows
3. Read key files listed above for implementation details
4. `explain({target: "<file or symbol>"})` — persisted taint findings (source→sink data flows), when indexed with `--pdg`
