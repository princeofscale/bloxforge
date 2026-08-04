---
name: toolchain
description: "Skill for the Toolchain area of bloxforge. 110 symbols across 10 files."
---

# Toolchain

110 symbols | 10 files | Cohesion: 78%

## When to Use

- Working with code in `packages/`
- Understanding how hasCommand, run, clearRojoCommandCache work
- Modifying toolchain-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `packages/core/src/toolchain/wally-tools.ts` | requireSafeArgument, load, search, supportsLocked, state (+15) |
| `packages/core/src/quality-tools.ts` | within, allowedProjectRoot, safeExistingPath, safeOutputPath, commandFailure (+13) |
| `packages/core/src/toolchain/project-reconcile.ts` | ProjectReconciler, constructor, errorText, noWally, inspect (+13) |
| `packages/core/src/toolchain/toml.ts` | emptyTable, hasOwn, Reader, peek, startsWith (+12) |
| `packages/core/src/toolchain/rokit-tools.ts` | requireSafeTool, requireSafeSpec, install, addTool, update (+11) |
| `packages/core/src/toolchain/resolver.ts` | clearToolCommandCache, toolchainRoot, shimPath, findToolchainManifest, startDirectory (+5) |
| `packages/core/src/toolchain/manifest.ts` | fileHash, planHashOf, planHashMismatch, findManifest, readTomlFile (+2) |
| `packages/core/src/tools/index.ts` | RobloxStudioTools, getDependencyGraph |
| `packages/core/src/rojo/command-runner.ts` | clearRojoCommandCache |
| `packages/core/src/tools/setup-registry.ts` | get_dependency_graph |

## Entry Points

Start here when exploring this area:

- **`hasCommand`** (Function) — `packages/core/src/quality-tools.ts:87`
- **`run`** (Function) — `packages/core/src/quality-tools.ts:134`
- **`clearRojoCommandCache`** (Function) — `packages/core/src/rojo/command-runner.ts:42`
- **`fileHash`** (Function) — `packages/core/src/toolchain/manifest.ts:49`
- **`planHashOf`** (Function) — `packages/core/src/toolchain/manifest.ts:68`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `ProjectReconciler` | Class | `packages/core/src/toolchain/project-reconcile.ts` | 240 |
| `RokitTools` | Class | `packages/core/src/toolchain/rokit-tools.ts` | 144 |
| `WallyTools` | Class | `packages/core/src/toolchain/wally-tools.ts` | 153 |
| `RobloxStudioTools` | Class | `packages/core/src/tools/index.ts` | 260 |
| `hasCommand` | Function | `packages/core/src/quality-tools.ts` | 87 |
| `run` | Function | `packages/core/src/quality-tools.ts` | 134 |
| `clearRojoCommandCache` | Function | `packages/core/src/rojo/command-runner.ts` | 42 |
| `fileHash` | Function | `packages/core/src/toolchain/manifest.ts` | 49 |
| `planHashOf` | Function | `packages/core/src/toolchain/manifest.ts` | 68 |
| `planHashMismatch` | Function | `packages/core/src/toolchain/manifest.ts` | 75 |
| `clearToolCommandCache` | Function | `packages/core/src/toolchain/resolver.ts` | 184 |
| `parseToml` | Function | `packages/core/src/toolchain/toml.ts` | 278 |
| `findManifest` | Function | `packages/core/src/toolchain/manifest.ts` | 24 |
| `toolchainRoot` | Function | `packages/core/src/toolchain/resolver.ts` | 40 |
| `shimPath` | Function | `packages/core/src/toolchain/resolver.ts` | 44 |
| `resolveToolCommand` | Function | `packages/core/src/toolchain/resolver.ts` | 169 |
| `readTomlFile` | Function | `packages/core/src/toolchain/manifest.ts` | 15 |
| `asStringMap` | Function | `packages/core/src/toolchain/manifest.ts` | 85 |
| `loadManifest` | Function | `packages/core/src/toolchain/manifest.ts` | 37 |
| `loadPolicy` | Function | `packages/core/src/toolchain/project-reconcile.ts` | 124 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `UpdatePlan → Peek` | cross_community | 8 |
| `AddTool → Within` | cross_community | 7 |
| `AddTool → Peek` | cross_community | 7 |
| `AddTool → Stamp` | cross_community | 7 |
| `AddTool → StartDirectory` | cross_community | 7 |
| `Update → Within` | cross_community | 7 |
| `Update → Peek` | cross_community | 7 |
| `Update → Stamp` | cross_community | 7 |
| `Update → StartDirectory` | cross_community | 7 |
| `Status → Within` | cross_community | 7 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Rojo | 8 calls |
| Tools | 2 calls |
| Cluster_40 | 1 calls |

## How to Explore

1. `context({name: "hasCommand"})` — see callers and callees
2. `query({search_query: "toolchain"})` — find related execution flows
3. Read key files listed above for implementation details
4. `explain({target: "<file or symbol>"})` — persisted taint findings (source→sink data flows), when indexed with `--pdg`
