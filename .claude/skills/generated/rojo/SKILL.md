---
name: rojo
description: "Skill for the Rojo area of bloxforge. 95 symbols across 13 files."
---

# Rojo

95 symbols | 13 files | Cohesion: 78%

## When to Use

- Working with code in `packages/`
- Understanding how isRojoProjectFile, discoverRojoProjects, walk work
- Modifying rojo-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `packages/core/src/rojo/rojo-tools.ts` | hashFile, assertSafeOutput, buildProject, generateSourcemap, nativeSyncbackPlan (+12) |
| `packages/core/src/rojo/process-manager.ts` | assertPortAvailable, readServerInfo, outlives, getVersion, startOnce (+12) |
| `packages/core/src/rojo/source-editor.ts` | constructor, diff, file, atomicWrite, exclusiveWrite (+6) |
| `packages/core/src/tools/index.ts` | syncPull, syncStatus, rojoSyncbackPlan, rojoSyncbackApply, rojoReadSource (+4) |
| `packages/core/src/rojo/project-discovery.ts` | isRojoProjectFile, discoverRojoProjects, walk, selectRojoProject, parseJsonc (+3) |
| `packages/core/src/rojo/command-runner.ts` | commandErrorMessage, resolveCommand, resolve, command, run (+3) |
| `packages/core/src/rojo/sourcemap.ts` | readSourcemap, resolveSourceInstance, walk, instancePathSegments, walkChildren (+1) |
| `packages/core/src/tools/sync-tools.ts` | atomicWriteFile, _statePath, _writeState, _resolveSyncDir, syncPull (+1) |
| `packages/core/src/rojo/source-mapper.ts` | within, canonicalCandidate, resolveProjectRoot, resolveProjectPath, classifyRojoSource |
| `packages/core/src/toolchain/wally-tools.ts` | casePath, collectProjectPaths, verifyRojoMapping |

## Entry Points

Start here when exploring this area:

- **`isRojoProjectFile`** (Function) — `packages/core/src/rojo/project-discovery.ts:63`
- **`discoverRojoProjects`** (Function) — `packages/core/src/rojo/project-discovery.ts:123`
- **`walk`** (Function) — `packages/core/src/rojo/project-discovery.ts:126`
- **`selectRojoProject`** (Function) — `packages/core/src/rojo/project-discovery.ts:144`
- **`resolveProjectRoot`** (Function) — `packages/core/src/rojo/source-mapper.ts:21`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `RojoSourceEditor` | Class | `packages/core/src/rojo/source-editor.ts` | 51 |
| `RojoCommandRunner` | Class | `packages/core/src/rojo/command-runner.ts` | 46 |
| `isRojoProjectFile` | Function | `packages/core/src/rojo/project-discovery.ts` | 63 |
| `discoverRojoProjects` | Function | `packages/core/src/rojo/project-discovery.ts` | 123 |
| `walk` | Function | `packages/core/src/rojo/project-discovery.ts` | 126 |
| `selectRojoProject` | Function | `packages/core/src/rojo/project-discovery.ts` | 144 |
| `resolveProjectRoot` | Function | `packages/core/src/rojo/source-mapper.ts` | 21 |
| `resolveProjectPath` | Function | `packages/core/src/rojo/source-mapper.ts` | 28 |
| `resolveSourceInstance` | Function | `packages/core/src/rojo/sourcemap.ts` | 89 |
| `classifyRojoSource` | Function | `packages/core/src/rojo/source-mapper.ts` | 130 |
| `isLoopbackHost` | Function | `packages/core/src/network.ts` | 2 |
| `assertSecureBridgeBinding` | Function | `packages/core/src/server.ts` | 61 |
| `instancePathSegments` | Function | `packages/core/src/rojo/sourcemap.ts` | 46 |
| `resolveInstanceSource` | Function | `packages/core/src/rojo/sourcemap.ts` | 63 |
| `buildProject` | Method | `packages/core/src/rojo/rojo-tools.ts` | 127 |
| `generateSourcemap` | Method | `packages/core/src/rojo/rojo-tools.ts` | 145 |
| `nativeSyncbackPlan` | Method | `packages/core/src/rojo/rojo-tools.ts` | 206 |
| `nativeSyncbackApply` | Method | `packages/core/src/rojo/rojo-tools.ts` | 237 |
| `syncbackPlanHash` | Method | `packages/core/src/rojo/rojo-tools.ts` | 315 |
| `snapshotSources` | Method | `packages/core/src/rojo/rojo-tools.ts` | 349 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `AddTool → Within` | cross_community | 7 |
| `Update → Within` | cross_community | 7 |
| `Status → Within` | cross_community | 7 |
| `UpdateApply → Within` | cross_community | 7 |
| `UpdatePlan → Within` | cross_community | 7 |
| `Handler → Within` | cross_community | 6 |
| `Handler → IsRojoProjectFile` | cross_community | 6 |
| `Handler → CanonicalCandidate` | cross_community | 6 |
| `Handler → ParseJsonc` | cross_community | 6 |
| `Handler → DeriveProjectName` | cross_community | 6 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Tools | 6 calls |
| Toolchain | 2 calls |

## How to Explore

1. `context({name: "isRojoProjectFile"})` — see callers and callees
2. `query({search_query: "rojo"})` — find related execution flows
3. Read key files listed above for implementation details
4. `explain({target: "<file or symbol>"})` — persisted taint findings (source→sink data flows), when indexed with `--pdg`
