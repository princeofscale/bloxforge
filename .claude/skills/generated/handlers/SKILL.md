---
name: handlers
description: "Skill for the Handlers area of bloxforge. 208 symbols across 15 files."
---

# Handlers

208 symbols | 15 files | Cohesion: 93%

## When to Use

- Working with code in `studio-plugin/`
- Understanding how ensureRuntimeBridgeInstalled work
- Modifying handlers-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `studio-plugin/src/modules/handlers/MicroProfilerHandlers.ts` | IsValid, GetDataFormatVersion, GetObjSize, FetchTimerIds, FetchThreadIds (+54) |
| `studio-plugin/src/modules/handlers/BreakpointHandlers.ts` | AddBreakpoint, RemoveBreakpoint, ClearBreakpoints, breakpointKey, readSetting (+22) |
| `studio-plugin/src/modules/handlers/ScriptProfilerHandlers.ts` | ServerStart, ServerStop, ServerRequestData, ClientStart, ClientStop (+18) |
| `studio-plugin/src/modules/handlers/TestHandlers.ts` | ExecuteMultiplayerTestAsync, AddPlayers, CanLeaveTest, LeaveTest, detectPeerRole (+12) |
| `studio-plugin/src/modules/handlers/ScriptHandlers.ts` | normalizeEscapes, updateScriptSourceVerified, setScriptSource, editScriptLines, insertScriptLines (+10) |
| `studio-plugin/src/modules/handlers/SceneAnalysisHandlers.ts` | query, betaDisabledError, isBetaDisabledError, flattenLeaves, compactEntry (+8) |
| `studio-plugin/src/modules/handlers/QueryHandlers.ts` | searchFiles, searchRecursive, searchObjects, searchByProperty, getFileTree (+7) |
| `studio-plugin/src/modules/handlers/InstanceHandlers.ts` | applyProperties, processObjectEntries, createObject, massCreateObjects, performSmartDuplicate (+5) |
| `studio-plugin/src/modules/handlers/CaptureHandlers.ts` | readLogicalViewport, doCaptureScreenshot, captureScreenshotData, captureScreenshot, captureBegin (+4) |
| `studio-plugin/src/modules/handlers/InputHandlers.ts` | SendKey, SendTextInput, getVI, CreateVirtualInput, simulateKeyboardInput |

## Entry Points

Start here when exploring this area:

- **`ensureRuntimeBridgeInstalled`** (Function) — `studio-plugin/src/modules/EvalBridges.ts:246`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `ensureRuntimeBridgeInstalled` | Function | `studio-plugin/src/modules/EvalBridges.ts` | 246 |
| `normalizeDurationMs` | Function | `studio-plugin/src/modules/handlers/MicroProfilerHandlers.ts` | 150 |
| `normalizeMaxTimers` | Function | `studio-plugin/src/modules/handlers/MicroProfilerHandlers.ts` | 155 |
| `normalizeMaxGroups` | Function | `studio-plugin/src/modules/handlers/MicroProfilerHandlers.ts` | 160 |
| `normalizeMaxTimersPerGroup` | Function | `studio-plugin/src/modules/handlers/MicroProfilerHandlers.ts` | 165 |
| `normalizeMaxRelatedTimers` | Function | `studio-plugin/src/modules/handlers/MicroProfilerHandlers.ts` | 170 |
| `normalizeMaxEvents` | Function | `studio-plugin/src/modules/handlers/MicroProfilerHandlers.ts` | 175 |
| `normalizeFrameWindow` | Function | `studio-plugin/src/modules/handlers/MicroProfilerHandlers.ts` | 180 |
| `normalizeMinTotalUs` | Function | `studio-plugin/src/modules/handlers/MicroProfilerHandlers.ts` | 185 |
| `normalizeFocus` | Function | `studio-plugin/src/modules/handlers/MicroProfilerHandlers.ts` | 190 |
| `stringContains` | Function | `studio-plugin/src/modules/handlers/MicroProfilerHandlers.ts` | 195 |
| `rawToUs` | Function | `studio-plugin/src/modules/handlers/MicroProfilerHandlers.ts` | 199 |
| `round2` | Function | `studio-plugin/src/modules/handlers/MicroProfilerHandlers.ts` | 203 |
| `perSecond` | Function | `studio-plugin/src/modules/handlers/MicroProfilerHandlers.ts` | 207 |
| `percent` | Function | `studio-plugin/src/modules/handlers/MicroProfilerHandlers.ts` | 211 |
| `ratio` | Function | `studio-plugin/src/modules/handlers/MicroProfilerHandlers.ts` | 215 |
| `copyRecord` | Function | `studio-plugin/src/modules/handlers/MicroProfilerHandlers.ts` | 226 |
| `pickFields` | Function | `studio-plugin/src/modules/handlers/MicroProfilerHandlers.ts` | 234 |
| `addFrameRaw` | Function | `studio-plugin/src/modules/handlers/MicroProfilerHandlers.ts` | 243 |
| `summarizeFrameImpact` | Function | `studio-plugin/src/modules/handlers/MicroProfilerHandlers.ts` | 248 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `EvalRuntime → GetPlayerScripts` | cross_community | 5 |
| `RemoveBreakpoint → DetectRole` | cross_community | 5 |
| `ClearAllBreakpoints → DetectRole` | cross_community | 5 |
| `ClearManagedBreakpoints → DetectRole` | cross_community | 5 |
| `BreakpointsTool → ReadSetting` | intra_community | 4 |
| `BreakpointsTool → DecodePersistedBreakpointEntry` | intra_community | 4 |
| `BreakpointsTool → BreakpointKey` | intra_community | 4 |
| `BreakpointsTool → ServiceError` | intra_community | 4 |
| `BreakpointsTool → GetService` | intra_community | 4 |
| `BreakpointsTool → LuauStringLiteral` | intra_community | 4 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Modules | 4 calls |

## How to Explore

1. `context({name: "ensureRuntimeBridgeInstalled"})` — see callers and callees
2. `query({search_query: "handlers"})` — find related execution flows
3. Read key files listed above for implementation details
4. `explain({target: "<file or symbol>"})` — persisted taint findings (source→sink data flows), when indexed with `--pdg`
