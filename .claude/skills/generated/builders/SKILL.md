---
name: builders
description: "Skill for the Builders area of bloxforge. 96 symbols across 19 files."
---

# Builders

96 symbols | 19 files | Cohesion: 77%

## When to Use

- Working with code in `packages/`
- Understanding how getLightingPresetNames, buildSetTimeOfDayLuau, buildLightingPresetLuau work
- Modifying builders-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `packages/core/src/tools/index.ts` | uiCreateScreenGui, uiApplyLayout, uiMakeMobileFriendly, environmentSetTimeOfDay, environmentSetAtmosphere (+9) |
| `packages/core/src/http-server.ts` | get_scene_summary, ui_create_screen_gui, ui_apply_layout, ui_make_mobile_friendly, environment_set_time_of_day (+8) |
| `packages/core/src/builders/environment-builders.ts` | getLightingPresetNames, clampClock, buildSetTimeOfDayLuau, atmosphereLines, postFxLines (+3) |
| `packages/core/src/builders/luau-emit.ts` | luaString, luaNumber, luaBool, clampChannel, color3FromRGB (+3) |
| `packages/core/src/builders/media-builders.ts` | assetUri, wrap, buildCreateSoundLuau, buildPlaySoundLuau, buildCreateAnimationLuau (+3) |
| `packages/core/src/builders/design-builders.ts` | wrap, color3, buildApplyThemeLuau, buildDesignLintLuau, buildReviewReparentLuau (+3) |
| `packages/core/src/tools/generated-builder-tools.ts` | uiCreateScreenGui, uiApplyLayout, uiMakeMobileFriendly, environmentSetTimeOfDay, environmentSetAtmosphere (+2) |
| `packages/core/src/builders/ui-builders.ts` | wrap, enumName, buildScreenGuiLuau, buildGuiObjectLuau, buildApplyLayoutLuau (+1) |
| `packages/core/src/builders/terrain-builders.ts` | material, region3, buildBaseplateLuau, buildIslandLuau, buildPaintMaterialLuau (+1) |
| `packages/core/src/builders/recipes.ts` | str, num, proximityDoor, ambientSound, killBrick |

## Entry Points

Start here when exploring this area:

- **`getLightingPresetNames`** (Function) — `packages/core/src/builders/environment-builders.ts:68`
- **`buildSetTimeOfDayLuau`** (Function) — `packages/core/src/builders/environment-builders.ts:76`
- **`buildLightingPresetLuau`** (Function) — `packages/core/src/builders/environment-builders.ts:130`
- **`buildAtmosphereLuau`** (Function) — `packages/core/src/builders/environment-builders.ts:153`
- **`buildSkyLuau`** (Function) — `packages/core/src/builders/environment-builders.ts:171`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `getLightingPresetNames` | Function | `packages/core/src/builders/environment-builders.ts` | 68 |
| `buildSetTimeOfDayLuau` | Function | `packages/core/src/builders/environment-builders.ts` | 76 |
| `buildLightingPresetLuau` | Function | `packages/core/src/builders/environment-builders.ts` | 130 |
| `buildAtmosphereLuau` | Function | `packages/core/src/builders/environment-builders.ts` | 153 |
| `buildSkyLuau` | Function | `packages/core/src/builders/environment-builders.ts` | 171 |
| `luaString` | Function | `packages/core/src/builders/luau-emit.ts` | 6 |
| `luaNumber` | Function | `packages/core/src/builders/luau-emit.ts` | 17 |
| `luaBool` | Function | `packages/core/src/builders/luau-emit.ts` | 21 |
| `color3FromRGB` | Function | `packages/core/src/builders/luau-emit.ts` | 30 |
| `udim2` | Function | `packages/core/src/builders/luau-emit.ts` | 35 |
| `vector2` | Function | `packages/core/src/builders/luau-emit.ts` | 40 |
| `assetUri` | Function | `packages/core/src/builders/media-builders.ts` | 8 |
| `buildCreateSoundLuau` | Function | `packages/core/src/builders/media-builders.ts` | 29 |
| `buildPlaySoundLuau` | Function | `packages/core/src/builders/media-builders.ts` | 51 |
| `buildCreateAnimationLuau` | Function | `packages/core/src/builders/media-builders.ts` | 66 |
| `buildPlayAnimationLuau` | Function | `packages/core/src/builders/media-builders.ts` | 86 |
| `buildApplyTextureLuau` | Function | `packages/core/src/builders/media-builders.ts` | 115 |
| `buildGenerateModelLuau` | Function | `packages/core/src/builders/media-builders.ts` | 165 |
| `sceneSearchTerms` | Function | `packages/core/src/builders/scene-search.ts` | 20 |
| `buildSceneSearchLuau` | Function | `packages/core/src/builders/scene-search.ts` | 26 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `ReadResource → LuaString` | cross_community | 6 |
| `Handler → LuaString` | cross_community | 5 |
| `Handler → LuaNumber` | cross_community | 5 |
| `Handler → LuaBool` | cross_community | 5 |
| `DesignReview → GetInstances` | cross_community | 5 |
| `DesignReview → ResolveInstanceAlias` | cross_community | 5 |
| `ReadResource → LuaNumber` | cross_community | 5 |
| `ReadResource → LuaBool` | cross_community | 5 |
| `DesignReview → RoutingFailure` | cross_community | 4 |
| `DesignReview → _callSingle` | cross_community | 4 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Tools | 13 calls |

## How to Explore

1. `context({name: "getLightingPresetNames"})` — see callers and callees
2. `query({search_query: "builders"})` — find related execution flows
3. Read key files listed above for implementation details
4. `explain({target: "<file or symbol>"})` — persisted taint findings (source→sink data flows), when indexed with `--pdg`
