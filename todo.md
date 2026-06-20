# TODO - MCP

Roadmap for unresolved work in the MCP itself (this repo / npm packages), not games built with it.
Completed notable changes move to [CHANGELOG.md](./CHANGELOG.md).

## Architecture / maintainability

- [ ] Continue splitting `packages/core/src/tools/index.ts` into a smaller `RobloxStudioTools` facade plus domain tool classes/modules for scene, scripts, assets, runtime/playtest, diagnostics, and marketplace/media tools.
- [x] Audit schema bloat from ~120 tool definitions loading upfront. Compressed the duplicated `instance_id` description; added `tool_catalog_search` + semantic `tool-catalog.ts`; added `load_toolset` + opt-in deferred loading (`ROBLOX_MCP_LAZY_TOOLS`) in `server.ts` (stdio) with `tools/list_changed`. (Remaining: mirror deferred loading in the `http-server.ts` /mcp streamable path — currently full-catalog there.)

## World model / read pipeline

- [x] `get_changes_since(snapshotId)` — incremental changefeed (added/removed/changed nodes) so the agent doesn't re-pull the world after each action. Server-side `SnapshotStore` + fingerprint diff.

## Reliability

- [~] Extended typed-error codes (added CONFIRMATION_REQUIRED/AMBIGUOUS_TARGET/INVALID_ARGUMENT/UNSUPPORTED_CLASS/INSERT_NOT_PERMITTED/RESOURCE_TOO_LARGE/BETA_FEATURE_REQUIRED + `isRetryable` + `errorEnvelope()`). TODO: propagate the `errorEnvelope()` shape to every remaining tool error return (large mechanical sweep).

## Documentation / external validation

- [x] README: document the discover -> analyze thumbnails -> insert loop and the token-saving `fields`, `limit`, `offset`, and `get_scene_summary` workflow.
- [x] Live-verify the toolbox `items/details` response shape; tuned `parseDetails` to the real field names (`asset.typeId`, `fiatProduct.isFree`) and surfaced `isFree`/`hasScripts` on results.
- [ ] `get_asset_details` (keyed/cookie path): surface `canCopy`, `isPublicDomain`, and owner data for pre-insert checks. (The key-free pre-insert signal now comes from marketplace `isFree`.)
