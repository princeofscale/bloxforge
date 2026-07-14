# Troubleshooting

Symptom → fix mapping for the common failures. For Roblox-engine constraints
that can't be fixed in code, see [known-limitations.md](./known-limitations.md).

## Quick health check

```bash
npx -y @princeofscale/bloxforge@latest verify
```

`verify` reports plugin/server versions, protocol version, schema mode, and
recent failures. Run it first.

---

## Connection & bridge

### "Studio plugin connected, but tool calls fail / hang"

Usually the bridge dropped the instance during a transient gap and hasn't
re-registered yet. The plugin polls the server every ~0.5s and re-fires
`/ready` on recovery, so most drops self-heal within a couple of seconds.

- Bring the Studio window to the foreground — Roblox **throttles
  `HttpService:RequestAsync` when Studio is backgrounded or minimized**, which
  is the most common cause of bridge drops.
- If it persists, toggle the plugin off/on (toolbar), or run `verify`.
- As of 2.20.2 the server tolerates up to **90s** of silence before reaping a
  plugin instance (was 30s), which absorbs most throttling gaps. Tune with the
  `MCP_STALE_INSTANCE_MS` environment variable if your workflow needs more.

### "Version mismatch" banner / `protocolMismatch`

The Studio plugin and the npm package are out of sync. Reinstall and fully
restart Studio:

```bash
npx -y @princeofscale/bloxforge@latest --auto-install-plugin
```

Then **completely close and reopen Roblox Studio** (not just reload the plugin).
The plugin and server exchange protocol versions on connect; `verify` and
`/status` surface the pair so you can see exactly which side is old.

### "Request timeout after …ms"

The plugin was still working when the bridge gave up. Heavy `execute_luau`
scripts (mass builds, big scene scans) legitimately exceed the default timeout.

- For one-off heavy work, use `execute_luau_async` + `get_job_status`/`get_job_result` (poll) instead of `execute_luau`.
- Raise the floor globally with `MCP_REQUEST_TIMEOUT_MS` (ms). Heavy endpoints
  (`/api/execute-luau`, `/api/generate-build`, `/api/import-scene`) already have
  a 120s floor.

---

## Scripts & Luau

### "My `edit_script_lines` edit didn't apply" (but `get_script_source` shows the new text)

Roblox caches `require()` **per `ModuleScript` instance**, and editing `.Source`
does not invalidate that cache. So a subsequent `require()` in `execute_luau`
returns the stale pre-edit copy. Use the built-in
`_G.fresh_require(module)` (clone→require→destroy) to verify the edited code, or
run a playtest. See
[known-limitations.md → require() cache](./known-limitations.md#require-caches-by-modulescript-instance--editing-source-does-not-reload).

### Luau compile errors report the wrong line number

Errors are remapped to user-relative line numbers, but only when the code runs
through the MCP wrapper. If you bypass it, or for `loadstring` paths, line
numbers can be offset by the wrapper preamble. Re-run via `execute_luau` (not a
hand-rolled `loadstring`) to get correct line numbers.

---

## Audio

### A `Sound` with `rbxassetid://` won't play / `IsLoaded=false` in Edit

Catalog/uploaded audio frequently fails to load in the Edit DataModel (no active
audio render path + asset-permission gating). Only built-in
`rbxasset://sounds/*` assets reliably load in Edit. Verify real playback in a
playtest. See
[known-limitations.md → audio](./known-limitations.md#catalog--uploaded-audio-rbxassetid-does-not-load-in-edit).

### `Sound.PlaybackLoudness` is always `0`

In Edit there is no active audio listener, so loudness is never computed. Only
`IsLoaded`/`IsPlaying` are meaningful in Edit; judge loudness/timbre by ear in a
playtest.

---

## Marketplace & assets

### `insert_asset` / `LoadAssetAsync` fails for a catalog model

Many toolbox models are copy-locked or moderation-gated, and the
`InsertService` auth limitation is specific to model inserts (audio is a
separate constraint). Always run `asset_preflight_insert` first — it does the
authoritative `LoadAssetAsync` check and reports `isFree`/`hasScripts`/auth
status before you commit to an insert.

---

## Still stuck

- [Architecture](./architecture.md) — how the bridge routes requests.
- [Known limitations](./known-limitations.md) — engine constraints.
- Run `get_reproduction_bundle` to capture a point-in-time state snapshot for a
  bug report or handoff.
