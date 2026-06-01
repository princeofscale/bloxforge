# tests/

Integration tests that drive a live `@chrrxs/robloxstudio-mcp` subprocess via
stdio MCP, exercising real Studio behavior through the plugin. Each test
spawns its own subprocess and is responsible for cleaning up any playtest
state it starts.

## Prerequisites

1. **Roblox Studio open** with the project's plugin installed and connected
   (toolbar icon green or yellow, not red).
2. **A primary MCP subprocess listening on `localhost:58741`** with the
   plugin polling it. The simplest way: keep Claude Code (or any MCP client
   configured against this server) running — its subprocess will hold the
   port. Tests spawn additional subprocesses that enter **proxy mode** and
   forward through the primary, which is exactly the path several of these
   tests need to exercise.
3. **The built dist** at `packages/robloxstudio-mcp/dist/index.js` —
   `npm run build` if it's stale. If you've also changed plugin code, fully
   restart Studio so it picks up the new `.rbxmx`.
4. **`HttpEnabled = true`** in Studio Experience Settings (Security tab).

## Run

```bash
# All tests, sequential
node tests/run-all.mjs

# Or one at a time
node tests/eval-bridge-error-preservation.mjs
node tests/execute-luau-error-preservation.mjs
node tests/proxy-mode-peer-fanout.mjs
node tests/execute-luau-output-capture.mjs
```

Each test prints `✅ PASSED` or `❌ FAILED` plus the failing assertion. On
failure the test's MCP subprocess stderr tail is dumped for context.

## What each test exercises

| File | What it checks |
|---|---|
| `eval-bridge-error-preservation.mjs` | `eval_server_runtime` surfaces the actual user error (not Roblox's generic `"Requested module experienced an error while loading"` wrapper) for explicit `error(...)` and nil-deref cases, plus success-path return values |
| `execute-luau-error-preservation.mjs` | `execute_luau target=server` surfaces user error messages without leaking plugin-internal paths (e.g. `MCPPlugin.modules.handlers.MetadataHandlers:<line>`), with `target=edit` as the working baseline |
| `proxy-mode-peer-fanout.mjs` | `get_runtime_logs target=all`, `get_connected_instances`, and `get_memory_breakdown target=all` return non-empty results when invoked from a proxy-mode subprocess (the multi-session path) |
| `execute-luau-output-capture.mjs` | `execute_luau target=server` captures user `print()` and `warn()` calls in the response `output` array, matching the `target=edit` baseline |
| `multiplayer-test-lifecycle.mjs` | `multiplayer_test_start`, add-player, client-leave, state, and end-test flow against real StudioTestService multiplayer peers |

## Lifecycle and cleanup

- Most tests call `start_playtest` once at the top and `stop_playtest` in a
  `finally` block. The multiplayer lifecycle test uses `multiplayer_test_*`
  tools and falls back to `stop_playtest` for cleanup if interrupted.
- Tests do not modify the place's persistent state — they only print, eval,
  and read from the runtime log buffer.

## Layout

- `lib/mcp-client.mjs` — shared utility for spawning + driving subprocesses
  via stdio JSON-RPC, plus minimal assertion helpers.
- `<feature>.mjs` — one test file per concern, each runnable directly with
  `node`.
- `run-all.mjs` — runs every test sequentially.
