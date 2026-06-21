# TODO - MCP

Roadmap for unresolved work in the MCP itself (this repo / npm packages), not games
built with it. Completed notable changes move to [CHANGELOG.md](./CHANGELOG.md).

## Next up (priority order)

### 1. Finish deferred Track F / Track H

- [ ] **Track F — MCP App (interactive UI)** for asset-insertion review and
  bulk-change approval. Host-gated: needs an MCP-Apps-capable host to render the UI.
  Revisit when the host (Cursor / Codex / ChatGPT) supports it; not verifiable here
  until then.
- [ ] **Track H — Semantic scene search (embeddings)**. The current `scene_search`
  is the lexical multi-signal version; an optional embedding index over
  name+class+tags+attrs+script-summaries would need an external/local model. Per the
  research review, do this only once evals show the lexical ceiling — so it's gated
  on the eval metrics (now runnable for free via `deepseek-v4-flash`).

### 2. Finish the domain-split of `index.ts`

The facade `RobloxStudioTools` delegates to domain classes with identical signatures
(so the schema-parity invariants hold). DONE: `GeneratedBuilderTools`, `SyncTools`,
`DiscoveryTools`, `WorldModelTools`, `SafetyTools`. REMAINING domains still inline in
the facade, to extract the same way (one PR each, keep tests green):

- [ ] `SceneReadTools` — get_file_tree, get_place_info, get_services, search_objects,
  get_instance_properties/children, search_by_property, get_class_info,
  get_project_structure, get_descendants, get_scene_summary, compare_instances,
  get_memory_breakdown, get_scene_analysis, get_selection
- [ ] `MutationTools` — create/delete/clone/duplicate, set_property/properties,
  mass_*, attributes, tags, apply_mutation_plan
- [ ] `ScriptTools` — get/set/edit/insert/delete script lines, grep,
  find_and_replace, diagnose_scripts
- [ ] `RuntimeTools` — playtest, multiplayer, eval_*, simulate_*, device/network sim,
  breakpoints, profiler, logs, screenshots, async jobs
  (execute_luau_async/get_job_*/cancel_job), playtest_sample_state,
  run_gameplay_assertions, undo/redo
- [ ] `AssetTools` — search_assets, get_asset_details/thumbnail, insert/preview/upload,
  marketplace_*, import/export rbxm, image_generate*, import_scene
- [ ] Optionally then: a declarative `registerTool(...)` + `withStandardToolPipeline`
  registry so validation/timing/envelope/outputSchema are applied by construction
  (the error envelope is already applied centrally at dispatch).

### 3. New research-prompt round

- [ ] Generate the next research-prompt → ChatGPT report → next prioritized roadmap
  (as in rounds A–G). Do this **after** the eval metrics land, so the next round is
  grounded in data, not feel.

## Other open items

- [ ] **`outputSchema` per tool.** The `structuredContent` + error-envelope halves are
  done by topology (every tool returns `structuredContent`; failures return the typed
  envelope). Remaining: declare a strict `outputSchema` per read/orchestration tool +
  client-validation testing. Deferred deliberately — a strict schema would break mixed
  clients, so it ships only with the structured-returns sweep.
- [ ] **Propagate `errorEnvelope()` to every remaining tool error return** (large
  mechanical sweep; the dispatch-level envelope already covers thrown errors).
- [ ] **Mirror deferred tool loading in the `http-server.ts` `/mcp` streamable path** —
  currently full-catalog there (stdio has `ROBLOX_MCP_LAZY_TOOLS`).
- [ ] **Headless Luau CI**: run the Luau-adjacent logic (codecs, diff, progress/cancel
  helpers, chunk planners) under a luau/lune CLI in CI. Lower ROI (our Luau is
  generated strings already verified live) but raises coverage.
- [ ] **`get_asset_details` (keyed/cookie path)**: surface `canCopy`,
  `isPublicDomain`, and owner data for pre-insert checks. (The key-free pre-insert
  signal currently comes from marketplace `isFree`.)
