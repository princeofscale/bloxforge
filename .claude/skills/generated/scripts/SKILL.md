---
name: scripts
description: "Skill for the Scripts area of bloxforge. 44 symbols across 7 files."
---

# Scripts

44 symbols | 7 files | Cohesion: 89%

## When to Use

- Working with code in `scripts/`
- Understanding how isWsl, resolvePluginsDir, resolveStudioExe work
- Modifying scripts-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `scripts/studio-lifecycle.mjs` | isWsl, windowsLocalAppData, toWslPath, resolvePluginsDir, resolveStudioExe (+10) |
| `scripts/build-plugin.mjs` | escapeCdata, injectVersion, moduleKey, shouldPackageModule, redirectModule (+6) |
| `scripts/publish.mjs` | run, sleep, viewVersion, viewVersionWithRetry, publishIfMissing |
| `scripts/verify-package.mjs` | run, runNpm, pack, verifyRuntimeContents, verify |
| `scripts/generate-tool-docs.mjs` | schemaType, tableCell, main, normalize |
| `scripts/run-lune.mjs` | run, provisionLinuxX64 |
| `scripts/test-toolchain-integration.mjs` | run, tryRun |

## Entry Points

Start here when exploring this area:

- **`isWsl`** (Function) — `scripts/studio-lifecycle.mjs:12`
- **`resolvePluginsDir`** (Function) — `scripts/studio-lifecycle.mjs:59`
- **`resolveStudioExe`** (Function) — `scripts/studio-lifecycle.mjs:72`
- **`launchStudio`** (Function) — `scripts/studio-lifecycle.mjs:157`
- **`waitConnected`** (Function) — `scripts/studio-lifecycle.mjs:187`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `isWsl` | Function | `scripts/studio-lifecycle.mjs` | 12 |
| `resolvePluginsDir` | Function | `scripts/studio-lifecycle.mjs` | 59 |
| `resolveStudioExe` | Function | `scripts/studio-lifecycle.mjs` | 72 |
| `launchStudio` | Function | `scripts/studio-lifecycle.mjs` | 157 |
| `waitConnected` | Function | `scripts/studio-lifecycle.mjs` | 187 |
| `listStudioProcesses` | Function | `scripts/studio-lifecycle.mjs` | 99 |
| `closeAllStudio` | Function | `scripts/studio-lifecycle.mjs` | 130 |
| `escapeCdata` | Function | `scripts/build-plugin.mjs` | 62 |
| `injectVersion` | Function | `scripts/build-plugin.mjs` | 66 |
| `moduleKey` | Function | `scripts/build-plugin.mjs` | 101 |
| `shouldPackageModule` | Function | `scripts/build-plugin.mjs` | 105 |
| `redirectModule` | Function | `scripts/build-plugin.mjs` | 139 |
| `transformCompiledSource` | Function | `scripts/build-plugin.mjs` | 151 |
| `findInitFile` | Function | `scripts/build-plugin.mjs` | 171 |
| `isLuaFile` | Function | `scripts/build-plugin.mjs` | 181 |
| `dirHasLuaContent` | Function | `scripts/build-plugin.mjs` | 185 |
| `buildModuleItems` | Function | `scripts/build-plugin.mjs` | 194 |
| `countModules` | Function | `scripts/build-plugin.mjs` | 290 |
| `windowsLocalAppData` | Function | `scripts/studio-lifecycle.mjs` | 36 |
| `toWslPath` | Function | `scripts/studio-lifecycle.mjs` | 48 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `RunMismatchCase → Run` | cross_community | 5 |
| `RunMismatchCase → IsWsl` | cross_community | 5 |
| `Main → IsWsl` | cross_community | 4 |
| `Main → Run` | cross_community | 4 |
| `Main → IsWsl` | intra_community | 4 |
| `Main → Run` | cross_community | 4 |

## How to Explore

1. `context({name: "isWsl"})` — see callers and callees
2. `query({search_query: "scripts"})` — find related execution flows
3. Read key files listed above for implementation details
4. `explain({target: "<file or symbol>"})` — persisted taint findings (source→sink data flows), when indexed with `--pdg`
