# BloxForge bugs and observations

Record confirmed bugs, inaccuracies, and reproducible anomalies found during development here.

## Open
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

- 2026-08-03 — Runtime log buffers become unreadable once a StudioTestService peer disappears. Reproduce: start a play/multiplayer test, observe `server`/`client-N`, allow the test to end, then call `get_runtime_logs` for that peer. Expected: the bounded captured buffer remains queryable for a short retention window or is merged into edit history. Actual: `target_role_not_present_on_instance`; the edit buffer contains none of the peer's gameplay logs. Impact: post-test QA cannot inspect terminal cleanup/errors and must poll logs before peer teardown.
- 2026-08-03 — `project_reconcile_plan` took about 160 seconds to return for a healthy two-tool Rokit project whose only proposed action was `start-rojo`. Reproduce: call it with root `/Users/princeofscale/Roblox/WouldYouRather` and explicit `default.project.json` while Rojo serve is stopped. Expected: a read-only local manifest/status plan returns within a few seconds. Actual: the call remained pending for roughly 2.5 minutes, then returned a normal one-step plan without timeout diagnostics. Impact: routine pre-mutation inspection stalls agent workflows and exceeds the expected progress-update interval.
- 2026-08-03 — An unsandboxed `project_reconcile_apply` starts the pinned Rojo process and captures `Rojo server listening ... Port: 34872`, but `rojo_serve_start` still fails after 10 seconds with `Rojo serve did not become ready within 10000ms`. Expected: readiness succeeds once the loopback endpoint is listening, or the error reports the failing readiness probe. Impact: reconcile cannot reach `ready:true` even though process startup itself succeeds.
- 2026-08-03 — `project_reconcile_apply` can generate the sourcemap and then fail its automatic `start-rojo` step with `listen EPERM: operation not permitted 127.0.0.1:34872`. Reproduce from a valid Rojo/Rokit project in a sandboxed MCP session: run `project_reconcile_plan`, then apply the returned hash. Expected: managed Rojo serve starts or the capability preflight reports that local port binding requires host approval before partially applying the plan. Impact: reconcile remains not-ready after a partially completed run and requires manually starting the pinned Rojo shim.
- 2026-08-02 — `StudioTestService` multiplayer QA on an unpublished place (`PlaceId=0`) produces repeatable Roblox CoreGui errors beginning with `Invalid value for enum CreatorType` in `CoreGui.RobloxGui.Modules.PlayerPermissionsModule`, followed by PlayerList/TopBar module failures. User game scripts continue normally. BloxForge runtime-log/episode verdicts should classify or clearly annotate this engine-generated noise so it is not mistaken for a game regression; reproduce with a 1–2 client multiplayer test in a blank unpublished place.
- 2026-08-02 — Lazy toolset loading is not usable from the current Codex MCP session. `load_toolset({toolsets:["runtime","ui"]})` succeeds and reports `start_playtest`, `multiplayer_test_start`, `capture_device_matrix`, and 70+ other tools as loaded, but those tools are still absent from the client's callable tool surface (`typeof tools.mcp__bloxforge__start_playtest === "undefined"`). Expected: loaded tools become callable or the response clearly reports that the client cannot refresh `tools/list`. This blocks the documented load-then-call workflow and live QA without restarting BloxForge with lazy tools disabled.
- 2026-08-02 — After a secondary server enters proxy mode, mutation calls can receive `unrecognized_instance_id` / `No Studio plugin is connected` even though the primary had an edit instance earlier. The proxy must wait for or preserve the primary bridge connection before accepting routed Studio tool calls.
- 2026-08-02 — A second BloxForge launch intermittently fails with `listen EPERM: operation not permitted 127.0.0.1:58741` instead of entering proxy mode. The port was held by the existing Codex-owned BloxForge child (`dist/index.js`); a subsequent launch did enter proxy mode. Investigate the startup race/error classification.
- 2026-08-02 — With Roblox Studio already running, a freshly started primary MCP server initially reports no connected instances: `get_connected_instances` is empty and Studio tools cannot run until the plugin reconnects (observed within 15 seconds). Reproduce by starting `packages/robloxstudio-mcp/dist/index.js` while Studio is open, completing MCP `initialize`, then immediately calling `get_connected_instances`.
- 2026-08-02 — Git emits `fsmonitor_ipc__send_query: unspecified error on '.git/fsmonitor--daemon.ipc'` on `git status`. Status output still completes, but the configured fsmonitor daemon/socket is unavailable. Reproduce with `git status --short` at the repository root.

## Fixed

Found and fixed 2026-08-03/04 in a separate pass (PRs #48–#54). Recorded so the
same ground is not re-reported.

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

## Verification log

- 2026-08-02 — Choose Your Chaos live QA exercised BloxForge against a non-trivial generated place: five-round solo cycle plus Final Chaos, three consecutive rounds without Runtime leaks, two-client split voting, validated server damage, remote rate/phase rejection, late client addition, client departure, runtime log capture, and iPhone XR portrait/landscape device simulation all completed. Runtime gameplay scripts produced no errors; multiplayer emitted the separate unpublished-place CoreGui errors recorded above.
- 2026-08-02 — Live Studio bridge smoke test passed on BloxForge/plugin `4.0.3` (protocol `3`): `get_connected_instances` found the edit DataModel, `execute_luau` created/read/deleted a temporary Workspace instance, destructive-call confirmation was enforced, runtime logs were retrievable, and transport diagnostics reported 3/3 requests completed with zero retries, timeouts, or unknown outcomes.
- 2026-08-02 — Offline verification passed: protocol policy, typecheck, core tests, lint, full build, plugin smoke/installer/runtime (17 checks), docs, metadata, legacy-tools report, and package verification all succeeded. A live local primary-mode MCP `initialize` → `tools/list` smoke test also passed with 28 tools.
- 2026-08-02 — MCP server smoke test passed: `initialize` and `tools/list` completed in primary mode; 28 tools were exposed. The Studio bridge was not running, so Studio-side tools have not yet been exercised.
