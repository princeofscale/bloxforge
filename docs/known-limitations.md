# Known limitations

Source of truth for current BloxForge limitations and Roblox-engine edge
cases that cannot be worked around in plugin/server code. Each entry lists the
**symptom**, the **root cause**, and the **working path**.

> These are platform (Roblox engine / Studio) constraints surfaced during
> dogfooding, not MCP bugs. Bug-level issues live in the git history and
> [CHANGELOG.md](../CHANGELOG.md).

---

## Scripts & Luau

### `require()` caches by ModuleScript instance — editing `Source` does not reload

- **Symptom.** You edit a `ModuleScript` with `edit_script_lines` /
  `set_script_source`, then in the next `execute_luau` call `require()` the same
  module. The old source runs — the edit looks like it "didn't apply", even
  though `get_script_source` shows the new text.
- **Example.** Moving a coffee-shop NPC: edited the cashier module's `z` from
  `12` to `9.5`, but `execute_luau` still built the NPC at `z=12` from the cached
  pre-edit module.
- **Root cause.** Roblox caches `require()` **per `ModuleScript` instance**.
  Mutating `.Source` is an edit-time change; it does **not** invalidate the
  engine's runtime require cache, so the same instance returns its previously
  cached return value. The MCP plugin does not add any caching of its own.
- **Working path.**
  1. **`fresh_require(module)`** — a built-in helper available inside every
     `execute_luau` / `execute_luau_async` call. It clones the module under
     `Workspace` (a new instance identity → no cache hit), requires the clone,
     then `Destroy()`s it. Use it instead of `require(module)` when you have just
     edited that module:
     ```lua
     local M = _G.fresh_require(game.ServerScriptService.CashierConfig)
     print(M.SpawnZ)  -- reflects the latest Source edit
     ```
  2. **`eval_server_runtime` / `eval_client_runtime`** — run the probe in the
     live game Script/LocalScript VM, which shares the running game's require
     cache (requires a playtest).
  3. **Playtest** — start a playtest to exercise the real module end-to-end.

#### `fresh_require()` caveats — it is a verification tool, not a drop-in `require()`

`fresh_require(module)` clones the module and requires the clone, which has three
consequences. Reach for it to **verify freshly edited code**; do not use it as a
general replacement for `require()`:

- **Different table identity.** The returned module table is a brand-new instance,
  not the one the live game scripts hold. So `fresh_require(M) == fresh_require(M)`
  is `false`, and singleton/stateful modules get a fresh empty state each call.
  Code that compares module identity or relies on shared singleton state will
  behave differently than under plain `require()`.
- **Nested `require()` inside the module is NOT fresh.** If the cloned module does
  `require(Child)`, that nested call still resolves against the engine's existing
  per-instance cache for `Child` — only the top-level module is fresh. To see
  edits to a dependency, edit and `fresh_require()` that dependency directly too.

> The earlier `bugs.md` reference note ("library audio loads in Edit,
> `IsLoaded=true`") was inaccurate and has been removed. This page is the
> canonical reference.

---

## Audio

### Catalog / uploaded audio (`rbxassetid://`) does not load in Edit

- **Symptom.** A `Sound` with `SoundId = "rbxassetid://…"` (e.g. a catalog
  air-hiss asset) stays `IsLoaded=false`, `TimeLength=0` in the Edit DataModel.
  Only built-in `rbxasset://sounds/*` assets load reliably in Edit.
- **Root cause.** The Edit DataModel has no active audio render path and is
  subject to asset-permission gating — the same constraint class that blocks
  catalog/model inserts in a session. This is a Roblox/Studio limitation, not an
  MCP issue.
- **Working path.** Use built-in `rbxasset://sounds/*` assets for in-Edit
  prototyping, and verify real playback / `TimeLength` of catalog audio in a
  **playtest**.
- **Useful built-in broadband noise assets** (found during dogfooding):
  - `rbxasset://sounds/action_falling.mp3` — ~10 s, wind-like (good base for a
    "pshh"/hiss effect).
  - `rbxasset://sounds/action_swim.mp3` — ~4.88 s, water-like.

### `Sound.PlaybackLoudness` is always `0` in Edit

- **Symptom.** `Sound.PlaybackLoudness` reads `0` in Edit even when
  `IsPlaying=true`.
- **Root cause.** Edit has no active audio listener / render, so loudness is
  never computed.
- **Working path.** In Edit, only `IsLoaded` and `IsPlaying` are meaningful.
Judge actual audibility, timbre, and loudness **by ear in a playtest**
  (`start_playtest` + `playtest_sample_state` with the `audio` domain).

---

## Runtime and bridge timing

- A regular playtest keeps ticking between MCP calls; it is not paused while an
  agent reasons. Gate short-lived states inside `eval_server_runtime`, or start
  an async job/monitor and poll it instead of relying on consecutive snapshots.
- `eval_server_runtime` and `eval_client_runtime` have a roughly 30-second
  request window. Keep synchronous waits below 25 seconds; use `_G` state plus
  several short polls, or `execute_luau_async`, for longer work. A timed-out eval
  may still finish and apply side effects.
- Server and client evals run in different Luau VMs, so their `_G` tables are
  intentionally separate. Share observations through replicated Instances or
  Attributes.
- `Instance:GetDebugId()` is security-gated in game VMs. Key monitor tables by
  the Instance object itself.
- Regular play sessions use shared `LogService`, so peer attribution is not
  reliable. `get_runtime_logs` exposes this as
  `peerAttribution="unavailable_shared_logservice"`; guaranteed peer labels
  require a StudioTestService multiplayer run.

## Rojo and reverse synchronization

- BloxForge does not implement a second continuous two-way sync engine. Local
  files remain authoritative and `rojo serve` carries them into Studio.
- Reverse sync is explicit and conflict-aware. Stable Rojo versions without
  native `syncback` receive only the bounded managed-script subset available
  through the plugin; models, properties, and arbitrary unmanaged Instances are
  not blindly dumped to disk.
- Multi-file native syncback creates a recovery snapshot, but external changes
  made concurrently after planning can still produce a conflict. Re-run the
  plan instead of forcing an overwrite. The snapshot is bounded to 5,000 files
  and 100 MiB; a larger project root is refused rather than partially covered.
- `rojo sourcemap` emits only `Script`, `LocalScript`, and `ModuleScript` unless
  `includeNonScripts` is set, so `rojo_resolve_instance_source` cannot resolve a
  folder, model, or value Instance from a default sourcemap.
- Rojo documents `name` as optional since 7.4.1, but Rojo 7.7.0 only implements
  the fallback for `default.project.json`. Building any other project file
  without a `name` crashes the CLI, so keep an explicit `name` on non-default
  project files.
- Studio Instance names containing characters no portable file name can hold
  (`< > : " / \ | ? *`, control characters, trailing dots or spaces, Windows
  reserved names) are reported as unsupported. Rojo does not decode an escaped
  form, so writing one would rename the Instance on the next `rojo serve`.
- A rename is only inferred when exactly one added file carries the removed
  file's baseline content. Two identical scripts are reported as ambiguous
  instead of moving an arbitrary one.
- Partially managed projects intentionally leave Studio Instances outside the
  project tree untouched.

## Toolchain (Rokit, Wally)

- **Version requirements are matched, not solved.** `wally_validate_lock`
  understands an exact version, a caret or tilde range, and a partial `1.2`
  prefix. Anything else is reported under `unverifiable` rather than treated as
  satisfied, and makes `ok` false.
- **`rokit_install` needs `allowPinnedToolDownloads: true` to run
  unattended.** Rokit asks for trust before downloading a source it has not
  seen, and there is no terminal here. The flag is refused unless every tool in
  the manifest is pinned to an exact `owner/repo@x.y.z`.
- **The real Rokit and Wally CLIs are exercised nightly on Windows and macOS**,
  not on every pull request. A per-PR failure specific to those platforms
  surfaces the next night, or on a commit whose message contains
  `[toolchain-matrix]`.

## Managed `rojo serve`

- Processes are tracked in memory only. There is no supervisor: a crashed Rojo
  is not restarted, an existing `rojo serve` cannot be adopted after a BloxForge
  restart, and the status stays `exited` until something asks.
- Readiness is a `/api/rojo` handshake against the managed child, so a port
  taken by another Rojo between the free-port check and the child's own bind is
  reported rather than adopted. A *non-Rojo* listener on that port simply looks
  like a server that never became ready.
- There is no restart backoff, no on-disk process lease, and no persisted
  runtime state, so nothing survives a BloxForge restart to be re-adopted. An
  agent that wants a long-lived serve has to re-establish it and handle the
  crash case itself.

## Orchestration

There is no single "get this project into a working state" tool. Detecting the
project, installing the toolchain, installing Wally packages, starting `rojo
serve`, and reconciling Studio against the filesystem are separate tools that an
agent sequences itself, and there is no policy block that says which of those
steps may run unattended. `verify --project <dir> --json` reports `nextAction`
to drive that sequence, but it does not perform it.

## Legacy tools

`install_wally_packages`, `generate_rojo_sourcemap`, `build_rojo_project` and
`resolve_instance_source_file` are deprecated wrappers over the canonical
implementations. They apply the same lock policy, output-path validation and
project selection, and every response carries `deprecated: true` with the tool
to use instead. They are no longer in the always-on core set.

`sync_pull`, `sync_status` and `sync_push` remain deprecated and still take only
`dryRun`/`confirm`; they do not require the `expectedPlanHash` that
`rojo_syncback_apply` enforces.

| Legacy | Use instead |
|---|---|
| `install_wally_packages` | `wally_install_plan` → `wally_install_apply` |
| `generate_rojo_sourcemap` | `rojo_generate_sourcemap` |
| `build_rojo_project` | `rojo_build_project` |
| `resolve_instance_source_file` | `rojo_resolve_instance_source` |
| `sync_pull` / `sync_push` | `rojo_syncback_plan` → `rojo_syncback_apply` |

## Script diagnostics and output

- `diagnose_scripts` reads the current output buffer; a ModuleScript compile
  error cannot appear until that module is actually loaded. Restart/require the
  module before treating a clean result as proof.
- Editing a required ModuleScript does not hot-reload the live game. Use
  `fresh_require` for edit-time verification, then restart the playtest for the
  real runtime path.
- `edit_script_lines` needs a unique `old_string`; pass `startLine` when the
  same block occurs more than once.
- Avoid byte-slicing Unicode source before printing it. BloxForge now replaces
  invalid UTF-8 output with an explicit marker instead of letting bridge JSON
  serialization stall; `grep_scripts` and ranged `get_script_source` remain the
  correct source-reading tools.

## Input, screenshots, and camera

- Screenshot pixels may differ from logical input coordinates under OS display
  scaling. `capture_screenshot` returns the exact x/y conversion.
- Phone-emulator viewport clicks are constrained by Studio. Prefer UI layout
  inspection/device matrices when clicks do not register.
- ProximityPrompts should be triggered from a play client with
  `InputHoldBegin()` / `InputHoldEnd()` after moving the character into range;
  the plugin-only `fireproximityprompt` global is unavailable in game VMs.
- For edit screenshots, pass `cameraPosition` and `lookAt` to
  `capture_screenshot`. BloxForge temporarily uses a Scriptable camera and
  restores the previous CameraType/CFrame even when capture fails. If camera is
  changed manually through `execute_luau`, restoring it remains the caller's
  responsibility.

## Marketplace and safety

- Asset insertion and catalog audio remain subject to Roblox ownership,
  permissions, and session policy. A denial is not bypassable by the bridge;
  use `asset_preflight_insert` and built-in assets where appropriate.
- Destructive Luau patterns require `confirm: true`. The safety response includes
  the exact matched patterns so false positives can be reviewed rather than
  silently bypassed.

---

## See also

- [CHANGELOG.md](../CHANGELOG.md) — fixed issues and release history.
- [docs/](./) — architecture, host-conformance, and host-specific guides.
