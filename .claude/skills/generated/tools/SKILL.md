---
name: tools
description: "Skill for the Tools area of bloxforge. 781 symbols across 59 files."
---

# Tools

781 symbols | 59 files | Cohesion: 82%

## When to Use

- Working with code in `packages/`
- Understanding how run_playtest_episode, search_files, set_script_source work
- Modifying tools-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `packages/core/src/tools/index.ts` | _callSingle, searchFiles, setScriptSource, setNetworkProfile, getSimulationState (+226) |
| `packages/core/src/http-server.ts` | run_playtest_episode, search_files, set_script_source, set_network_profile, get_simulation_state (+151) |
| `packages/core/src/tools/runtime-tools.ts` | _retentionKey, _retainRuntimeLogsBeforeTeardown, _selectRetained, _readRetainedLogs, _resolveRuntime (+63) |
| `packages/core/src/tools/asset-tools.ts` | AssetTools, marketplaceSearch, marketplaceSearchAndInsert, searchAssets, getAssetDetails (+23) |
| `packages/core/src/tools/mutation-tools.ts` | MutationTools, massGetProperty, massDeleteObjects, applyMutationPlan, setProperty (+16) |
| `packages/core/src/tools/build-executor.ts` | checkLimit, validateKey, validateNumber, partFn, rpartFn (+16) |
| `packages/core/src/bridge-service.ts` | RoutingFailure, resolveInstanceAlias, routingKeyForInstance, matchingInstancesForInstanceId, resolveInstanceId (+14) |
| `packages/core/src/tools/generated-builder-tools.ts` | GeneratedBuilderTools, _uiCreate, uiCreateFrame, uiCreateTextLabel, uiCreateTextButton (+14) |
| `packages/core/src/tools/scene-read-tools.ts` | SceneReadTools, getFileTree, getInstanceProperties, getProjectStructure, getSelection (+11) |
| `packages/core/src/tools/setup-registry.ts` | detect_roblox_project, validate_script_source, format_script_preview, run_project_tests, install_wally_packages (+10) |

## Entry Points

Start here when exploring this area:

- **`run_playtest_episode`** (Function) — `packages/core/src/http-server.ts:66`
- **`search_files`** (Function) — `packages/core/src/http-server.ts:76`
- **`set_script_source`** (Function) — `packages/core/src/http-server.ts:106`
- **`set_network_profile`** (Function) — `packages/core/src/http-server.ts:124`
- **`get_simulation_state`** (Function) — `packages/core/src/http-server.ts:127`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `RoutingFailure` | Class | `packages/core/src/bridge-service.ts` | 83 |
| `PollinationsClient` | Class | `packages/core/src/image-client.ts` | 21 |
| `MarketplaceClient` | Class | `packages/core/src/marketplace-client.ts` | 66 |
| `OpenCloudClient` | Class | `packages/core/src/opencloud-client.ts` | 126 |
| `QualityTools` | Class | `packages/core/src/quality-tools.ts` | 176 |
| `RobloxCookieClient` | Class | `packages/core/src/roblox-cookie-client.ts` | 26 |
| `RojoTools` | Class | `packages/core/src/rojo/rojo-tools.ts` | 61 |
| `SafetyManager` | Class | `packages/core/src/safety/safety-manager.ts` | 215 |
| `SessionRecorder` | Class | `packages/core/src/session-recorder.ts` | 19 |
| `StudioInstanceManager` | Class | `packages/core/src/studio-instance-manager.ts` | 356 |
| `SyncManager` | Class | `packages/core/src/sync/sync-manager.ts` | 41 |
| `AssetTools` | Class | `packages/core/src/tools/asset-tools.ts` | 31 |
| `DiscoveryTools` | Class | `packages/core/src/tools/discovery-tools.ts` | 9 |
| `EpisodeStore` | Class | `packages/core/src/tools/episode-store.ts` | 21 |
| `GeneratedBuilderTools` | Class | `packages/core/src/tools/generated-builder-tools.ts` | 61 |
| `MutationTools` | Class | `packages/core/src/tools/mutation-tools.ts` | 26 |
| `RuntimeTools` | Class | `packages/core/src/tools/runtime-tools.ts` | 94 |
| `SafetyTools` | Class | `packages/core/src/tools/safety-tools.ts` | 13 |
| `SceneReadTools` | Class | `packages/core/src/tools/scene-read-tools.ts` | 23 |
| `ScriptTools` | Class | `packages/core/src/tools/script-tools.ts` | 23 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `Handler → ClassifyDomain` | cross_community | 6 |
| `Handler → Within` | cross_community | 6 |
| `Handler → IsRojoProjectFile` | cross_community | 6 |
| `Handler → CanonicalCandidate` | cross_community | 6 |
| `Handler → ParseJsonc` | cross_community | 6 |
| `Handler → DeriveProjectName` | cross_community | 6 |
| `Handler → StringList` | cross_community | 6 |
| `CaptureDeviceMatrix → ResolveInstanceAlias` | intra_community | 6 |
| `CaptureDeviceMatrix → GetInstances` | intra_community | 6 |
| `ReadResource → LuaString` | cross_community | 6 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Builders | 29 calls |
| Rojo | 24 calls |
| Cluster_12 | 9 calls |
| Toolchain | 8 calls |
| Cluster_110 | 6 calls |
| Cluster_114 | 4 calls |
| Cluster_8 | 3 calls |
| Cluster_122 | 2 calls |

## How to Explore

1. `context({name: "run_playtest_episode"})` — see callers and callees
2. `query({search_query: "tools"})` — find related execution flows
3. Read key files listed above for implementation details
4. `explain({target: "<file or symbol>"})` — persisted taint findings (source→sink data flows), when indexed with `--pdg`
