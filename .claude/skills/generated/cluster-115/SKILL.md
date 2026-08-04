---
name: cluster-115
description: "Skill for the Cluster_115 area of bloxforge. 9 symbols across 1 files."
---

# Cluster_115

9 symbols | 1 files | Cohesion: 100%

## When to Use

- Working with code in `packages/`
- Understanding how validatePluginAsset, pluginAssetsMatch, installPluginAsset work
- Modifying cluster_115-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `packages/core/src/plugin-asset-installer.ts` | validatePluginAsset, pluginAssetsMatch, replaceValidatedTemporary, installPluginAsset, responseFor (+4) |

## Entry Points

Start here when exploring this area:

- **`validatePluginAsset`** (Function) — `packages/core/src/plugin-asset-installer.ts:28`
- **`pluginAssetsMatch`** (Function) — `packages/core/src/plugin-asset-installer.ts:42`
- **`installPluginAsset`** (Function) — `packages/core/src/plugin-asset-installer.ts:66`
- **`fetchHttpsJson`** (Function) — `packages/core/src/plugin-asset-installer.ts:131`
- **`downloadPluginAsset`** (Function) — `packages/core/src/plugin-asset-installer.ts:148`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `validatePluginAsset` | Function | `packages/core/src/plugin-asset-installer.ts` | 28 |
| `pluginAssetsMatch` | Function | `packages/core/src/plugin-asset-installer.ts` | 42 |
| `installPluginAsset` | Function | `packages/core/src/plugin-asset-installer.ts` | 66 |
| `fetchHttpsJson` | Function | `packages/core/src/plugin-asset-installer.ts` | 131 |
| `downloadPluginAsset` | Function | `packages/core/src/plugin-asset-installer.ts` | 148 |
| `replaceValidatedTemporary` | Function | `packages/core/src/plugin-asset-installer.ts` | 49 |
| `responseFor` | Function | `packages/core/src/plugin-asset-installer.ts` | 89 |
| `request` | Function | `packages/core/src/plugin-asset-installer.ts` | 96 |
| `byteLimiter` | Function | `packages/core/src/plugin-asset-installer.ts` | 118 |

## How to Explore

1. `context({name: "validatePluginAsset"})` — see callers and callees
2. `query({search_query: "cluster_115"})` — find related execution flows
3. Read key files listed above for implementation details
4. `explain({target: "<file or symbol>"})` — persisted taint findings (source→sink data flows), when indexed with `--pdg`
