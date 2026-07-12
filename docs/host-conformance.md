# Host conformance & capability matrix

What this MCP server advertises, and how each protocol feature behaves across the two
transports and the common hosts. Track G of the round-5 roadmap (reliability surface).

## Transports

| Transport | Entry | Notes |
|---|---|---|
| **stdio** | `packages/robloxstudio-mcp/src/index.ts` → core `server.ts` | The path Claude Code / Cursor use. Persistent connection — full subscription support. |
| **Streamable HTTP** | `POST /mcp` (port 58741) | Stateless (`sessionIdGenerator: undefined`): a fresh server per request, closed on response. |

## Capabilities advertised

- `tools` — `{ listChanged: true }` in default lazy-loading mode.
- `resources` — `{ subscribe: true, listChanged: true }` on both transports.

## Lazy tool loading (default ON)

Lazy mode is the primary path: the server advertises core + meta tools first, then
`tool_catalog_search` + `load_toolset` pull in domains and emit
`notifications/tools/list_changed`. Set `ROBLOX_MCP_LAZY_TOOLS=0` / `false` / `off`
only for hosts that require the full schema set upfront. `/health` and `doctor`
report the current schema mode, active tool count, and loaded core state.

## Resources plane (`roblox://…`)

| URI | Backing |
|---|---|
| `roblox://world/snapshot{?view}` | `get_world_snapshot` |
| `roblox://node/{path}` | `get_node_batch` |
| `roblox://world/changes{?since}` | `get_changes_since` |
| `roblox://playtest/episode/{id}` | stored `run_playtest_episode` result |
| `roblox://playtest/episodes` | newest-first episode index |
| `roblox://repro/bundle` | `get_reproduction_bundle` |

### Subscriptions

- **stdio:** `resources/subscribe` is honoured. When `run_playtest_episode` stores a new
  episode, the server pushes `notifications/resources/list_changed` and, for any
  subscribed `roblox://playtest/episode/{id}` or `roblox://playtest/episodes` URI,
  `notifications/resources/updated`. So an agent can react without polling.
- **Streamable HTTP:** `subscribe`/`unsubscribe` are accepted for protocol conformance
  but are no-ops — the transport is stateless, so there is no persistent channel to push
  `updated` over. Re-read the resource instead.

## Tool-risk annotations

Every tool advertises MCP `annotations` so a host can drive approval UX:

- `readOnlyHint` — `true` for `category:'read'`, `false` for writes.
- `destructiveHint` — `true` for the explicit destructive set (delete/clear/overwrite/
  bulk/import/reset) — see `tools/tool-shape.ts`. The server-side dry-run/confirm safety
  gate still guards these regardless of host behaviour.
- `openWorldHint` — `true` for tools that reach an external service (marketplace, Creator
  Store, asset CDN, image generation).

Annotations are advisory; a host should treat them as untrusted unless the server is
trusted (this one runs locally under the user's own Studio, so it is).

## Multi-place / multi-instance routing

Most tools take an optional `instance_id`. It is **required only when more than one Studio
place is connected** — otherwise the single connected place is used. Discover places with
`get_connected_instances`; routing failures return the full instance list in `data.instances`
so the agent can recover by picking one without an extra round-trip. The schema-parity test
(`__tests__/tool-schema.test.ts`) enforces that every non-agnostic tool exposes `instance_id`
in schema + handler + method signature, so routing stays consistent as tools are added.

## Per-host status

Verified = exercised live; Expected = standard MCP feature, not separately dogfooded here.

| Feature | Claude Code (stdio) | Cursor (stdio) | Codex / ChatGPT (HTTP) |
|---|---|---|---|
| Tool calls | Verified | Expected | Expected |
| Lazy `load_toolset` | Default | Default | Default |
| Resources read | Verified | Expected | Expected |
| Resource subscribe/push | Expected (stdio) | Expected (stdio) | N/A (stateless) |
| Tool annotations | Expected | Expected | Expected |
| Multi-place routing | Verified | Expected | Expected |
