# Architecture

```
                    ┌──────────────────────────────────────┐
                    │        AI Coding Agent               │
                    │  (Claude Code / Codex / Cursor /     │
                    │   Gemini / any MCP client)           │
                    └──────────────┬───────────────────────┘
                                   │
                           MCP protocol (stdio)
                                   │
                    ┌──────────────▼───────────────────────┐
                    │     BloxForge Server                 │
                    │     (Node.js / TypeScript)           │
                    │                                      │
                    │  ┌────────────────────────────────┐  │
                    │  │  Tool handlers (222 tools)     │  │
                    │  │  · Scene read / mutation       │  │
                    │  │  · Script / Luau               │  │
                    │  │  · UI / Terrain / Environment  │  │
                    │  │  · Marketplace / Assets        │  │
                    │  │  · Playtest / Debug            │  │
                    │  │  · Safety layer                │  │
                    │  │  · Sync / Backup               │  │
                    │  └────────────────────────────────┘  │
                    │             │                        │
                    │  ┌────────────────────────────────┐  │
                    │  │  Tool pipeline                 │  │
                    │  │  (structuredContent,           │  │
                    │  │   errorEnvelope,               │  │
                    │  │   MCP resources)               │  │
                    │  └────────────────────────────────┘  │
                    └──────────────┬───────────────────────┘
                                   │
                      HTTP long-poll bridge (localhost)
                                   │
                    ┌──────────────▼───────────────────────┐
                    │     Roblox Studio Plugin             │
                    │     (roblox-ts → Luau)               │
                    │                                      │
                    │  · Receives tool requests            │
                    │  · Operates the DataModel            │
                    │  · Returns results                   │
                    └──────────────┬───────────────────────┘
                                   │
                    ┌──────────────▼───────────────────────┐
                    │     Your Roblox Place                │
                    │                                      │
                    │  Workspace · ServerScriptService     │
                    │  ReplicatedStorage · StarterGui      │
                    │  Lighting · Terrain · Players        │
                    │  And everything in your place        │
                    └──────────────────────────────────────┘
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

Every tool response includes a text block, which is what every MCP client can
read. A tool that declares an `outputSchema` additionally returns
`structuredContent` for clients that consume typed object responses.

`structuredContent` is not attached to tools without an `outputSchema`. It is a
byte-for-byte copy of the text block, so attaching it everywhere charged each
response twice — measured against a live session it was 45% of the bytes, and
most tools declare no schema for a client to validate the copy against. The
compatibility direction in the MCP specification is the reverse of what that
blanket copy provided: a server returning structured content should *also* send
the serialized text, which is what the text block already is.

### Asset manifest

An asset inside a place is an opaque numeric ID: nothing in the place records
which local file produced it, with what import settings, or which version is
published. `bloxforge.assets.json` in the project root declares that identity
per logical asset, so "rebuild this on another machine" and "did the source
change since we uploaded?" become answerable questions rather than guesswork.

```json
{
  "version": 1,
  "assets": [
    {
      "assetKey": "environment/tree/pine_a",
      "source": {
        "path": "art/environment/trees/pine_a.glb",
        "sha256": "…",
        "dcc": "Blender",
        "unitScale": 1.0,
        "forwardAxis": "-Z",
        "upAxis": "Y"
      },
      "import": { "preset": "environment-static", "pivotPolicy": "base-center", "collision": "hull", "package": true },
      "materials": { "colorMap": "art/…/pine_a_color.png", "metalnessMap": null },
      "roblox": { "ownerType": "group", "ownerId": 123, "assetId": 456, "assetVersion": 7 },
      "policy": { "scriptsAllowed": false, "license": "project-owned", "maxTextureSize": 2048 }
    }
  ]
}
```

The manifest is declarative and read with the same preview-then-apply contract
as Rojo syncback: `asset_manifest_status` reports desired-versus-actual, and
`asset_manifest_plan` returns an immutable `planHash` covering the manifest
*and* the current content of every file it references — so swapping a texture
between preview and apply invalidates the preview rather than silently
publishing something nobody reviewed.

Three deliberate choices:

- **Unknown keys are rejected.** A silently ignored `pivotPolicty` typo would
  import the asset with the wrong pivot while the manifest still read correctly.
- **A damaged manifest is an error, not an empty one.** Reading it as "no assets
  declared" would report a whole library as unmanaged.
- **A material slot set to `null` differs from an absent one.** `null` declares
  "this asset has no metalness map"; absent means nobody has decided yet.

`asset_manifest_scan` bootstraps the manifest: it walks an art directory and
proposes entries, binding sibling textures to slots by filename suffix. It
distinguishes a texture named after a source whose suffix it does not recognise
from one belonging to no source at all, and never writes the manifest itself.

All three tools are local and offline. Publishing and importing are separate
Studio/Open-Cloud steps that consume a plan produced here.

## Integration packs

Third-party ecosystems — roblox-ts, Adonis, pesde, a UI library — arrive as
*packs* behind four fixed tools, not as a tool set each:

| Tool | Does |
|---|---|
| `integration_inspect` | list the registered packs, or detect one and report the evidence |
| `integration_plan` | ordered steps, each automatic or blocked, plus a `planHash` |
| `integration_apply` | run the automatic steps, re-reading each step's files first |
| `integration_validate` | the postconditions the pack declared for itself |

The catalog costs roughly 50k tokens per request in full mode. Three tools per
library would put that widening on every agent on every call, including the ones
that never touch the library, so a new pack adds a row to `integration_inspect`
rather than rows to the catalog.

`packages/core/src/integrations/pack.ts` holds the invariants once instead of
each pack re-deriving them: the plan hash covers the pack version, the request,
the steps, every file the plan depends on and every remote identity it resolved;
files are re-read immediately before the step that writes them; a step that
*decides* rather than *repairs* comes back blocked and is never run; an `unknown`
blocking check fails validation.

Each pack declares its licence, the primary source it encodes, and its effects.
`PACK_EFFECT_CEILING` bounds those effects and excludes every `studio.*` one — a
pack works on the project on disk, and reaching a place means widening the
ceiling deliberately.

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
advertised schema set only, in both directions — its `unload` releases a domain
whose schemas the session no longer needs. That set is re-sent on every request,
so it is a recurring cost rather than a one-off: the full catalog is ~49.9k
tokens, the always-on core set ~4.8k, and `runtime` alone ~13.2k. Both tools
report `approxTokens` so the choice is an informed one, and
`npm run tools:token-report -- --check` holds the core set to its budget.

Switch toolsets at phase boundaries, not per call. Tool definitions sit at the
top of the prompt-cache hierarchy — above system and messages — so changing them
invalidates the cached prefix for the entire conversation, not just the schemas
that moved. One switch between phases of work pays for itself; churn does not,
and can cost more than the schemas it frees.

Two protocol constraints bound this. `load_toolset` changes the advertised set
as a side effect of a `tools/call`, and leaves two connections with different
sets — both forbidden from MCP revision 2026-07-28 onward, which states the tool
set "MUST NOT vary per-connection or as a side effect of other requests on the
connection". Every revision the pinned SDK can negotiate (2025-11-25 and earlier)
permits it, so this is latent rather than live; `npm run protocol:compat-check`
fails the build if an SDK bump makes a forbidding revision negotiable, so the
conflict cannot arrive silently. It reads the installed SDK, so it runs in the
main CI job and `release:check` rather than in `protocol:check`, whose scripts
are dependency-free because the plugin job never installs the root packages. The fix
when it fires is to gate the dynamic path on the negotiated version — static
profile and no `listChanged` under a forbidding revision — not to delete the
check.

Authorization uses explicit effects:
`studio.read`, `studio.write`, `studio.execute`, `local.files.read`,
`local.files.write`, `local.process.execute`, `network.external`,
`assets.upload`, and `playtest.control`. Every tool declares its own effects and
none are inferred: a name pattern used to supply them, which both over-declared
(`export_rbxm` writes a local file and never reaches the network) and, more
dangerously, under-declared any new tool whose name did not match. The field is
required, so an omission is a compile error. The inspector permits only Studio
and local-file reads; the builder denies arbitrary Luau/runtime evaluation.
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

Every tool a `rokit.toml`/`aftman.toml` pins — Rojo, Wally, Selene, StyLua,
Lune, luau-lsp — resolves through one shared project-aware resolver, per
canonical project root rather than once per process.
The nearest manifest above the project selects that toolchain's installed shim;
neither manager has a `run` subcommand, so no wrapper call is synthesised. A tool
the manifest does not declare falls back to `PATH`; a tool it does declare never
does, so availability is per project rather than per machine. When a manifest pins Rojo but no shim exists, the failure names the
install step instead of falling back to an unrelated global Rojo: the resolved
command is the absolute shim path even when it is missing, so spawning it fails
with `ENOENT` rather than letting `execFile` find a bare `rojo` on `PATH`. The
manifest search stops at `BLOXFORGE_PROJECT_ROOT`. Resolution is cached per
project root and invalidated by the mtime of both the manifest and the shim, so
an external `rokit install` is picked up without a restart. A managed `rojo
serve` is ready when `/api/rojo` returns a Rojo server-info document and the
child then survives a short settle window — not when its stdout matches a banner
and not when the port merely accepts a connection. A listener that is not Rojo,
or a Rojo the managed child lost the port race to, is reported rather than
adopted; a failed start reports the tail of the process log.

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
under the project root and the directories syncback creates, minus the paths the
project itself declares off-limits through `globIgnorePaths` and
`syncbackRules.ignorePaths` — Rojo will not write to those, so they cannot need
restoring. The snapshot is deliberately not narrowed to the dry run's reported
paths: that text is not a machine contract, and a path a parse missed would be
unrecoverable after a partial failure. Partially managed projects never delete
Instances outside their Rojo roots.

Optional server-local quality adapters cover project detection, builds and
sourcemaps, `luau-analyze`, `luau-lsp`, Selene, StyLua, and Lune test scripts.
Dedicated `rokit_*` and `wally_*` tools parse `rokit.toml`, `aftman.toml`,
`wally.toml`, and `wally.lock` with a real TOML reader and expose exact package
names, versions, checksums, and dependency edges. Reads never modify a manifest;
install, add, and update are preview/confirm pairs that declare their network,
filesystem, and process effects, and every apply is pinned to the `planHash` its
plan returned — that hash covers the operation, its arguments, and the content of
the manifest and lockfile, so a concurrent edit invalidates the plan instead of
being applied unseen. Wally installs default to `--locked` so a stale
lockfile fails instead of being rewritten; `--locked` is absent from the released
Wally 0.3.2, so support is probed and the same guarantee is provided by backing
the lockfile up and restoring it if the install moved it, rather than either
downgrading quietly or refusing to run. Missing binaries are reported as unavailable and formatting
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
