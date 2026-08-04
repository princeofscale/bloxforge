---
name: modules
description: "Skill for the Modules area of bloxforge. 118 symbols across 14 files."
---

# Modules

118 symbols | 14 files | Cohesion: 96%

## When to Use

- Working with code in `studio-plugin/`
- Understanding how secondsSinceFrame, notRenderingReason, cleanupLegacyEditBridges work
- Modifying modules-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `studio-plugin/src/modules/ClientBroker.ts` | computeInstanceId, resolvePlaceName, rememberCompletedProxyRequest, sendProxyResponse, reRegisterProxy (+14) |
| `studio-plugin/src/modules/UI.ts` | tweenProp, getStatusDotColor, createTabButton, refreshTabBar, switchToTab (+11) |
| `studio-plugin/src/modules/StopPlayMonitor.ts` | addUnique, computeInstanceIds, settingKey, settingKeys, readSetting (+9) |
| `studio-plugin/src/modules/Communication.ts` | computeInstanceId, resolvePlaceName, detectRole, processRequest, sendResponse (+7) |
| `studio-plugin/src/modules/LuauExec.ts` | computeWrapperLineOffset, countLines, luaPatternEscape, renderWrapper, buildWrapper (+7) |
| `studio-plugin/src/modules/EvalBridges.ts` | setSource, destroyIfPresent, serverRuntimeBridgeReady, getPlayerScripts, clientRuntimeBridgeReady (+5) |
| `studio-plugin/src/modules/ServerUrlSettings.ts` | normalizeServerUrl, addUnique, computeInstanceIds, settingKey, legacySettingKey (+4) |
| `studio-plugin/src/modules/RuntimeLogBuffer.ts` | levelTag, nowSec, escapeInvalidUtf8, dropOldestUntilFits, pushEntry (+2) |
| `studio-plugin/src/modules/JobRegistry.ts` | get, reportProgress, isCancelledForThread, prune, create |
| `studio-plugin/src/modules/Utils.ts` | component, toColor3, convertPropertyValue, compareVersions, parseVersion |

## Entry Points

Start here when exploring this area:

- **`secondsSinceFrame`** (Function) — `studio-plugin/src/modules/RenderMonitor.ts:38`
- **`notRenderingReason`** (Function) — `studio-plugin/src/modules/RenderMonitor.ts:47`
- **`cleanupLegacyEditBridges`** (Function) — `studio-plugin/src/modules/EvalBridges.ts:158`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `secondsSinceFrame` | Function | `studio-plugin/src/modules/RenderMonitor.ts` | 38 |
| `notRenderingReason` | Function | `studio-plugin/src/modules/RenderMonitor.ts` | 47 |
| `cleanupLegacyEditBridges` | Function | `studio-plugin/src/modules/EvalBridges.ts` | 158 |
| `addUnique` | Function | `studio-plugin/src/modules/StopPlayMonitor.ts` | 78 |
| `computeInstanceIds` | Function | `studio-plugin/src/modules/StopPlayMonitor.ts` | 84 |
| `settingKey` | Function | `studio-plugin/src/modules/StopPlayMonitor.ts` | 100 |
| `settingKeys` | Function | `studio-plugin/src/modules/StopPlayMonitor.ts` | 104 |
| `readSetting` | Function | `studio-plugin/src/modules/StopPlayMonitor.ts` | 108 |
| `writeSetting` | Function | `studio-plugin/src/modules/StopPlayMonitor.ts` | 114 |
| `decodePayload` | Function | `studio-plugin/src/modules/StopPlayMonitor.ts` | 120 |
| `writePayload` | Function | `studio-plugin/src/modules/StopPlayMonitor.ts` | 135 |
| `writeResult` | Function | `studio-plugin/src/modules/StopPlayMonitor.ts` | 141 |
| `handleStopRequest` | Function | `studio-plugin/src/modules/StopPlayMonitor.ts` | 153 |
| `startMonitor` | Function | `studio-plugin/src/modules/StopPlayMonitor.ts` | 194 |
| `requestStop` | Function | `studio-plugin/src/modules/StopPlayMonitor.ts` | 219 |
| `waitForConsumption` | Function | `studio-plugin/src/modules/StopPlayMonitor.ts` | 234 |
| `clearPending` | Function | `studio-plugin/src/modules/StopPlayMonitor.ts` | 258 |
| `computeInstanceId` | Function | `studio-plugin/src/modules/ClientBroker.ts` | 25 |
| `resolvePlaceName` | Function | `studio-plugin/src/modules/ClientBroker.ts` | 39 |
| `rememberCompletedProxyRequest` | Function | `studio-plugin/src/modules/ClientBroker.ts` | 145 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `Init → UpdateToolbarIcon` | cross_community | 6 |
| `Init → StopPulseAnimation` | cross_community | 6 |
| `Init → SetButtonConnect` | cross_community | 6 |
| `Init → SetButtonDisconnect` | cross_community | 6 |
| `Init → TweenProp` | intra_community | 5 |
| `EvalRuntime → GetPlayerScripts` | cross_community | 5 |
| `Execute → LuaPatternEscape` | intra_community | 5 |
| `Execute → UserLine` | intra_community | 5 |
| `Init → GetStatusDotColor` | intra_community | 4 |
| `EvalRuntime → ServerRuntimeBridgeReady` | cross_community | 4 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Handlers | 1 calls |

## How to Explore

1. `context({name: "secondsSinceFrame"})` — see callers and callees
2. `query({search_query: "modules"})` — find related execution flows
3. Read key files listed above for implementation details
4. `explain({target: "<file or symbol>"})` — persisted taint findings (source→sink data flows), when indexed with `--pdg`
