# Architecture

```
                    ┌─────────────────────────────────────┐
                    │        AI Coding Agent               │
                    │  (Claude Code / Codex / Cursor /     │
                    │   Gemini / any MCP client)           │
                    └──────────────┬──────────────────────┘
                                   │
                           MCP protocol (stdio)
                                   │
                    ┌──────────────▼──────────────────────┐
                    │     BloxForge Server         │
                    │     (Node.js / TypeScript)            │
                    │                                      │
                    │  ┌────────────────────────────────┐  │
                    │  │  Tool handlers (130+ tools)    │  │
                    │  │  · Scene read / mutation       │  │
                    │  │  · Script / Luau               │  │
                    │  │  · UI / Terrain / Environment  │  │
                    │  │  · Marketplace / Assets        │  │
                    │  │  · Playtest / Debug            │  │
                    │  │  · Safety layer                │  │
                    │  │  · Sync / Backup               │  │
                    │  └────────────────────────────────┘  │
                    │              │                        │
                    │  ┌────────────────────────────────┐  │
                    │  │  Tool pipeline                  │  │
                    │  │  (structuredContent,            │  │
                    │  │   errorEnvelope,                │  │
                    │  │   MCP resources)                │  │
                    │  └────────────────────────────────┘  │
                    └──────────────┬──────────────────────┘
                                   │
                      HTTP long-poll bridge (localhost)
                                   │
                    ┌──────────────▼──────────────────────┐
                    │     Roblox Studio Plugin             │
                    │     (roblox-ts → Luau)               │
                    │                                      │
                    │  · Receives tool requests            │
                    │  · Operates the DataModel            │
                    │  · Returns results                   │
                    └──────────────┬──────────────────────┘
                                   │
                    ┌──────────────▼──────────────────────┐
                    │     Your Roblox Place                │
                    │                                      │
                    │  Workspace · ServerScriptService     │
                    │  ReplicatedStorage · StarterGui      │
                    │  Lighting · Terrain · Players        │
                    │  And everything in your place        │
                    └─────────────────────────────────────┘
```

## Key design decisions

### MCP over stdio

The standard MCP transport (stdio) means the server runs as a subprocess of your AI client. No network setup, no daemon management, no auth tokens for the transport layer.

### Local HTTP bridge

Inside the server, a lightweight HTTP long-poll bridge connects to the Studio plugin. This bridge runs on localhost only — no data leaves your machine. The plugin polls the bridge for requests, executes them against the DataModel, and posts results back.

### Plugin as thin executor

The Studio plugin is deliberately thin: it receives command + payload, runs it in the plugin context, and returns the result. All orchestration, safety checks, and response formatting happen in the Node server. This makes the plugin easy to update without restarting Studio (just re-run `--auto-install-plugin`).

### Safety by topology

The safety layer (dry-run, confirmation gating, backups, limits) is applied centrally at the tool dispatch level, not per-handler. Every tool automatically gets the same safety guarantees without individual opt-in.

### Dual-format output

Every tool response includes both a text block (for backward-compatible MCP clients) and `structuredContent` (for clients that support typed object responses, like Cursor and newer Claude Code versions).

## Packages

| Package | Description |
|---|---|
| `@princeofscale/bloxforge` | Main MCP server with full read/write tool set |
| `@princeofscale/bloxforge-inspector` | Read-only edition — no write tools |
| `@princeofscale/bloxforge-core` | Shared core library (tools, builders, bridge) |

## Studio bridge transport

The plugin registers with `/ready`, then prefers a WebSocket stream at
`/stream`. The Node bridge pushes queued tool requests over that stream and
the plugin returns the response on the same connection. A heartbeat refreshes
the normal instance TTL while the stream is open.

Commands carry a stable `requestId`. Delivery uses a 10-second lease: an
unacknowledged command can be delivered again with the same ID, while the
plugin acknowledges before running the handler and caches the last 500
completed results. A repeated ID returns the cached result instead of running
a mutation twice. A timeout after delivery is reported as `outcome_unknown`;
callers should use `get_request_status` before retrying. Each target DataModel
allows one mutation and four concurrent reads; a full queue returns `BUSY`.

Protocol v3 fences every delivery with the current `serverEpoch`, the assigned
plugin session, a monotonic delivery attempt, and a random lease token. A late
frame from an old WebSocket or expired lease cannot acknowledge or complete a
new attempt. A local mode-0600 journal restores queued work after process
restart; delivered or started work is restored as `outcome_unknown` and is
never replayed automatically.

The `/ready` bootstrap issues a per-plugin bearer token; subsequent plugin
poll, response, ack, disconnect, and WebSocket traffic must present it. HTTP
MCP/proxy clients can opt into a server-level token with
`BLOXFORGE_SESSION_TOKEN`.

Optional server-local quality adapters cover Rojo-style project detection,
builds and sourcemaps, `luau-analyze`, `luau-lsp`, Selene, StyLua, Lune test
scripts, and Wally metadata/install. Missing binaries are reported as
unavailable, formatting is preview-only, and Wally installation requires
explicit confirmation. CI runs both the focused transport fault matrix and a
deterministic 10,000-request benchmark that asserts stable redelivery IDs,
duplicate-result tolerance, and zero pending-request leaks.

HTTP `/poll` remains the compatibility fallback. It is used until the stream
opens and resumes after a stream error or close, so older plugin builds and
Studio installations that deny stream permissions retain the established
bridge behavior. A failed send releases the in-flight request back to the
queue rather than waiting for its timeout.
