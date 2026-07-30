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

Inside the server, a lightweight HTTP bridge connects to the Studio plugin.
It binds to loopback by default. Binding beyond loopback is fail-closed unless
`BLOXFORGE_SESSION_TOKEN` is configured. The plugin polls the bridge for
requests, executes them against the DataModel, and posts results back.

### Plugin as thin executor

The Studio plugin is deliberately thin: it receives command + payload, runs it
in the plugin context, and returns the result. All orchestration, safety checks,
and response formatting happen in the Node server. `--install-plugin` validates
the downloaded or bundled variant and version before an atomic replacement;
ordinary builds never install unless `MCP_PLUGINS_DIR` is explicitly set.
Fully restart Studio after an update so every DataModel loads the same build.

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
a mutation twice. Requests move through `queued → delivered → started`, then
one terminal state: `completed`, `failed`, `timed_out`, `cancelled`, or
`outcome_unknown`. Queued/read timeouts are `timed_out`; only delivered or
started mutations can become `outcome_unknown`. Callers should use
`get_request_status` before retrying an unknown mutation. Each target DataModel
allows one mutation and four concurrent reads; a full queue returns `BUSY`.

Protocol v3 fences every delivery with the current `serverEpoch`, the assigned
plugin session, a monotonic delivery attempt, and a random lease token. A late
frame from an old WebSocket or expired lease cannot acknowledge or complete a
new attempt. A local mode-0600 journal restores queued work after process
restart; delivered or started work is restored as `outcome_unknown` and is
never replayed automatically. Active statuses survive journal compaction;
terminal statuses and completion receipts are bounded by age and count.

Proxy subprocesses authenticate `/proxy`, `/instances`, status lookup, and
cancellation with the configured server token. A proxy supplies the primary
request ID before waiting, so an uncertain transport timeout still returns an
ID that `get_request_status` can query. Instance refreshes have a timeout,
cannot overlap, and discard an ancient cache.

The `/ready` bootstrap issues a per-plugin bearer token; subsequent plugin
poll, response, ack, reconcile, disconnect, and WebSocket traffic must present
it. `/proxy`, `/instances`, cancellation, request-status, `/mcp`, and legacy
`/mcp/*` are server-client routes and require the configured server bearer
token. Local diagnostics expose only payload-free summaries and become
authenticated when a server token is configured. Machine-control requests are
JSON-only and reject browser origins.

Lazy discovery and authorization are separate. `load_toolset` changes the
advertised schema set only. Authorization uses explicit effects:
`studio.read`, `studio.write`, `studio.execute`, `local.files.read`,
`local.files.write`, `local.process.execute`, `network.external`,
`assets.upload`, and `playtest.control`. The inspector permits only Studio and
local-file reads; the builder denies arbitrary Luau/runtime evaluation.
Capability allowlists apply independently to stdio and token-identified HTTP
clients. The legacy read/write category remains protocol metadata, not the
permission boundary.

The Rojo adapter treats local files as the source of truth. Project discovery
accepts arbitrary nested `*.project.json` and `*.project.jsonc` files and
requires explicit selection when ambiguous; a project without a `name` field
derives one exactly as Rojo does. The installed Rojo CLI remains authoritative
for project-tree validation, builds, included projects, sync rules, and
sourcemaps. One managed, loopback-only `rojo serve` process may run per
canonical project. Sourcemap IDs, not raw Instance names, provide the preferred
file/Instance mapping, and Instance paths may be supplied as unambiguous
segments instead of a dotted string.

The Rojo command is resolved per canonical project root, not once per process.
A `rokit.toml` or `aftman.toml` above the project selects that toolchain's
installed shim; neither manager has a `run` subcommand, so no wrapper call is
synthesised. When a manifest pins Rojo but no shim exists, the failure names the
install step instead of silently falling back to an unrelated global Rojo.
Resolution is cached per project root and invalidated by the manifest's mtime.

Reverse synchronization is explicit: planning reads bounded, paginated script
metadata/source through `/api/read-managed-scripts`; applying requires
confirmation, the `planHash` from the preview, optimistic baselines, atomic
writes, and backups. Every plan hash covers the reported operations, the Studio
identity of each mapped script, and the current hash of each local file, so an
edit between preview and apply invalidates it. Hash-only state lives under
`.bloxforge/`; a damaged state file fails closed and must be quarantined with an
explicit baseline reset rather than silently re-read as "never synced".
Instance names that no portable file name can represent are reported, never
encoded. Native Rojo `syncback` is feature-detected and guarded by the same
preview/confirmation contract; its recovery snapshot covers every regular file
under the project root and the directories syncback creates. Partially managed
projects never delete Instances outside their Rojo roots.

Optional server-local quality adapters cover project detection, builds and
sourcemaps, `luau-analyze`, `luau-lsp`, Selene, StyLua, and Lune test scripts.
Dedicated `rokit_*` and `wally_*` tools parse `rokit.toml`, `aftman.toml`,
`wally.toml`, and `wally.lock` with a real TOML reader and expose exact package
names, versions, checksums, and dependency edges. Reads never modify a manifest;
install, add, and update are preview/confirm pairs that declare their network,
filesystem, and process effects. Wally installs default to `--locked` so a stale
lockfile fails instead of being rewritten; `--locked` is absent from the released
Wally 0.3.2, so support is probed and a locked install is refused rather than
quietly downgraded. Missing binaries are reported as unavailable and formatting
is preview-only. All file arguments resolve through the canonical project
root, command time/output are bounded, and temporary validation files are always
removed. CI runs both the focused transport fault matrix and a
deterministic 10,000-request benchmark that asserts stable redelivery IDs,
duplicate-result tolerance, and zero pending-request leaks.

HTTP `/poll` remains the compatibility fallback. It is used until the stream
opens and resumes after a stream error or close, so older plugin builds and
Studio installations that deny stream permissions retain the established
bridge behavior. A failed send releases the in-flight request back to the
queue rather than waiting for its timeout.
