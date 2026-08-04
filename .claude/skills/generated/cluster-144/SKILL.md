---
name: cluster-144
description: "Skill for the Cluster_144 area of bloxforge. 10 symbols across 1 files."
---

# Cluster_144

10 symbols | 1 files | Cohesion: 74%

## When to Use

- Working with code in `packages/`
- Understanding how sweepStaleBaseplateFiles, buildStudioLaunchArgs, launch work
- Modifying cluster_144-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `packages/core/src/studio-instance-manager.ts` | resolveEntrypointDir, resolveBaseplateTemplatePath, isProcessAlive, sweepStaleBaseplateFiles, createBaseplatePlaceFile (+5) |

## Entry Points

Start here when exploring this area:

- **`sweepStaleBaseplateFiles`** (Function) — `packages/core/src/studio-instance-manager.ts:168`
- **`buildStudioLaunchArgs`** (Function) — `packages/core/src/studio-instance-manager.ts:324`
- **`launch`** (Method) — `packages/core/src/studio-instance-manager.ts:400`
- **`toRegistryRecord`** (Method) — `packages/core/src/studio-instance-manager.ts:669`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `sweepStaleBaseplateFiles` | Function | `packages/core/src/studio-instance-manager.ts` | 168 |
| `buildStudioLaunchArgs` | Function | `packages/core/src/studio-instance-manager.ts` | 324 |
| `launch` | Method | `packages/core/src/studio-instance-manager.ts` | 400 |
| `toRegistryRecord` | Method | `packages/core/src/studio-instance-manager.ts` | 669 |
| `resolveEntrypointDir` | Function | `packages/core/src/studio-instance-manager.ts` | 125 |
| `resolveBaseplateTemplatePath` | Function | `packages/core/src/studio-instance-manager.ts` | 135 |
| `isProcessAlive` | Function | `packages/core/src/studio-instance-manager.ts` | 155 |
| `createBaseplatePlaceFile` | Function | `packages/core/src/studio-instance-manager.ts` | 191 |
| `prepareStudioLaunchOptions` | Function | `packages/core/src/studio-instance-manager.ts` | 221 |
| `delay` | Function | `packages/core/src/studio-instance-manager.ts` | 348 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `Launch → Ymd` | cross_community | 6 |
| `Launch → EnsureDir` | cross_community | 5 |
| `Launch → SleepSync` | cross_community | 5 |
| `Launch → RecordFilesUnlocked` | cross_community | 5 |
| `Launch → Run` | cross_community | 5 |
| `Launch → IsWsl` | cross_community | 5 |
| `Launch → RecordPath` | cross_community | 4 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Cluster_107 | 3 calls |
| Cluster_110 | 2 calls |
| Cluster_146 | 2 calls |
| Cluster_143 | 2 calls |

## How to Explore

1. `context({name: "sweepStaleBaseplateFiles"})` — see callers and callees
2. `query({search_query: "cluster_144"})` — find related execution flows
3. Read key files listed above for implementation details
4. `explain({target: "<file or symbol>"})` — persisted taint findings (source→sink data flows), when indexed with `--pdg`
