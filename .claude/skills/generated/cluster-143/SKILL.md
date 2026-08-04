---
name: cluster-143
description: "Skill for the Cluster_143 area of bloxforge. 10 symbols across 1 files."
---

# Cluster_143

10 symbols | 1 files | Cohesion: 88%

## When to Use

- Working with code in `packages/`
- Understanding how isWsl, resolveStudioExe, listStudioProcesses work
- Modifying cluster_143-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `packages/core/src/studio-instance-manager.ts` | run, isWsl, powershell, windowsLocalAppData, toWslPath (+5) |

## Entry Points

Start here when exploring this area:

- **`isWsl`** (Function) — `packages/core/src/studio-instance-manager.ts:88`
- **`resolveStudioExe`** (Function) — `packages/core/src/studio-instance-manager.ts:229`
- **`listStudioProcesses`** (Function) — `packages/core/src/studio-instance-manager.ts:262`
- **`currentBootId`** (Function) — `packages/core/src/studio-instance-manager.ts:296`
- **`closeProcess`** (Method) — `packages/core/src/studio-instance-manager.ts:560`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `isWsl` | Function | `packages/core/src/studio-instance-manager.ts` | 88 |
| `resolveStudioExe` | Function | `packages/core/src/studio-instance-manager.ts` | 229 |
| `listStudioProcesses` | Function | `packages/core/src/studio-instance-manager.ts` | 262 |
| `currentBootId` | Function | `packages/core/src/studio-instance-manager.ts` | 296 |
| `closeProcess` | Method | `packages/core/src/studio-instance-manager.ts` | 560 |
| `run` | Function | `packages/core/src/studio-instance-manager.ts` | 80 |
| `powershell` | Function | `packages/core/src/studio-instance-manager.ts` | 97 |
| `windowsLocalAppData` | Function | `packages/core/src/studio-instance-manager.ts` | 103 |
| `toWslPath` | Function | `packages/core/src/studio-instance-manager.ts` | 115 |
| `toStudioLaunchArg` | Function | `packages/core/src/studio-instance-manager.ts` | 120 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `Launch → Run` | cross_community | 5 |
| `Launch → IsWsl` | cross_community | 5 |

## How to Explore

1. `context({name: "isWsl"})` — see callers and callees
2. `query({search_query: "cluster_143"})` — find related execution flows
3. Read key files listed above for implementation details
4. `explain({target: "<file or symbol>"})` — persisted taint findings (source→sink data flows), when indexed with `--pdg`
