// Server-wide instructions returned at MCP initialization (research review #3 /
// #7). Hosts like ChatGPT read these alongside tool metadata to understand
// cross-tool workflows and constraints — so the multi-step recipes live here once
// instead of being duplicated into every tool description.

export const SERVER_INSTRUCTIONS = `RobloxStudio MCP — operate Roblox Studio over a Node bridge to a Studio plugin.

Token-lean workflow (prefer this order):
- Discover capabilities with tool_catalog_search; if a needed tool isn't listed, call load_toolset with the recommended domain(s).
- Inspect cheaply first: get_world_snapshot (overview) -> scene_search / get_node_batch for detail. Avoid dumping the whole tree.
- Refresh incrementally with get_changes_since instead of re-reading the world after each action.

Marketplace (insert real assets instead of building from scratch):
- marketplace_search -> asset_preflight_insert (authoritative LoadAssetAsync check; prefer isFree, beware hasScripts) -> insert_asset. Or marketplace_search_and_insert for the one-shot path.

Heavy Luau: use execute_luau_async + get_job_status/get_job_result (poll) instead of execute_luau to avoid connection timeouts.

Safety: destructive/bulk operations are gated — preview with dryRun, then re-run with confirm: true. Errors return a typed envelope ({ok:false, error:{code, retryable, suggestedRecovery}}); branch on code (retry TIMEOUT/RATE_LIMITED, pick another asset on AUTH, re-resolve on NOT_FOUND).

Most tools take an optional instance_id; it's only required when multiple Studio places are connected (use get_connected_instances to list them).`;
