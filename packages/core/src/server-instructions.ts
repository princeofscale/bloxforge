// Server-wide instructions returned at MCP initialization (research review #3 /
// #7). Hosts like ChatGPT read these alongside tool metadata to understand
// cross-tool workflows and constraints — so the multi-step recipes live here once
// instead of being duplicated into every tool description.

export const SERVER_INSTRUCTIONS = `BloxForge — operate Roblox Studio over a Node bridge to a Studio plugin.

Workflow:
- Discover capabilities with tool_catalog_search when unsure. Lazy loading is the default: call load_toolset for the recommended domain(s) before using non-core tools that are not currently advertised.
- Inspect cheaply first: get_world_snapshot (overview) -> scene_search / get_node_batch for detail. Avoid dumping the whole tree.
- Refresh incrementally with get_changes_since instead of re-reading the world after each action.

Marketplace (insert real assets instead of building from scratch):
- marketplace_search -> asset_preflight_insert (authoritative LoadAssetAsync check; prefer isFree, beware hasScripts) -> insert_asset. Or marketplace_search_and_insert for the one-shot path.

Heavy Luau: use execute_luau_async + get_job_status/get_job_result (poll) instead of execute_luau to avoid connection timeouts.

Safety: destructive/bulk operations are gated — preview with dryRun, then re-run with confirm: true. Errors return a typed envelope ({ok:false, error:{code, retryable, suggestedRecovery}}); branch on code (retry TIMEOUT/RATE_LIMITED, pick another asset on AUTH, re-resolve on NOT_FOUND).

Most tools take an optional instance_id; it's only required when multiple Studio places are connected (use get_connected_instances to list them).

Tuneables (environment variables): MCP_REQUEST_TIMEOUT_MS (default 30000, floor 120000 for heavy endpoints like execute_luau), MCP_STALE_INSTANCE_MS (default 90000, grace period before a silent plugin is reaped — raise if Studio throttling is frequent).

Known platform limits (Roblox engine — cannot be worked around in code, see docs/known-limitations.md):
- require() cache by instance: editing a ModuleScript's Source does NOT invalidate Roblox's per-instance require() cache, so a subsequent require() in execute_luau returns the stale pre-edit copy. Use the built-in fresh_require(module) (clone->require->destroy) to test the edited code, or eval_*_runtime / a playtest.
- Catalog/uploaded audio (rbxassetid://) frequently fails to load in the Edit DataModel (IsLoaded=false, TimeLength=0); prefer built-in rbxasset://sounds/* assets in edit and verify real playback in a playtest.
- Sound.PlaybackLoudness is always 0 in edit (no active audio listener); only IsLoaded/IsPlaying are meaningful in edit.`;
