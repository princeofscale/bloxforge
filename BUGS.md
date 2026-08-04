# BloxForge bugs and observations

Record confirmed bugs, inaccuracies, and reproducible anomalies found during development here.

## Open
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

- 2026-08-02 — Choose Your Chaos live QA exercised BloxForge against a non-trivial generated place: five-round solo cycle plus Final Chaos, three consecutive rounds without Runtime leaks, two-client split voting, validated server damage, remote rate/phase rejection, late client addition, client departure, runtime log capture, and iPhone XR portrait/landscape device simulation all completed. Runtime gameplay scripts produced no errors; multiplayer emitted the separate unpublished-place CoreGui errors recorded above.
- 2026-08-02 — Live Studio bridge smoke test passed on BloxForge/plugin `4.0.3` (protocol `3`): `get_connected_instances` found the edit DataModel, `execute_luau` created/read/deleted a temporary Workspace instance, destructive-call confirmation was enforced, runtime logs were retrievable, and transport diagnostics reported 3/3 requests completed with zero retries, timeouts, or unknown outcomes.
- 2026-08-02 — Offline verification passed: protocol policy, typecheck, core tests, lint, full build, plugin smoke/installer/runtime (17 checks), docs, metadata, legacy-tools report, and package verification all succeeded. A live local primary-mode MCP `initialize` → `tools/list` smoke test also passed with 28 tools.
- 2026-08-02 — MCP server smoke test passed: `initialize` and `tools/list` completed in primary mode; 28 tools were exposed. The Studio bridge was not running, so Studio-side tools have not yet been exercised.
