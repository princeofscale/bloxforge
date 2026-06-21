# TODO - MCP

Roadmap for unresolved work in the MCP itself (this repo / npm packages), not games
built with it. Completed notable changes move to [CHANGELOG.md](./CHANGELOG.md).

## Next up (priority order)

### 1. Finish deferred Track F / Track H

- [ ] **Track F — MCP App (interactive UI)** for asset-insertion review and
  bulk-change approval. Host-gated: needs an MCP-Apps-capable host to render the UI.
  Revisit when the host (Cursor / Codex / ChatGPT) supports it; not verifiable here
  until then.
- [~] **Track H — Semantic scene search (embeddings)** — **PARKED (data-gated)**. The
  first real A/B eval (2026-06-21, deepseek-v4-flash) showed the bottleneck is upfront
  schema tokens (lazy loading cut bootstrap tax 77%, no success regression), NOT
  lexical-search recall. So embeddings aren't justified by data. **Trigger to revisit:**
  an eval where lexical `scene_search` measurably misses (low recall on "where is X")
  — only then build the embedding index over name+class+tags+attrs+script-summaries.

### 2. Finish the domain-split of `index.ts`

The facade `RobloxStudioTools` delegates to domain classes with identical signatures
(so the schema-parity invariants hold). DONE: `GeneratedBuilderTools`, `SyncTools`,
`DiscoveryTools`, `WorldModelTools`, `SafetyTools`, `SceneReadTools`. REMAINING domains
still inline in the facade, to extract the same way (one PR each, keep tests green):

- [x] `SceneReadTools` — get_file_tree, get_place_info, get_services, search_objects,
  get_instance_properties/children, search_by_property, get_class_info,
  get_project_structure, get_descendants, get_scene_summary, compare_instances,
  get_memory_breakdown, get_scene_analysis, get_selection (extracted; index.ts −192
  lines; multi-peer reads share a `_fanOutRead` helper). search_files left inline.
- [x] `ScriptTools` — get/set/edit/insert/delete script lines, grep,
  find_and_replace, diagnose_scripts (extracted; index.ts −171 lines;
  set_script_source keeps its gate + backup-before-overwrite via injected runtime fns).
- [x] `MutationTools` — set/mass set+get property, create/mass-create/delete/clone/
  smart+mass duplicate, attributes, tags, bulk_set_attributes, apply_mutation_plan
  (extracted; index.ts −242 lines; bulk/destructive ops keep safetyGate + history).
- [x] `AssetTools` — search_assets, get_asset_details/thumbnail, insert/preview/upload,
  marketplace_*, import/export rbxm, image_generate*, import_scene, and all build-library
  methods (exportBuild, createBuild, generateBuild, importBuild, listLibrary, getBuild,
  searchMaterials, importScene). Extracted into `asset-tools.ts` (720 lines); index.ts
  −1129 lines. Includes all private helpers (normalizePalette, normalizeBuildParts,
  computeBounds, findLibraryPath, _generateImageToFile, resolveImageId). Dogfooded
  after extraction — all 419 tests pass.
- [~] `RuntimeTools` — playtest, multiplayer, eval_*, simulate_*, device/network sim,
  breakpoints, profiler, logs, screenshots, async jobs
  (execute_luau_async/get_job_*/cancel_job), playtest_sample_state,
  run_gameplay_assertions, undo/redo. **DEFERRED** — biggest + most stateful domain
  (image capture/encoding helpers, job registry, peer routing via `_resolveRuntime`);
  also has the most ComplexBridgeService/shared-helper coupling — needs careful
  extraction beyond the standard pattern. Planned for v2.20.0.
- [x] **Declarative `ToolRegistry` + `defineTool()` + `withStandardToolPipeline`.** New
  `tool-pipeline.ts` provides `defineTool()` (keeps schema + handler + pipeline
  together), `ToolRegistry` (mutable registry with lazy mode), and the standard
  execution pipeline (structuredContent + error envelope + RoutingFailure handling).
  First-wave contracted tools (tool_catalog_search, load_toolset, get_world_snapshot,
  get_node_batch, get_changes_since, scene_search, asset_preflight_insert,
  playtest_sample_state, run_gameplay_assertions, apply_mutation_plan, list_recipes,
  apply_recipe) registered via `registerContractedTools()` in `setup-registry.ts`.
  Both `server.ts` and `http-server.ts` dispatch through the registry first, falling
  back to `TOOL_HANDLERS` for non-migrated tools.

### 3. New research-prompt round

- [x] Wrote `research-prompt.md` (round 4) — grounded in the first eval datapoint
  (lazy −77% bootstrap), with explicit questions on making `evals/` decision-grade,
  whether to un-park Track F/H, and the next frontier. Paste into ChatGPT → next
  prioritized roadmap.

## Other open items

- [x] **First-wave `outputSchema` contracts.** Stable read/orchestration tools now
  publish strict output schemas and have representative schema conformance tests.
  Remaining broader sweep: mutation/runtime/client-coupled tools whose outputs are
  still host- or Roblox-state-dependent.
- [x] **Propagate `errorEnvelope()` to every remaining tool error return.** Converted
  raw `{ content: [{ text: JSON.stringify({error:...}) }] }` returns to `toolErrorResult()`
  in `exportRbxm`, `importRbxm`, `getAssetDetails`, `marketplaceSearch`,
  `imageGenerate`/`imageGenerateAndUpload`, `captureScreenshot`, `getScriptSource`,
  and `environmentSetLightingPreset`. Dispatch-level catch still covers thrown errors.
- [x] **Mirrored deferred tool loading in `http-server.ts` `/mcp` streamable path.** The
  `ListTools` handler now uses the `ToolRegistry` (which respects lazy mode) when
  available, instead of a static filtered list. `listChanged` capability is advertised
  when lazy mode is active.
- [ ] **Headless Luau CI**: run the Luau-adjacent logic (codecs, diff, progress/cancel
  helpers, chunk planners) under a luau/lune CLI in CI. Lower ROI (our Luau is
  generated strings already verified live) but raises coverage.
- [x] **`get_asset_details` (keyed/cookie path)**: now normalizes responses from both
  the OpenCloud and cookie auth paths into a structured shape with `creatorName`,
  `creatorId`, `isCopyLocked`, `isPublicDomain`, `price`, `voting`, and `assetTypeId`.
  Returns a `hint` pointing to `asset_preflight_insert` for authoritative insertability.
