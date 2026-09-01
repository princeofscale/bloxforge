# BloxForge bugs and observations

Record confirmed bugs, inaccuracies, and reproducible anomalies found during development here.

## Open

- 2026-08-22 — During a running playtest, `breakpoints action="clear" target="edit"` reports
  `ok: true, cleared: 1`, but the breakpoint keeps firing in the play DataModel for about
  13 more seconds (3 further hits at the 5s trigger interval) before it stops — and by then
  the registry entry is already gone, so the follow-up `clear target="server"` returns
  `cleared: 0` and cannot help. Measured back to back in the same session, the server-scoped
  path has no such lag: `set target="server"` fires within 2s, and `clear target="server"`
  stops it before the next 5s trigger, with 12s of continued triggering confirmed silent
  afterwards. Not fixed: the tool already documents "target server/client-N for running play
  DataModels", and the edit-scoped clear does eventually take effect. Revisit only if the lag
  is ever found to be a permanent orphan rather than a late one.
- 2026-08-21 — **Studio hard-crashes on `ScriptDebuggerService:RemoveBreakpoint(nil, 1)`
  when the Studio Debugger Luau API beta feature is ON.** Reproduce (do not, unless you
  mean it): with the beta enabled, `execute_luau` →
  `pcall(function() return sds:RemoveBreakpoint(nil, 1) end)`. Expected: the pcall
  returns `false` plus a cast error, which is exactly what happens with the beta OFF
  (`false, "Failed to execute RemoveBreakpoint request"`). Actual: the process dies —
  `/api/execute-luau` never answers (`OUTCOME_UNKNOWN` after 120000ms),
  `get_connected_instances` drops to `count: 0`, and `RobloxStudioBeta.exe` is gone from
  the process table. The Studio log ends mid-stream ~9s after the call with no shutdown
  sequence, while the previous session's log (closed by the user) ends on the normal
  `~AutoValidStudioInstanceCounter` line. No .dmp is written — Roblox handles its own
  crash reporting. This is an engine bug, not a BloxForge one: the `breakpoints` handler
  resolves and `IsA("LuaSourceContainer")`-checks the instance before calling, so the
  tool itself can never pass nil. Recorded because it is a live foot-gun for any
  `execute_luau` that touches ScriptDebuggerService directly, and because it settles the
  entry below.
- 2026-08-21 — `breakpoints action="list"` returns a clean `{"count":0,"breakpoints":[]}`
  even when the Studio Debugger Luau API beta feature is off, so the obvious pre-flight
  reports success and the failure only surfaces on the first `action="set"`
  (`add_breakpoint_failed`, `betaFeatureRequired: true`). That is because
  `listBreakpoints` never touches ScriptDebuggerService — it reads only the
  plugin-settings registry, which is literally honest ("zero MCP-managed breakpoints")
  but reads as "the debugger is available". **Resolved as won't-fix:** the only
  side-effect-free probe available was `RemoveBreakpoint(nil, 1)` — with the beta off,
  `AddBreakpoint`, `RemoveBreakpoint` and `ClearBreakpoints` all index as `function`
  (measured) and the gate fires before argument validation, so the nil call was the one
  way to tell the states apart. Running it with the beta ON crashes Studio outright (see
  the entry above), so that probe must never ship. `list` stays registry-only; the
  `betaFeatureRequired` error on `set` is the availability signal.
- 2026-08-21 — A heavy `terrain_generate_island` returns `success: true` before Studio
  has settled, and the next bridge call can time out twice and get the plugin reaped.
  Reproduce: `terrain_generate_island {center:[160,0,0], radius:40, waterMaterial:
  "Water", waterRadius:70}` (dry-run reports ~268083 studs³), then immediately
  `capture_screenshot` with `cameraPosition`/`lookAt` aimed at the new island — two
  consecutive `TIMEOUT ... after 30000ms on /api/capture-screenshot`, after which
  `get_connected_instances` returns `count: 0` and the plugin is gone from the bridge.
  It self-recovers about two minutes later with a fresh `connectedAt`, and Studio never
  crashes (the process stays up). Isolated afterwards: with the terrain already built
  and Studio idle, `capture_screenshot` works both without a camera override and with
  the same kind of override, so neither the capture path nor terrain rendering is at
  fault — it is only the window while the fill is still being processed. The pieces to
  handle it are already there (the typed `TIMEOUT` is marked retryable, and
  `MCP_STALE_INSTANCE_MS` exists precisely for "Studio throttling"), so this is filed
  as an expectation gap rather than a fix: the terrain tools do not say their return is
  not a settle point. Resisted the tempting fix of promoting `/api/capture-screenshot`
  to the heavy timeout class — successful captures sit far inside the normal budget
  (transport p95 2032ms, p99 3359ms), so the evidence points at Studio being busy, not
  at the capture being slow.

- 2026-08-21 — `load_toolset`'s `tools` / `count` describe only the domains named in
  that call, not the domains currently advertised, and nothing in the response says
  so. Reproduce: load `["scene","mutation","runtime","ui","scripts"]` (139 tools),
  then call `{toolsets:["terrain","environment"], unload:["ui","scripts"]}` — the
  reply is `count: 40` listing core+terrain+environment, with no sign that scene,
  mutation and runtime are still live. They are: `get_world_snapshot` still answers
  afterwards. The sibling `unloadedTools`/`unloadedCount` *are* scoped to the call,
  so the symmetry reads as "this is what you have now" versus "this is what you
  lost". The natural recovery — re-load the domains that look missing — is cheap in
  practice (`applyToolset` only mutates `activeToolNames` for names that actually
  change, so a redundant load emits no `tools/list_changed` and does not invalidate
  the prompt cache), which is why this is filed as a reporting inaccuracy rather
  than fixed: renaming `tools`/`count` to match `unloadedTools`/`unloadedCount`
  would touch every caller and test for a one-wasted-call problem. Worth doing if
  the fields are ever revised for another reason.

- 2026-08-21 — `validate_script_source` reports `ok: false` for a checker that is
  merely absent. A clean script on a machine without the optional binaries answers
  `checks: [{tool:"luau-analyze",available:false,ok:false}, {selene...}, {stylua...}]`
  next to `syntax: {available:true, ok:true}` — three "failures" for source that is
  fine. `available:false` does distinguish it and the tool description says to read
  that field first, so this is left as reported rather than changed: `ok` is asserted
  by a test as part of the not-installed shape. Worth revisiting as a tri-state
  (`ok: null` / `status: "skipped"`) if an agent is ever seen reacting to the count
  of `ok:false` rows instead of to `available`.

- 2026-08-21 — `marketplace_search` ranks by relevance, not by insertability, while
  `insert_asset`'s AUTH hint calls it "marketplace_search, which ranks insertable
  candidates". The top three `Model` results for "low poly tree" all reported
  `isFree: true` and all three failed `asset_preflight_insert` with AUTH. Decals in
  the same unpublished place (`PlaceId 0`) load fine, so this is copy-locking on the
  models themselves, not the place — the verdict and its hint are correct, only the
  cross-reference oversells the ranking. Expect several preflight rounds per model.
- 2026-08-04 — `run_playtest_episode`'s `assertions` option cannot pass, ever: every
  assertion fails with `"loadstring() is not available"` regardless of the
  expression given, including a trivial always-true one. Reproduce: call
  `run_playtest_episode` with `assertions: [{name: "x", expr: "workspace:GetAttribute('ChaosPhase') ~= nil"}]`
  against any running place — the episode returns `verdict: "fail"`,
  `assertions.error: "loadstring() is not available"`, `assertions.results: []`.
  The rest of the episode (runtime peer, logs, state sample) works fine; only
  assertion evaluation is broken, apparently because it compiles the expression
  with `loadstring` inside the live game, which Roblox disables outside Studio's
  command bar. Expected: assertion expressions evaluate through a path that
  works in a real playtest (e.g. a bundled interpreter, or documented that
  `loadstring` must be enabled). Impact: the entire assertions feature of
  `run_playtest_episode`/`run_gameplay_assertions` is unusable as shipped, not
  just unreliable — the verdict is always "fail" the moment any assertion is
  supplied, silently discouraging correct code by reporting a false failure.

- 2026-08-04 — `execute_luau` creates no undo waypoint, so nothing an agent builds
  or changes through it can be reversed. Reproduce: call `create_object`, read
  `ChangeHistoryService:GetCanUndo()` (top waypoint `MCP: Create Part`), then run
  `execute_luau` with `Instance.new("Part").Parent = workspace` and read it again —
  the top waypoint is unchanged. Consequence beyond the obvious: an instance created
  this way is never registered in the change history, so deleting it later with
  `delete_object`/`mass_delete_objects` also cannot be undone, even though those
  tools do record properly. Expected: either a waypoint per mutating `execute_luau`,
  or the tool saying plainly that its effects are outside undo. Impact: the undo
  safety net silently does not cover the most powerful tool in the set.

- 2026-08-03 — `project_reconcile_plan` took about 160 seconds to return for a healthy two-tool Rokit project whose only proposed action was `start-rojo`. Reproduce: call it with root `/Users/princeofscale/Roblox/WouldYouRather` and explicit `default.project.json` while Rojo serve is stopped. Expected: a read-only local manifest/status plan returns within a few seconds. Actual: the call remained pending for roughly 2.5 minutes, then returned a normal one-step plan without timeout diagnostics. Impact: routine pre-mutation inspection stalls agent workflows and exceeds the expected progress-update interval.
- 2026-08-03 — An unsandboxed `project_reconcile_apply` starts the pinned Rojo process and captures `Rojo server listening ... Port: 34872`, but `rojo_serve_start` still fails after 10 seconds with `Rojo serve did not become ready within 10000ms`. Expected: readiness succeeds once the loopback endpoint is listening, or the error reports the failing readiness probe. Impact: reconcile cannot reach `ready:true` even though process startup itself succeeds. Reconfirmed 2026-08-04 on the same project against a freshly rebuilt server (same-day `npm run build`): `rojo_serve_start` returns the identical stdout/timeout error, and a follow-up `rojo_serve_status` reports `"status":"stopped"` — the failed start does not leave an orphaned process, it is torn down, which rules out "process running but status tracking wrong" as the cause.
- 2026-08-03 — `project_reconcile_apply` can generate the sourcemap and then fail its automatic `start-rojo` step with `listen EPERM: operation not permitted 127.0.0.1:34872`. Reproduce from a valid Rojo/Rokit project in a sandboxed MCP session: run `project_reconcile_plan`, then apply the returned hash. Expected: managed Rojo serve starts or the capability preflight reports that local port binding requires host approval before partially applying the plan. Impact: reconcile remains not-ready after a partially completed run and requires manually starting the pinned Rojo shim.
- 2026-08-02 — After a secondary server enters proxy mode, mutation calls can receive `unrecognized_instance_id` / `No Studio plugin is connected` even though the primary had an edit instance earlier. The proxy must wait for or preserve the primary bridge connection before accepting routed Studio tool calls.
- 2026-08-02 — A second BloxForge launch intermittently fails with `listen EPERM: operation not permitted 127.0.0.1:58741` instead of entering proxy mode. The port was held by the existing Codex-owned BloxForge child (`dist/index.js`); a subsequent launch did enter proxy mode. Investigate the startup race/error classification.
- 2026-08-02 — With Roblox Studio already running, a freshly started primary MCP server initially reports no connected instances: `get_connected_instances` is empty and Studio tools cannot run until the plugin reconnects (observed within 15 seconds). Reproduce by starting `packages/robloxstudio-mcp/dist/index.js` while Studio is open, completing MCP `initialize`, then immediately calling `get_connected_instances`.
## Fixed

Found and fixed 2026-08-21 by building a live vertical slice in an empty place
(six touch-collectible orbs, leaderstats, a HUD bound to them, then a playtest)
against plugin+server 4.3.1. Same lesson as the 08-04 pass: each of these cost a
round-trip in real use and none of them are visible from reading the code alone.

- 2026-08-21 — `character_navigation` could not move a character at all, by either
  route. Reproduce on 4.3.1: `start_playtest {mode:"play"}`, then
  `character_navigation {instancePath:"game.Workspace.Orbs.Orb1"}` returns
  `Navigation timed out after 25 seconds`, and the same call with `target:"server"`
  returns `Playtest must be running. Start a playtest in 'play' mode first.` while a
  playtest is demonstrably running (`eval_server_runtime` answers, roles are
  `["edit","server","client-1"]`). `target:"client-1"` is refused by the client proxy
  allowlist. Root cause, two halves that hid each other: the request defaulted to the
  edit peer, which emits NAV_SIGNAL as a `warn()` into the edit DataModel, and
  LogService.MessageOut does not reflect edit -> play-server — the note at the top of
  TestHandlers.ts already records that, which is why stop-signaling was moved off this
  path, but navigation was left on it. The one peer that *is* inside the running
  DataModel, the play server, was rejected because the `testRunning` gate is a
  module-level flag only ever set on the edit peer by `startPlaytest`. Proof the
  listener itself was always fine: emitting `__MCP_NAV__:{...}` from inside the play
  DataModel via `eval_server_runtime` walked the character from (-3.1, 4.0, 3.1) to
  (19.3, 3.0, 0.1) — Orb1's position — and the touch handler scored the orb.

  First fix gated on `RunService.IsRunning()` instead of `testRunning` and defaulted
  the tool to `target: "server"`. That made single-player playtests work and then
  immediately exposed the rest of the problem — see the next entry — so the signalling
  is gone entirely now.

- 2026-08-21 — `character_navigation` was still dead in every session that
  `start_playtest` did not open. Reproduce on the first-fix build:
  `multiplayer_test_start {numPlayers: 2}`, then `character_navigation` → `Navigation
  timed out`. `eval_server_runtime` shows why: `ServerScriptService` holds
  `__MCP_ServerEvalBridge` but `hasCommandListener: false`. The listener was planted
  only by `startPlaytest`, so `multiplayerTestStart` never had one — and neither does a
  playtest started from Studio's own Play button, even though the eval bridges are
  documented to work there. The whole edit→play signalling hop turned out to be
  unnecessary: `PathfindingService:ComputeAsync` + `Humanoid:MoveTo` run fine from
  plugin context on the runtime peer, verified in a live 2-player session by walking
  Player1 from (-4.1, 4.0, -1.4) to (19.1, 3.0, -0.1). Fixed by deleting the mechanism
  — `NAV_SIGNAL`/`NAV_RESULT`, `buildCommandListenerSource`, the injected
  `__MCP_CommandListener`, and the `LogService.MessageOut` listener plumbing — and
  doing the navigation directly on the peer that already lives inside the running
  DataModel (net −74 lines). This covers single-player, multiplayer and Play-button
  sessions alike, because it no longer depends on anything being planted in advance.

- 2026-08-21 — `get_instance_properties` was documented as "Get all properties of an
  instance" but walks a fixed `commonProps` list, and that list omitted every
  property BloxForge's own UI tools can write. `ui_create_text_label` accepts
  `anchorPoint`, `font` and `textScaled`; reading the label back returned neither, so
  a value could be set and never verified. A `ScreenGui` came back as five fields
  (`Name`, `ClassName`, `Parent`, `Enabled`, `ChildCount`) with no `ResetOnSpawn`,
  `DisplayOrder` or `IgnoreGuiInset` — the write/read loop did not close for UI at
  all. Roblox exposes no property enumeration to plugins, so the list stays a list:
  fixed by adding the properties the write tools can set (GUI layout/text, ScreenGui
  behaviour, `CanTouch`/`CanQuery`/`CastShadow`), by saying in the description that
  the set is fixed rather than complete, and by pointing at `mass_get_property` —
  which already reads any property by name — for anything outside it.

- 2026-08-21 — Undo waypoints from a caller-supplied `undoLabel` read
  "MCP: MCP: ..." in Studio's undo menu. `beginRecording` prefixes `MCP: `
  unconditionally, which is right for the plugin's own bare action names
  ("Create Part") but doubles up on an `undoLabel` written in the style the waypoints
  are actually seen in. Fixed by not prefixing a label that already carries it.

Verified fixed on 4.3.1 during the same pass, from the Open list above:

- `run_playtest_episode`'s `assertions` no longer always fail. Three assertions
  (including `1 == 1`, the trivial case that used to fail) returned
  `passed: 3, failed: 0` with `verdict: "pass"`. The 2026-08-04 entry describing
  `loadstring() is not available` for every expression no longer reproduces.
- `execute_luau` records an undo waypoint when `undoLabel` is passed: after a
  create with `undoLabel: "undo probe"`, `ChangeHistoryService:GetCanUndo()` returns
  the matching waypoint. The 2026-08-04 entry is addressed but not erased — an
  `execute_luau` *without* `undoLabel` still records nothing, as its schema now
  states outright, so undo coverage of that tool remains opt-in.


Found and fixed 2026-08-04 by building a real feature in a live place (coins +
leaderstats + HUD) rather than by reading code — each of these cost a wasted
round-trip or a wrong diagnosis first.

- 2026-08-04 — `run_gameplay_assertions` could not evaluate anything on a runtime
  peer. It compiled each `expr` with `loadstring`, which works in the plugin's
  edit context but throws `loadstring() is not available` on a runtime peer
  (`LoadStringEnabled` is off by default) — so `target: "server"`, the pairing the
  tool's own description recommends, evaluated nothing. Worse, the failure was
  reported as `failed: 3` and the episode verdict as `fail`, so an infrastructure
  gap looked exactly like a game regression. (#64)
- 2026-08-04 — One assertion ending in a `--` comment killed the whole batch: the
  closing `) end)` sat on the same line and the comment ate it. (#64)
- 2026-08-04 — `validate_script_source` was useless without optional binaries. On a
  machine with none installed it answered with three "is not installed" lines, so a
  typo could only be found by writing the script into the place and burning a
  playtest cycle. Studio's own `loadstring` parses without executing and was
  available the whole time. (#63)
- 2026-08-04 — `load_toolset` reported a toolset it does not have. `loaded` echoed
  the request back, so `"scripting"` (the domain is `"scripts"`) came back as
  success with no script tools — and `client_hint`'s schema-refresh caveat read as
  the explanation, pointing at a client restart instead of a one-word typo. (#65)
- 2026-08-04 — Argument errors described parameters in prose while the schema keys
  differ. `edit_script_lines` is the worst: the name promises a line range, the tool
  is a string replace, and the natural first call came back with "Instance path,
  old_string, and new_string are required" without saying what to send. (#65, #66)

Found and fixed 2026-08-03/04 in a separate pass (PRs #48–#60). Recorded so the
same ground is not re-reported.

- 2026-08-03 (reported here) — Runtime log buffers became unreadable once a
  StudioTestService peer disappeared. Reproduced exactly, then fixed: the teardown
  paths snapshot each runtime peer's buffer on the way out and `get_runtime_logs`
  serves it afterwards, marked `retained` with the capture time, for ten minutes.
  `since` / `tail` / `filter` apply to a retained read exactly as the live path
  applies them. (#57, #59)
- 2026-08-02 (reported here) — CoreGui noise on an unpublished place read as a game
  regression. Split out of the episode verdict by origin container and reported
  under `logs.engineNoise` — set aside, never dropped — and kept out of
  `implicatedScripts`. Note the ordering: until log severity was fixed no error
  counted at all, so this could not actually reach a verdict; that fix is what made
  it reachable. (#56)
- 2026-08-02 (reported here) — `load_toolset` reported success while the tools
  stayed uncallable, with nothing in the response saying that could happen. The
  server expands its advertised list and emits `tools/list_changed`; a host that
  does not act on that leaves them uncallable, and the server cannot take that step
  for it. The caveat lived in the tool description only; the response now carries a
  `client_hint`. Not a server-side defect — the honest fix is saying so where the
  caller actually looks. (#60)
- 2026-08-04 (found verifying the log-severity fix live) — `run_playtest_episode`
  collected zero log entries on every run. It passed `startedAt`, a millisecond
  epoch, as `since` — but `since` is a sequence cursor (`entry.seq > since`), so the
  filter was never satisfiable. `errorCount`/`warningCount` were structurally 0 and
  no runtime error could reach the verdict. A second, independent defect stacked on
  the same path as the severity mismatch: fixing the classifier could not help while
  its input was zeroed first, which is exactly why the first live check still showed
  `verdict: pass` for a place whose buffer held
  `ServerScriptService.BF_Boom:2: attempt to index nil with 'field'`. (#61)
- 2026-08-04 (found while investigating the CoreGui item) — Runtime log severity was
  matched against the wrong vocabulary, blinding two subsystems. The plugin tags
  entries `level: "ERR" | "WARN" | "INFO" | "OUT"` and sends no `messageType`.
  `diagnose_scripts` skipped every entry whose `messageType` was not a string, so it
  answered "Looks clean" for a buffer holding seven warnings (verified live).
  `run_playtest_episode` tested `level.includes('error')` — and `"err"` does not
  contain `"error"` — so `errorCount` was always 0 and **no runtime error could fail
  an episode verdict**; only a failed assertion could. `"warn"` matched by luck,
  which is why warnings worked and hid it. Both now share one `logSeverity`
  classifier. (#56)
- 2026-08-03 (reported here) — `execute_luau` safety scanning flagged destructive
  calls that appear only inside a string assigned to `Script.Source`, so Rojo-style
  source sync demanded confirmation for text that never runs. Reproduced, then fixed:
  the scan now runs over source with string literals and comments blanked out. The
  strip returns the source untouched on any unterminated literal, so a mis-scan can
  only over-report, never hide a real call. One knock-on, handled explicitly: the
  `game:GetService("DataStoreService")` rule matched only its string argument and
  could not survive the strip, so it was removed — obtaining a service handle mutates
  nothing, and `:SetAsync` / `:RemoveAsync` are call-shaped and still gated (asserted
  by test).
- `scene_search`, `get_changes_since`, `get_scene_summary` and `get_world_snapshot`
  walked the whole DataModel from `game`, so they answered about Studio rather than
  the place. On an empty baseplate 1676 of 1714 descendants were Studio's own
  (`Stats`, `StylingService`, `MemStorageService`, `PluginGuiService`, `CoreGui`).
  `scene_search("button")` returned 58 hits, every one a Studio viewport widget.
  All four now scope to the place and report a `scope` field; an explicit path is
  never filtered. (#50, #51) — **same family as the CoreGui-noise item in Open.**
- `get_changes_since` advertised that `scope` field in its schema and description
  but dropped it in the TypeScript that reshapes the payload. (#53)
- Deleting an instance could not be undone. `delete_object` wrapped `Destroy()` in a
  ChangeHistoryService recording, but `Destroy()` is irreversible, so `undo` answered
  "Undo executed successfully" while the object stayed gone. Undo of a *creation* and
  of a *property change* both worked, which is why only the destructive case was lost.
  Deletes now unparent, as Studio's own Delete does. (#54)
- `smart_duplicate` applied no property variations at all while reporting
  `succeeded: 2, failed: 0`: values were assigned raw inside a discarded `pcall`, so
  documented forms like `Color: [255, 0, 0]` reached the engine as tables it rejects
  and the error was swallowed. (#52)
- `create_object` silently dropped any property the engine refused and still answered
  "Object created successfully"; failures now come back in `propertyErrors`. (#48)
- Thirteen tool input properties declared no JSON-Schema `type`, so MCP clients sent
  the values as strings. `environment_set_time_of_day time: 14.75` arrived as
  `"14.75"`, which `Lighting.TimeOfDay` read as 14h75m and set **15:15** while
  reporting success; `set_attribute` stored numbers as string attributes. A schema
  test now fails on any untyped property. (#49)
- Plugin validation errors carried the plugin's own source location, e.g.
  `user_MCPPlugin.rbxmx.MCPPlugin.modules.handlers.ScriptHandlers:484: old_string
  matches multiple locations`. (#50)

## Investigated, not reproducible here

Checked against the code and, where possible, measured. Left open above; recording
what was ruled out so the next attempt does not repeat it.

- **`project_reconcile_plan` taking ~160s.** `plan()` is fully synchronous and every
  phase is bounded — the toolchain shim probes use `execFileSync` with
  `timeout: 5000`, so two tools cap at ~10s. I tested the one way that bound could
  be defeated (a shim leaving a grandchild holding the inherited stdio, which is a
  Rokit trampoline's exact shape) and measured the timeout enforced at 2015ms with
  and without an explicit `killSignal`. That hypothesis is dead; 160s is still
  unexplained from the code. `project_reconcile_plan` now returns a `timingsMs`
  breakdown per phase so the next occurrence names its own culprit. (#58)
- **`rojo_serve_start` readiness, and the reconcile EPERM items.** Neither `rojo`
  nor `rokit` is installed in this environment, and both reports are against a
  specific project, so I could not reproduce or safely change them. One hypothesis
  ruled out by reading: the readiness probe and the spawned server both use
  `127.0.0.1` explicitly, so this is not the usual `localhost` → IPv6 mismatch.
- **Proxy-mode `unrecognized_instance_id`, and the second-launch EPERM.** Need two
  concurrently launched servers racing for port 58741; not attempted.
- **Fresh server reporting no connected instances for ~15s.** A plugin reconnect
  poll interval rather than a defect, but not measured here.
- **`git fsmonitor_ipc__send_query`.** Does not reproduce: `core.fsmonitor` is unset
  in this repository and `git status --short` completes cleanly. This is local git
  configuration on the reporting machine, not a BloxForge issue — removed from Open.

## Verification log

- 2026-08-22 — Studio log breakpoints verified end to end on plugin 4.3.1 with the Studio Debugger Luau API beta enabled: `set` on the edit peer before `solo_playtest start` (mode `play`), `character_navigation` to `game.Workspace.Orbs.Orb1` (method `pathfinding`, arrived at 19.0, 3.0, 0.02), then 12 consecutive `Breakpoint game.ServerScriptService.OrbCollector:40 orb hit by <player> count before N` entries with N running 0..10, execution continuing every time (leaderstats kept incrementing, navigation returned normally, nothing ever paused), then `clear` and `stop_playtest` leaving `list` at zero. A second, server-scoped breakpoint on line 41 was set, observed and cleared inside the same running session.
- 2026-08-02 — Choose Your Chaos live QA exercised BloxForge against a non-trivial generated place: five-round solo cycle plus Final Chaos, three consecutive rounds without Runtime leaks, two-client split voting, validated server damage, remote rate/phase rejection, late client addition, client departure, runtime log capture, and iPhone XR portrait/landscape device simulation all completed. Runtime gameplay scripts produced no errors; multiplayer emitted the separate unpublished-place CoreGui errors recorded above.
- 2026-08-02 — Live Studio bridge smoke test passed on BloxForge/plugin `4.0.3` (protocol `3`): `get_connected_instances` found the edit DataModel, `execute_luau` created/read/deleted a temporary Workspace instance, destructive-call confirmation was enforced, runtime logs were retrievable, and transport diagnostics reported 3/3 requests completed with zero retries, timeouts, or unknown outcomes.
- 2026-08-02 — Offline verification passed: protocol policy, typecheck, core tests, lint, full build, plugin smoke/installer/runtime (17 checks), docs, metadata, legacy-tools report, and package verification all succeeded. A live local primary-mode MCP `initialize` → `tools/list` smoke test also passed with 28 tools.
- 2026-08-02 — MCP server smoke test passed: `initialize` and `tools/list` completed in primary mode; 28 tools were exposed. The Studio bridge was not running, so Studio-side tools have not yet been exercised.
