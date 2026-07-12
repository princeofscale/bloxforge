# BloxForge MCP Tools Reference

This document contains the complete list of available MCP tools in BloxForge, automatically generated from the tool definitions.

## Total Tools: 158

### `get_file_tree` (Read-only)

Get instance hierarchy tree from Studio

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `path` | `string` | No | Root path (default: game root) |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `search_files` (Read-only)

Search instances by name, class, or script content

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `query` | `string` | Yes | Name, class, or code pattern |
| `searchType` | `string` | No | Search mode (default: name) |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `get_place_info` (Read-only)

Get place ID, name, and game settings

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `get_services` (Read-only)

Get available services and their children

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `serviceName` | `string` | No | Specific service name |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `search_objects` (Read-only)

Find instances by name, class, or properties

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `query` | `string` | Yes | Search query |
| `searchType` | `string` | No | Search mode (default: name) |
| `propertyName` | `string` | No | Property name when searchType is "property" |
| `limit` | `number` | No | Max results to return (token-saving; adds a pagination block). |
| `offset` | `number` | No | Result offset for paging (default 0). |
| `fields` | `array` | No | Keep only these fields per result (e.g. ["name","className"]) to cut tokens. |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `get_instance_properties` (Read-only)

Get all properties of an instance

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `instancePath` | `string` | Yes | Instance path (dot notation) |
| `excludeSource` | `boolean` | No | For scripts, return SourceLength/LineCount instead of full source. Defaults to true (token-saving); pass false to include Source, or use get_script_source. |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `get_instance_children` (Read-only)

Get children and their class types

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `instancePath` | `string` | Yes | Instance path (dot notation) |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `search_by_property` (Read-only)

Find objects with specific property values

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `propertyName` | `string` | Yes | Property name |
| `propertyValue` | `string` | Yes | Value to match |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `get_class_info` (Read-only)

Get properties/methods for a class

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `className` | `string` | Yes | Roblox class name |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `get_project_structure` (Read-only)

Get full game hierarchy tree. Increase maxDepth (default 3) for deeper traversal.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `path` | `string` | No | Root path (default: workspace root) |
| `maxDepth` | `number` | No | Max traversal depth (default: 3) |
| `scriptsOnly` | `boolean` | No | Show only scripts (default: false) |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `set_property` (Write)

Set a property on an instance

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `instancePath` | `string` | Yes | Instance path (dot notation) |
| `propertyName` | `string` | Yes | Property name |
| `propertyValue` | `undefined` | Yes | Value to set (string, number, boolean, or object for Vector3/Color3/UDim2) |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `mass_set_property` (Write)

Set a property on multiple instances

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `paths` | `array` | Yes | Instance paths |
| `propertyName` | `string` | Yes | Property name |
| `propertyValue` | `undefined` | Yes | Value to set (string, number, boolean, or object for Vector3/Color3/UDim2) |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `mass_get_property` (Read-only)

Get a property from multiple instances

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `paths` | `array` | Yes | Instance paths |
| `propertyName` | `string` | Yes | Property name |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `set_properties` (Write)

Set multiple properties on a single instance in one call.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `instancePath` | `string` | Yes | Instance path |
| `properties` | `object` | Yes | Map of property name to value |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `create_object` (Write)

Create a new instance. Optionally set properties on creation.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `className` | `string` | Yes | Roblox class name |
| `parent` | `string` | Yes | Parent instance path |
| `name` | `string` | No | Optional name |
| `properties` | `object` | No | Properties to set on creation |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `mass_create_objects` (Write)

Create multiple instances. Each can have optional properties.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `objects` | `array` | Yes | Objects to create |
| `dryRun` | `boolean` | No | Preview the bulk creation without creating anything (default false). |
| `confirm` | `boolean` | No | Approve a large bulk creation the safety layer would otherwise gate (default false). |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `delete_object` (Write)

Delete an instance. Deleting a protected service/root (e.g. Workspace, ServerScriptService) requires confirm:true. Use dryRun:true to preview.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `instancePath` | `string` | Yes | Instance path (dot notation) |
| `dryRun` | `boolean` | No | Preview the deletion without removing anything (default false). |
| `confirm` | `boolean` | No | Approve a deletion the safety layer would otherwise gate, such as a protected service/root (default false). |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `smart_duplicate` (Write)

Duplicate with naming, positioning, and property variations

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `instancePath` | `string` | Yes | Instance path (dot notation) |
| `count` | `number` | Yes | Number of duplicates |
| `options` | `object` | No |  |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `mass_duplicate` (Write)

Batch smart_duplicate operations

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `duplications` | `array` | Yes | Duplication operations |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `apply_mutation_plan` (Write)

Apply many small edits in ONE round-trip as a transaction: set_property (primitive values), set_attribute, add_tag, remove_tag. Returns a per-op result with before/after, and a ready-to-run `rollback` plan (a reverse mutation plan you can pass straight back to undo). Use dryRun:true to preview the diff without changing anything; large plans require confirm:true. For Vector3/Color3/Enum property values use set_property instead (full type deserialization).

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `operations` | `array` | Yes | Ordered list of operations. |
| `dryRun` | `boolean` | No | Preview the diff without applying (default false). |
| `confirm` | `boolean` | No | Approve a large plan the safety layer gates. |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `get_script_source` (Read-only)

Get script source. Returns "source" and "numberedSource" (line-numbered). Use startLine/endLine for large scripts.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `instancePath` | `string` | Yes | Script instance path |
| `startLine` | `number` | No | Start line (1-indexed) |
| `endLine` | `number` | No | End line (inclusive) |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `set_script_source` (Write)

Replace entire script source. The previous source is backed up first (restore via restore_script_backup). For partial edits use edit/insert/delete_script_lines. NOTE for ModuleScripts: editing Source does NOT invalidate Roblox's per-instance require() cache, so a subsequent require() in execute_luau returns the stale copy — re-verify with fresh_require(module) or a playtest, not a plain require().

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `instancePath` | `string` | Yes | Script instance path |
| `source` | `string` | Yes | New source code |
| `dryRun` | `boolean` | No | Preview the overwrite without changing the script (default false). |
| `confirm` | `boolean` | No | Approve an overwrite the safety layer would otherwise gate (default false). |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `edit_script_lines` (Write)

Replace exact text in a script. Without startLine, old_string must match exactly once in the script. Pass startLine (1-indexed, from get_script_source) to anchor the edit to a specific line when old_string is ambiguous (e.g. repeated closing braces). NOTE for ModuleScripts: editing Source does NOT invalidate Roblox's per-instance require() cache, so a subsequent require() in execute_luau returns the stale pre-edit copy — re-verify with fresh_require(module) or a playtest instead of plain require().

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `instancePath` | `string` | Yes | Script instance path |
| `old_string` | `string` | Yes | Exact text to find and replace. Must be unique in the script unless startLine is provided. |
| `new_string` | `string` | Yes | Replacement text |
| `startLine` | `number` | No | Optional 1-indexed line where old_string begins. When provided, skips uniqueness check and requires old_string to match starting at that exact line. |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `insert_script_lines` (Write)

Insert lines after a given line number (0 = beginning).

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `instancePath` | `string` | Yes | Script instance path |
| `afterLine` | `number` | No | Insert after this line (0 = beginning) |
| `newContent` | `string` | Yes | Content to insert |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `delete_script_lines` (Write)

Delete a range of lines. 1-indexed, inclusive.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `instancePath` | `string` | Yes | Script instance path |
| `startLine` | `number` | Yes | Start line (1-indexed) |
| `endLine` | `number` | Yes | End line (inclusive) |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `set_attribute` (Write)

Set an attribute. Supports primitives, Vector3, Color3, UDim2, BrickColor.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `instancePath` | `string` | Yes | Instance path (dot notation) |
| `attributeName` | `string` | Yes | Attribute name |
| `attributeValue` | `undefined` | Yes | Value (string, number, boolean, or object for Vector3/Color3/UDim2) |
| `valueType` | `string` | No | Type hint if needed |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `get_attributes` (Read-only)

Get all attributes on an instance

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `instancePath` | `string` | Yes | Instance path (dot notation) |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `delete_attribute` (Write)

Delete an attribute

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `instancePath` | `string` | Yes | Instance path (dot notation) |
| `attributeName` | `string` | Yes | Attribute name |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `get_tags` (Read-only)

Get all tags on an instance

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `instancePath` | `string` | Yes | Instance path (dot notation) |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `add_tag` (Write)

Add a tag

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `instancePath` | `string` | Yes | Instance path (dot notation) |
| `tagName` | `string` | Yes | Tag name |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `remove_tag` (Write)

Remove a tag

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `instancePath` | `string` | Yes | Instance path (dot notation) |
| `tagName` | `string` | Yes | Tag name |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `get_tagged` (Read-only)

Get all instances with a specific tag

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `tagName` | `string` | Yes | Tag name |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `get_selection` (Read-only)

Get all currently selected objects

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `execute_luau` (Write)

Execute Luau code in plugin context. target="server" and target="client-N" run against live runtime DataModels with PluginSecurity permissions; use eval_*_runtime instead when you need the game Script/LocalScript VM require cache. Use print()/warn() for output. Return value is captured. REQUIRE-CACHE GOTCHA: Roblox caches require() per ModuleScript instance, and editing a module's Source (edit_script_lines / set_script_source) does NOT invalidate that cache — so a plain require(module) right after editing returns the STALE pre-edit copy and your change looks like it "didn't apply". To require a fresh copy, call the built-in fresh_require(module) (clone->require->destroy, bypasses the cache) instead of require(module). Alternatively use eval_*_runtime (shares the live game's require cache) or playtest to exercise the real module.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `code` | `string` | Yes | Luau code to execute |
| `target` | `string` | No | Instance target: "edit" (default), "server", "client-1", "client-2", etc. |
| `dryRun` | `boolean` | No | Preview without running. Reports any destructive-pattern warnings (default false). |
| `confirm` | `boolean` | No | Approve Luau the safety layer flagged as destructive (e.g. ClearAllChildren, Destroy, DataStore writes) (default false). |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `eval_server_runtime` (Write)

Execute Luau on the server peer in the running game's Script VM (shares require cache with user game scripts, unlike execute_luau target=server which runs in plugin context). Requires a running playtest; the runtime bridge is created automatically inside the play DataModel, including for playtests started manually via the Studio Play button.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `code` | `string` | Yes | Luau code to execute. Use return ... to get a value back. |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `eval_client_runtime` (Write)

Execute Luau on a client peer in the running game's LocalScript VM (shares require cache with user game scripts, unlike execute_luau target=client-N which runs in plugin context). Requires a running playtest; the runtime bridge is created automatically inside the play DataModel, including for playtests started manually via the Studio Play button.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `code` | `string` | Yes | Luau code to execute. Use return ... to get a value back. |
| `target` | `string` | No | Client target: "client-1" (default), "client-2", etc. |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `grep_scripts` (Read-only)

Ripgrep-inspired search across all script sources. Supports literal and Lua pattern matching, context lines, early termination, and results grouped by script with line/column numbers.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `pattern` | `string` | Yes | Search pattern (literal string or Lua pattern) |
| `caseSensitive` | `boolean` | No | Case-sensitive search (default: false) |
| `usePattern` | `boolean` | No | Use Lua pattern matching instead of literal (default: false) |
| `contextLines` | `number` | No | Number of context lines before/after each match (default: 0) |
| `maxResults` | `number` | No | Max total matches before stopping (default: 100) |
| `maxResultsPerScript` | `number` | No | Max matches per script (like rg -m) |
| `filesOnly` | `boolean` | No | Only return matching script paths, not line details (default: false) |
| `path` | `string` | No | Subtree to search (e.g. "game.ServerScriptService") |
| `classFilter` | `string` | No | Only search scripts of this class type |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `solo_playtest` (Write)

Compatibility wrapper for start_playtest/stop_playtest/status. Use action="start" with mode="play" or "run", action="stop" to stop, or action="status" to inspect runtime roles.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `action` | `string` | Yes | Lifecycle action. |
| `mode` | `string` | No | Required for action="start". |
| `timeout` | `number` | No | Max seconds to wait. |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `multiplayer_playtest` (Write)

Compatibility wrapper for multiplayer_test_* tools. Supports action="start", "status", "add_players", "leave_client", and "end".

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `action` | `string` | Yes | Lifecycle action. |
| `numPlayers` | `number` | No | Required for start/add_players. |
| `target` | `string` | No | Client target for leave_client. |
| `testArgs` | `undefined` | No | JSON-compatible test args for start. |
| `value` | `undefined` | No | Value passed to end. |
| `timeout` | `number` | No | Max seconds to wait. |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `start_playtest` (Write)

Start a simple single-player Studio playtest in play or run mode, waiting until a runtime peer registers with MCP. Read print/warn/error output with get_runtime_logs, then end with stop_playtest. For multi-client testing use multiplayer_test_start instead.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `mode` | `string` | Yes | Play mode |
| `numPlayers` | `number` | No | Deprecated and rejected. Use multiplayer_test_start for multi-client testing. |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `stop_playtest` (Write)

Stop playtest and wait for runtime peers to disconnect.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `set_network_profile` (Write)

Apply simulated network conditions to active playtest client peers via NetworkSettings in plugin context. Requires a running playtest and targets only client peers: pass target="client-1", "client-2", etc., or target="all-clients". Presets: great = 30ms total latency (15ms in / 15ms out), 0ms jitter, 0% packet loss; good = 100ms total latency (50ms in / 50ms out), 10ms jitter, 0% packet loss; poor = 300ms (150ms in / 150ms out), 100ms jitter, 0.5% packet loss. profile="custom" applies only the numeric overrides provided; packet loss values above Roblox's 0.5% engine limit are rejected.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `profile` | `string` | Yes | Network condition preset. Presets set all six simulation fields; custom requires overrides. |
| `target` | `string` | No | Client target: "client-1" (default), "client-2", etc., or "all-clients" to apply to every connected playtest client. |
| `overrides` | `object` | No | Optional exact NetworkSettings property overrides. For preset profiles, overrides replace preset fields. For custom, only these properties are applied. |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `get_simulation_state` (Read-only)

Inspect current NetworkSettings and/or StudioDeviceSimulatorService state for edit and connected playtest clients only. Defaults to include="both" and target="edit-and-clients"; server peers are skipped. Use before diagnosing network or device-sensitive tests, especially because normal Play can write client simulator changes back to edit and StudioTestService clients can inherit stale device simulator state.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `include` | `string` | No | Simulation state to inspect: "network", "deviceSimulator", or "both" (default both). |
| `target` | `string` | No | Simulation target scope: "edit-and-clients" (default), "edit", "all-clients", or a specific "client-N". Server peers are never included. |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `reset_simulation_state` (Write)

Reset reachable simulation state to a clean baseline for deterministic tests. Defaults to target="edit-and-clients" and resets both network and device simulator state. Network reset sets all six simulated NetworkSettings fields to 0; device reset calls StopSimulationAsync(). Call before tests, after starting Play or multiplayer, before stopping, and again on edit after stopping.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `target` | `string` | No | Simulation target scope: "edit-and-clients" (default), "edit", "all-clients", or a specific "client-N". Server peers are skipped. |
| `network` | `boolean` | No | Reset simulated NetworkSettings fields to 0 (default true). |
| `deviceSimulator` | `boolean` | No | Stop Studio device simulation with StopSimulationAsync() (default true). |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `get_device_simulator_state` (Read-only)

Inspect StudioDeviceSimulatorService state and supported built-in device presets. Defaults to target="edit"; also supports a regular playtest client target such as "client-1". Server targets are not supported. When no simulated device is active, active-only fields are omitted and isSimulating=false.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `target` | `string` | No | Device simulator target: "edit" (default) or a regular playtest client like "client-1". Server targets are rejected. |
| `deviceId` | `string` | No | Optional built-in device preset ID to inspect with GetDeviceInfoAsync. |
| `includeDeviceList` | `boolean` | No | Include the built-in device preset list from GetDeviceListAsync (default true). |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `set_device_simulator` (Write)

Set or stop StudioDeviceSimulatorService using built-in device presets only. Defaults to target="edit"; supports "client-N" and "all-clients"; rejects server targets. Applies deviceId first, then orientation, resolution, pixelDensity, and scalingMode overrides.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `target` | `string` | No | Device simulator target: "edit" (default), "client-1", "client-2", etc., or "all-clients". |
| `deviceId` | `string` | No | Built-in device preset ID from get_device_simulator_state. |
| `orientation` | `string` | No | ScreenOrientation enum name, e.g. "LandscapeRight", "LandscapeLeft", "Portrait", or a full Enum.ScreenOrientation.* string. |
| `resolution` | `object` | No | Optional resolution override applied after the device preset. |
| `pixelDensity` | `number` | No | Optional positive pixel density override applied after the device preset. |
| `scalingMode` | `string` | No | DeviceSimulatorScalingMode enum name, e.g. "ScaleToPhysicalSize", or a full Enum.DeviceSimulatorScalingMode.* string. |
| `stopSimulation` | `boolean` | No | Stop device simulation. When true, do not pass other simulator setters. |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `capture_device_matrix` (Write)

Apply up to 6 ordered Studio device simulator settings, capture each viewport screenshot, and restore the previous simulator state by default when the prior state is default or a built-in preset. Custom device persistence is intentionally unsupported. Defaults to target="edit"; supports regular playtest client targets but not server or all-clients targets.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `entries` | `array` | Yes | Ordered device capture entries. Each entry may set a deviceId and optional simulator overrides before capture. |
| `target` | `string` | No | Device simulator target: "edit" (default) or a regular playtest client such as "client-1". all-clients and server targets are rejected. |
| `format` | `string` | No | Screenshot image format. "jpeg" (default) is compact; "png" is lossless but may exceed inline size limits. |
| `quality` | `number` | No | JPEG quality 1-100 (default 92). Ignored for png. |
| `settleSeconds` | `number` | No | Seconds to wait after applying each simulator entry before capturing (default 0.3). |
| `restoreAfter` | `boolean` | No | Restore the previous default or built-in preset simulator state after the matrix finishes (default true). Custom active devices are not preserved. |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `multiplayer_test_start` (Write)

Start a StudioTestService multiplayer test and wait for the server plus requested client peers to connect. Use this for multi-client runtime testing.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `numPlayers` | `number` | Yes | Number of client players to start (1-8). |
| `testArgs` | `undefined` | No | JSON-compatible table passed to StudioTestService:GetTestArgs() on server and clients. |
| `timeout` | `number` | No | Max seconds to wait for server + clients to register (default 30). |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `multiplayer_test_state` (Read-only)

Get the active multiplayer StudioTestService state for a place: phase, peers, players, original testArgs, result/error, and connected client roles.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `instance_id` | `string` | No | Which connected Studio place to inspect. Required when multiple places are connected; omit when one. Use get_connected_instances to list available IDs. |

---

### `multiplayer_test_add_players` (Write)

Add client players to a running StudioTestService multiplayer test and wait for the new clients to connect.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `numPlayers` | `number` | Yes | Number of additional client players to add (1-8). |
| `timeout` | `number` | No | Max seconds to wait for new clients to register (default 30). |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `multiplayer_test_leave_client` (Write)

Disconnect a specific client from a running StudioTestService multiplayer test, then wait for that client peer to leave.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `target` | `string` | No | Client target to leave: "client-1" (default), "client-2", etc. |
| `timeout` | `number` | No | Max seconds to wait for the client peer to disconnect (default 30). |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `multiplayer_test_end` (Write)

End a running StudioTestService multiplayer test with an optional return value, then wait for all runtime peers to disconnect.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `value` | `undefined` | No | JSON-compatible value returned to the edit-side ExecuteMultiplayerTestAsync call. |
| `timeout` | `number` | No | Max seconds to wait for runtime peers to disconnect (default 30). |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `get_runtime_logs` (Read-only)

Read the in-memory log buffers captured by Studio plugin peers. Each buffer captures ~64 KB of recent LogService output; runtime peers seed from LogService:GetLogHistory() at plugin load so early startup logs emitted before the plugin finishes loading can still be returned, then continue capturing LogService.MessageOut entries. Oldest entries drop when over budget. Entries include capturedBy for the plugin buffer that observed the log. In ordinary Studio play/run sessions, LogService reflects logs across edit/server/client, so script-origin peer is not reliable and entries omit peer. In StudioTestService multiplayer sessions only, peer attribution is reliable and entries also include peer. target=all (default) merges buffers and dedups same-message-and-level entries captured within 2s across different buffers.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `target` | `string` | No | Capture buffer to read from: "edit", "server", "client-N", or "all" (default). "all" merges buffers and dedups cross-buffer reflections within a 2s window. |
| `since` | `number` | No | Return only entries with seq > since. Pass back the previous response's nextSince (single target) or perCaptureNextSince entry (target=all) for incremental polling. |
| `tail` | `number` | No | Return only the last N entries after since/filter is applied. |
| `filter` | `string` | No | Plain substring matched against each entry's message (no pattern semantics; literal text). Applied after since, before tail. |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `capture_script_profiler` (Read-only)

Capture one short ScriptProfilerService sample on a running server or client peer and return a compact CPU summary. Use this for Luau/script optimization, not render, physics, networking, or engine microprofiler lanes. Minimal flow: start or reproduce the workload, call capture_script_profiler with target="server" or a specific "client-N", inspect top_functions, patch the suspected hot path, then capture again with the same target/workload/duration_ms/frequency/filter/min_total_us to compare. top_functions is sorted by descending total_us after native/plugin/min/filter exclusions; each row includes rank plus function_index, the 1-based index into the raw Roblox Functions array. Function and node TotalDuration values follow Roblox's exported Script Profiler JSON format and are reported in microseconds as total_us. total_us is cumulative profiler TotalDuration during the capture; nested labels/functions can overlap, so do not sum rows as total CPU time. source is the runtime script path reported by Roblox and may need mapping back to editable source with search tools. If function names are too broad, add debug.profilebegin("Area:SpecificStep") / debug.profileend() around suspected code and pass filter="Area:" or another label prefix; matching custom labels appear in debug_labels and top_functions with their script source and no line number. The result echoes effective options in applied and omitted.filtered_out counts rows removed by filter. Keep captures short while actively triggering the behavior; duration_ms defaults to 1000 and is clamped to 100-15000. Pass output_path when you need the raw Roblox Script Profiler JSON for offline comparison or deeper analysis. This tool owns the start/stop/request profiler lifecycle for one capture and does not expose long-lived profiler sessions.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `target` | `string` | No | Runtime peer to profile: "server" (default) or "client-N". Use get_connected_instances to discover available runtime roles. target="edit" is invalid because ScriptProfiler captures running code. |
| `duration_ms` | `number` | No | Sample duration in milliseconds. Defaults to 1000; clamped to 100-15000 so the Studio bridge does not hang on long captures. |
| `frequency` | `number` | No | ScriptProfiler sampling frequency in samples per second (Hz). Defaults to 1000. |
| `max_functions` | `number` | No | Maximum number of top_functions and debug_labels to return. Defaults to 20; clamped to 1-100. |
| `min_total_us` | `number` | No | Omit functions below this TotalDuration in microseconds after capture. Defaults to 0. |
| `filter` | `string` | No | Optional case-insensitive substring matched against function name and source before top_functions are returned. Useful for focusing on one module or debug.profilebegin label prefix. |
| `include_native` | `boolean` | No | Include native Roblox frames in top_functions. Defaults to false to keep optimization output focused on game Luau and debug labels. |
| `include_plugin` | `boolean` | No | Include plugin frames in top_functions. Defaults to false because the MCP capture implementation can otherwise add noise. |
| `output_path` | `string` | No | Optional local path where the MCP server writes the raw Script Profiler JSON. The tool result then includes output_path instead of inlining the raw JSON. |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `breakpoints` (Write)

Manage Studio debugger breakpoints through ScriptDebuggerService. Use this when the user asks to debug with Studio breakpoints. Prefer log breakpoints for agent debugging: pass log_message and let continue_execution default to true, reproduce the issue, then read get_runtime_logs filtered by "Breakpoint". Minimal flow: set a log breakpoint, run or trigger the behavior, call get_runtime_logs with filter="Breakpoint", then call action="clear" to remove MCP-managed breakpoints. Generated breakpoint logs are prefixed with "Breakpoint" plus script_path:line; Studio breakpoint errors also start with "Breakpoint", so this filter captures both successful breakpoint logs and breakpoint-related failures. Set breakpoints on target="edit" before starting a playtest when possible; for an already-running playtest target the runtime DataModel directly, such as "server" or "client-1". Do not set continue_execution=false unless the target DataModel already has a ScriptDebuggerService.OnStopped handler that returns Enum.DebuggerResumeType.Resume for breakpoint/non-exception stops; otherwise the playtest can get stuck and MCP can lose the server/client peers. Minimal OnStopped reference: local sds=game:GetService("ScriptDebuggerService"); sds.OnStopped=function(info) if info.Reason ~= Enum.ScriptStoppedReason.Exception then return Enum.DebuggerResumeType.Resume end print("EXCEPTION:", info.ExceptionText); return Enum.DebuggerResumeType.Resume end. MCP-managed breakpoints persist minimal script_path/line recovery data per place and target so action="list" and action="clear" can find tool-created edit/server/client breakpoints after MCP/plugin reloads. action="clear" removes only breakpoints created through this MCP tool by default; pass clear_all=true only when you intentionally want to clear every Studio breakpoint in the targeted DataModel, including user-created breakpoints. This tool only manages breakpoint lifecycle; it does not pause, resume, step, inspect variables, or install OnStopped callbacks. Requires Studio Debugger Luau API beta enabled.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `action` | `string` | Yes | Breakpoint action to run. set/remove require script_path and line. clear removes MCP-managed breakpoints by default. list returns breakpoints created through this MCP tool in the targeted DataModel. |
| `clear_all` | `boolean` | No | Only applies to action="clear". Omit or set false to remove only MCP-managed breakpoints tracked by this tool. Set true to call ScriptDebuggerService:ClearBreakpoints() and clear every Studio breakpoint in the targeted DataModel, including user-created breakpoints. |
| `script_path` | `string` | No | Path to a LuaSourceContainer, for example game.ServerScriptService.Main. Required for set/remove. |
| `line` | `number` | No | 1-based line number for set/remove. |
| `enabled` | `boolean` | No | Whether the breakpoint is enabled when set. Defaults to true. |
| `condition` | `string` | No | Optional Luau condition expression for set. |
| `log_message` | `string` | No | Optional Studio breakpoint log expression list for set, such as "'health', health". Literal text must be quoted as a Luau string. The tool prefixes this with "Breakpoint" and script_path:line. After reproducing, read get_runtime_logs with filter="Breakpoint" so breakpoint logs and Studio breakpoint errors are both visible. |
| `continue_execution` | `boolean` | No | Whether the breakpoint should log and continue without pausing. Defaults to true when log_message is provided; otherwise false. Only set false when you have first installed a ScriptDebuggerService.OnStopped handler on the same target that resumes breakpoint/non-exception stops with Enum.DebuggerResumeType.Resume; without that handler the playtest can get stuck and MCP can lose server/client peers. |
| `target` | `string` | No | Peer to target: "edit" (default), "server", or "client-N". Set edit breakpoints before playtests; target server/client-N for running play DataModels. |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `get_connected_instances` (Read-only)

List all connected plugin instances with their roles. Use during multi-client playtest to discover server and client instances for targeted commands.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|

---

### `undo` (Write)

Undo the last change in Roblox Studio. Uses ChangeHistoryService to reverse the most recent operation.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `redo` (Write)

Redo the last undone change in Roblox Studio. Uses ChangeHistoryService to reapply the most recently undone operation.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `execute_luau_async` (Write)

Run heavy/long Luau without risking a connection timeout: returns a jobId immediately while the code runs in the background. Poll get_job_status until done, then get_job_result. Use this instead of execute_luau when the code may take more than ~10s (mass builds, big scene scans). Job state lives in the targeted DataModel — poll status/result with the SAME target. Shares the same execute_luau wrapper, so fresh_require(module) is available and the require-cache caveat applies identically.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `code` | `string` | Yes | Luau code to run. print()/warn() are captured; the return value is captured. |
| `target` | `string` | No | Instance target: "edit" (default), "server", "client-1", etc. |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `get_job_status` (Read-only)

Check an execute_luau_async job: returns status (running/done/error/cancelled), done flag, and elapsed seconds. Poll this until done, then call get_job_result. Use the same target the job was started on.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `jobId` | `string` | Yes | Job id returned by execute_luau_async. |
| `target` | `string` | No | Instance target the job runs on: "edit" (default), "server", "client-1", etc. |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `get_job_result` (Read-only)

Fetch the result of a finished execute_luau_async job (returnValue, output, success/error). Returns status="running" if not done yet — call get_job_status first. Use the same target the job was started on.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `jobId` | `string` | Yes | Job id returned by execute_luau_async. |
| `target` | `string` | No | Instance target the job runs on: "edit" (default), "server", "client-1", etc. |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `cancel_job` (Write)

Request cancellation of a running execute_luau_async job. Best-effort: Luau coroutines cannot be force-killed, so the code keeps running but its result is discarded and the job is marked cancelled.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `jobId` | `string` | Yes | Job id returned by execute_luau_async. |
| `target` | `string` | No | Instance target the job runs on: "edit" (default), "server", "client-1", etc. |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `playtest_sample_state` (Read-only)

Sample LIVE runtime state during a playtest: players (position/health/team/tool/humanoid state), named world state held in ValueBase objects (round counters, flags, ids), currently-playing audio, and runtime/role flags. Use this to debug gameplay while a test runs — pair with start_playtest/get_runtime_logs. Defaults to target="server"; in edit mode the player/world domains come back empty. Domain-masked via `domains`. AUDIO NOTE: Sound.PlaybackLoudness is always 0 in the Edit DataModel (no active audio listener/render) even when IsPlaying=true — only IsLoaded/IsPlaying are meaningful in edit; judge actual audibility/timbre in a playtest.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `domains` | `array` | No | Which state domains to sample (default: all). |
| `target` | `string` | No | Instance target: "server" (default, the live playtest server), "client-1", or "edit". |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `run_gameplay_assertions` (Read-only)

Run a list of named boolean assertions against the DataModel and get a structured pass/fail per assertion plus an allPassed summary — the QA primitive to PROVE a fix rather than declare it. Each assertion has a name and a Luau boolean `expr` (e.g. "workspace:FindFirstChild('Boss') ~= nil"). Pair with start_playtest + target="server" to assert live runtime state after reproducing an issue.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `assertions` | `array` | Yes | Named boolean checks. |
| `target` | `string` | No | Instance target: "edit" (default), "server", "client-1". |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `run_playtest_episode` (Write)

One-shot runtime episode: start a playtest, let it run briefly, then gather the evidence an agent needs to reason about behaviour — runtime logs (error/warning counts + entries), optional gameplay assertions, an optional live state sample — and stop the playtest, returning a single episode object with a pass/fail verdict. Collapses the start_playtest → (sample/assert/logs) → stop_playtest loop into one call so the agent can drive an edit→playtest→observe→assert→fix cycle without hand-orchestrating the lifecycle. Verdict is "fail" if any assertion fails or runtime errors are logged, "error" if the playtest never reaches a ready runtime.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `mode` | `string` | No | Playtest mode (default "play"). |
| `assertions` | `array` | No | Optional named boolean checks to evaluate live during the episode (same shape as run_gameplay_assertions). |
| `sampleDomains` | `array` | No | Optional telemetry domains to sample once during the episode (e.g. "players", "world", "audio"). Omit to skip the state sample. |
| `durationS` | `number` | No | How long to let the game run before sampling/stopping, in seconds (default 3, max 30). |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `summarize_episode` (Read-only)

Distill a stored playtest episode (from run_playtest_episode) into the few facts that matter — verdict, failed assertions, the top error lines, the scripts those errors implicate, and a suggested next step — without re-running it. Pass comparedToEpisodeId of an earlier (failing) episode to PROVE a fix: it reports fixed=true on a fail→pass transition. Episodes are also readable as resources at roblox://playtest/episode/{id}.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `episodeId` | `string` | Yes | The episodeId returned by run_playtest_episode. |
| `comparedToEpisodeId` | `string` | No | Optional earlier episodeId to diff against (e.g. the failing run before your fix) to prove fail→pass. |

---

### `propose_next_action` (Read-only)

Deterministically pick the single next step in the edit→playtest→observe→fix loop from the stored playtest episodes — no LLM turn spent on the obvious move. With no episodeId it reads the most recent episode (and locates the most recent earlier FAILING run, so a clean run after a failure is recognized as a fix to prove). Returns { action, done, tool, args, rationale, focus }: when the next step is mechanical it names the exact MCP call + args (e.g. run_playtest_episode, or summarize_episode with comparedToEpisodeId); when it needs a human/LLM edit it sets tool=null and names the implicated scripts/assertions in "focus". action is one of run_episode | fix_startup | fix_assertion | fix_script | prove_fix | done.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `episodeId` | `string` | No | Optional episodeId to reason about. Omit to use the most recent stored episode. |

---

### `get_reproduction_bundle` (Read-only)

Capture a point-in-time reproduction/audit bundle in one call: connected Studio places, a world overview snapshot, the recent mutating-operation history, and the stored playtest episodes. Use it to answer "what state is this place in and how did it get here" — for handing off, auditing an agent run, or pairing with get_changes_since for before/after deltas. Also readable as a resource at roblox://repro/bundle.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `manage_instance` (Write)

Launch, close, inspect, and find revisions for Studio instances. Use action="launch" with source="baseplate" for a blank place, or source="local_file" with local_place_file for a local place; neither uses place_id. Use action="list_place_versions" with place_id to retrieve version numbers through Open Cloud asset versions, then action="launch" with source="place_revision", place_id, and place_version to open an older revision. action="close" can close an MCP-managed instance or an explicitly connected edit instance by instance_id. action="launch" source="published_place" opens the latest published place and is blocked if that place_id is already connected; source="place_revision" is allowed because Studio opens explicit past revisions as anonymous local copies. Requires ROBLOX_OPEN_CLOUD_API_KEY with asset:read for list_place_versions.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `action` | `string` | Yes | Instance management action. |
| `source` | `string` | No | Required for action="launch". baseplate/local_file do not use place_id; published_place opens the latest place; place_revision opens a specific older version as an anonymous local copy. |
| `local_place_file` | `string` | No | Required for source="local_file". Path to a .rbxl/.rbxlx place file. |
| `place_id` | `number` | No | Only used for source="published_place", source="place_revision", and action="list_place_versions". Do not pass for source="baseplate" or source="local_file". |
| `place_version` | `number` | No | Required for source="place_revision". Use action="list_place_versions" to discover available version numbers. |
| `wait_for_connection` | `boolean` | No | For action="launch": wait until the MCP plugin connects and return instance_id (default true). |
| `timeout_ms` | `number` | No | For action="launch": max milliseconds to wait for plugin connection (default 120000). |
| `max_page_size` | `number` | No | For action="list_place_versions": number of versions to return, clamped to 1-50 (default 10). |
| `page_token` | `string` | No | For action="list_place_versions": pagination token returned by a prior call. |
| `instance_id` | `string` | No | For action="close" or action="status": Studio instance to inspect or close. close accepts MCP-managed instances and explicitly connected edit instances. |

---

### `capture_micro_profiler` (Read-only)

Capture one short Roblox MicroProfiler sample on a running server or client peer using LibMP and return a structured CPU-time attribution dataset. Use this when the performance question is "where is the frame time going?" across scripts, physics, render, network, jobs, scheduler, GC, and engine timers. The primary data is top_groups/top_timers sorted by inclusive_us, exclusive-sorted companion lists, top_threads, top_call_edges, frame_summary, and analysis_window/data_quality so an agent can tell whether a result is steady, spiky, thread-bound, wrapper-heavy, or truncated. For baseline comparison, first capture an empty baseplate/control with the same target/settings and summary_output_path, then capture the game with baseline_path pointing at that saved JSON; saved summaries include a compact comparison_index so baseline_comparison can compare full compact aggregates instead of only visible top rows. Pass baseline inline when the previous capture is already in context. Times are reported in microseconds by converting LibMP MicroProfiler nanosecond ticks; inclusive_us is cumulative nested timer time and can overlap across timers/threads, so do not sum rows as total frame time. *_per_s fields are normalized by analysis_window.analysis_duration_us, not requested duration_ms. pct_of_analyzed_wall can exceed 100 when work overlaps. focus can restrict to script, physics, render, network, or jobs. include_idle defaults false so Sleep/idle noise is omitted. max_events bounds iterator work; event_limit_hit and partial_reasons explain when rankings are useful but partial, so narrow focus/filter or raise max_events for deeper analysis. recommended_tools is intentionally brief; the main purpose is digestible attribution data, not an agent diagnosis.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `target` | `string` | No | Runtime peer to profile: "server" (default) or "client-N". Use get_connected_instances to discover available runtime roles. |
| `duration_ms` | `number` | No | MicroProfiler capture duration in milliseconds. Defaults to 1000; clamped to 100-5000 because decoded event streams are much larger than ScriptProfiler output. |
| `focus` | `string` | No | Optional subsystem focus. Use "all" first for unknown bottlenecks; use a narrower focus after top_groups identifies the area. |
| `filter` | `string` | No | Optional case-insensitive substring matched against timer name and group after capture. Use to inspect a specific timer family such as Heartbeat, Simulation, $Script, or RbxTransport. |
| `max_timers` | `number` | No | Maximum number of top_timers to return. Defaults to 20. |
| `max_groups` | `number` | No | Maximum number of top_groups to return. Each group includes its own hot timers. Defaults to 20. |
| `max_timers_per_group` | `number` | No | Maximum number of nested top_timers included inside each top_groups row. Defaults to 5; use 0 to omit nested timers. |
| `max_related_timers` | `number` | No | Maximum per-row parent, child, and thread context entries. Defaults to 3; use 0 to omit per-row relationship context. |
| `min_total_us` | `number` | No | Omit timers below this inclusive_us threshold after idle/focus/filter processing. Defaults to 0. |
| `include_idle` | `boolean` | No | Include Sleep/idle timers. Defaults to false because idle time usually hides actionable engine work. |
| `include_gpu` | `boolean` | No | Include GPU thread events when LibMP exposes them. Defaults to false to keep CPU diagnosis focused. |
| `max_events` | `number` | No | Maximum LibMP log events to walk. Defaults to 250000; raise for deeper captures or lower to keep quick iterations snappy. |
| `frame_window` | `number` | No | Analyze only the last N MicroProfiler frames from the snapshot. Defaults to 240. |
| `output_path` | `string` | No | Optional local path where the MCP server writes the raw MicroProfiler snapshot bytes. The normal response stays summarized. |
| `summary_output_path` | `string` | No | Optional local path where the MCP server writes the summarized JSON response, including a compact comparison_index. Use this to save an empty-baseplate/control capture for later baseline_path comparison. |
| `baseline_path` | `string` | No | Optional local path to a prior capture_micro_profiler summarized JSON response. The tool adds baseline_comparison using current minus baseline, normalized by capture duration. |
| `baseline` | `object` | No | Optional inline prior capture_micro_profiler summarized response to compare against. Prefer baseline_path for large captures. |
| `baseline_label` | `string` | No | Label used for the baseline side of baseline_comparison, such as "empty_baseplate". |
| `current_label` | `string` | No | Label used for the current capture side of baseline_comparison, such as the game or scenario name. |
| `max_comparison_rows` | `number` | No | Maximum delta rows returned per baseline_comparison section: groups, timers, threads, and call_edges. Defaults to 20. |
| `include_comparison_index` | `boolean` | No | Include the full compact comparison_index in the normal response. Defaults to false; summary_output_path still saves it for baseline comparison. |
| `instance_id` | `string` | No | Which connected Studio place to target. Required when multiple places are connected; omit when one. Use get_connected_instances to list available IDs. |

---

### `export_build` (Read-only)

Export a Model/Folder into a compact, token-efficient build JSON format and auto-save it to the local build library. The output contains a palette (unique BrickColor+Material combos mapped to short keys) and compact part arrays with positions normalized relative to the bounding box center. The file is saved to build-library/{style}/{id}.json automatically.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `instancePath` | `string` | Yes | Path to the Model or Folder to export (dot notation) |
| `outputId` | `string` | No | Build ID for the output (e.g. "medieval/cottage_01"). Defaults to style/instance_name. |
| `style` | `string` | No | Style category for the build (default: misc) |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `create_build` (Write)

Create a new build model from scratch and save it to the library. Define parts using compact arrays [posX, posY, posZ, sizeX, sizeY, sizeZ, rotX, rotY, rotZ, paletteKey, shape?, transparency?]. Palette maps short keys to [BrickColor, Material] pairs. The build is saved and can be referenced by import_build or import_scene.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `id` | `string` | Yes | Build ID including style prefix (e.g. "medieval/torch_01", "nature/bush_small") |
| `style` | `string` | Yes | Style category |
| `palette` | `object` | Yes | Map of short keys to [BrickColor, Material] or [BrickColor, Material, MaterialVariant] tuples. E.g. {"a": ["Dark stone grey", "Concrete"], "b": ["Brown", "Wood", "MyCustomWood"]} |
| `parts` | `array` | Yes | Array of parts. Object format: {position:[x,y,z], size:[x,y,z], rotation:[x,y,z], paletteKey, shape?, transparency?}. Tuple format [posX,posY,posZ,sizeX,sizeY,sizeZ,rotX,rotY,rotZ,paletteKey,shape?,transparency?] also accepted. |
| `bounds` | `array` | No | Optional bounding box [X, Y, Z]. Auto-computed if omitted. |

---

### `generate_build` (Write)

Procedurally generate a build via JS code. ALWAYS generate the entire scene in ONE call - never split into multiple small builds. PREFER high-level primitives over manual loops. No comments. No unnecessary variables. Maximize build detail per line.

EDITING: When modifying an existing build, call get_build first to retrieve the original code. Then make ONLY the targeted changes the user requested - do not rewrite unchanged code. Pass the modified code to generate_build.

HIGH-LEVEL (use these first - each replaces 5-20 lines):
  room(x,y,z, w,h,d, wallKey, floorKey?, ceilKey?, wallThickness?) - Complete enclosed room (floor+ceiling+4 walls)
  roof(x,y,z, w,d, style, key, overhang?) - style: "flat"|"gable"|"hip"
  stairs(x1,y1,z1, x2,y2,z2, width, key) - Auto-generates steps between two points
  column(x,y,z, height, radius, key, capKey?) - Cylinder with base+capital
  pew(x,y,z, w,d, seatKey, legKey?) - Bench with seat+backrest+legs
  arch(x,y,z, w,h, thickness, key, segments?) - Curved archway
  fence(x1,z1, x2,z2, y, key, postSpacing?) - Fence with posts+rails

BASIC:
  part(x,y,z, sx,sy,sz, key, shape?, transparency?)
  rpart(x,y,z, sx,sy,sz, rx,ry,rz, key, shape?, transparency?)
  wall(x1,z1, x2,z2, height, thickness, key) - vertical plane from (x1,z1) to (x2,z2)
  floor(x1,z1, x2,z2, y, thickness, key) - horizontal plane at height y, corners (x1,z1)-(x2,z2). NOT fill - only takes 2D corners+y, not 3D points
  fill(x1,y1,z1, x2,y2,z2, key, [ux,uy,uz]?) - 3D volume between two 3D points
  beam(x1,y1,z1, x2,y2,z2, thickness, key)

IMPORTANT: Palette keys must match exactly. Use only keys defined in your palette object, not color names.
CUSTOM MATERIALS: Use search_materials to find MaterialVariant names, then reference them as the 3rd palette element: {"a": ["Color", "BaseMaterial", "VariantName"]}.

REPETITION:
  row(x,y,z, count, spacingX, spacingZ, fn(i,cx,cy,cz))
  grid(x,y,z, countX, countZ, spacingX, spacingZ, fn(ix,iz,cx,cy,cz))

Shapes: Block(default), Wedge, Cylinder, Ball, CornerWedge. Max 10000 parts. Math and rng() available.
CYLINDER AXIS: Roblox cylinders extend along the X axis. For upright cylinders, use size (height, diameter, diameter) with rz=90. The column() primitive handles this automatically.

EXAMPLE - compact cabin (17 lines):
room(0,0,0,8,4,6,"a","b","a")
roof(0,4,0,8,6,"gable","c")
wall(-4,0,-2,4,0,-2,4,1,"a")
part(0,2,3,3,3,0.3,"a","Block",0.4)
row(-2,0,-1,3,0,2,(i,cx,cy,cz)=>{pew(cx,0,cz,3,2,"d")})
column(-3,0,-2,4,0.5,"a","b")
column(3,0,-2,4,0.5,"a","b")
part(0,2,0,2,1,1,"b")

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `id` | `string` | Yes | Build ID including style prefix (e.g. "medieval/church_01") |
| `style` | `string` | Yes | Style category |
| `palette` | `object` | Yes | Map of short keys to [BrickColor, Material] or [BrickColor, Material, MaterialVariant] tuples. E.g. {"a": ["Dark stone grey", "Cobblestone"], "b": ["Brown", "WoodPlanks", "MyCustomWood"]}. MaterialVariant is optional - use it to reference custom materials from MaterialService. |
| `code` | `string` | Yes | JavaScript code using the primitives above to generate parts procedurally |
| `seed` | `number` | No | Optional seed for deterministic rng() output (default: 42) |

---

### `import_build` (Write)

Import a build into Roblox Studio. Accepts either a full build data object OR a library ID string (e.g. "medieval/church_01") to load from the build library. When using generate_build or create_build, pass the build ID string instead of the full data.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `buildData` | `undefined` | Yes | Either a build data object (with palette, parts, etc.) OR a library ID string (e.g. "medieval/church_01") to load from the build library |
| `targetPath` | `string` | Yes | Parent instance path where the model will be created |
| `position` | `array` | No | World position offset [X, Y, Z] |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `list_library` (Read-only)

List available builds in the local build library. Returns build IDs, styles, bounds, and part counts. Optionally filter by style.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `style` | `string` | No | Filter by style category |

---

### `search_materials` (Read-only)

Search for MaterialVariant instances in MaterialService by name. Use this to find custom materials before using them in generate_build or create_build palettes. Returns material names and their base material types.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `query` | `string` | No | Search query to match against material names (case-insensitive). Leave empty to list all. |
| `maxResults` | `number` | No | Max results to return (default: 50) |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `get_build` (Read-only)

Get a build from the library by ID. Returns metadata, palette, and generator code (if the build was created with generate_build). IMPORTANT: When the user asks to modify an existing build, ALWAYS call get_build first to retrieve the original code, then make targeted edits to only the relevant lines, and call generate_build with the modified code. Never rewrite the entire code from scratch - only change what the user asked to change.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `id` | `string` | Yes | Build ID (e.g. "medieval/church_01") |

---

### `import_scene` (Write)

Import a full scene layout. Provide a scene with model references (resolved from library) and placement data. Each model is placed at the specified position/rotation. Can also include inline custom builds.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `sceneData` | `object` | Yes | Scene layout object with: models (map of key to library build ID), place (array of [key, position, rotation?]), and optional custom (array of inline build objects with name, position, palette, parts) |
| `targetPath` | `string` | No | Parent instance path for the scene (default: game.Workspace) |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `search_assets` (Read-only)

Search the Creator Store (Roblox marketplace) for assets by type and keywords. Requires ROBLOX_OPEN_CLOUD_API_KEY env var (no cookie auth for this endpoint).

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `assetType` | `string` | Yes | Type of asset to search for |
| `query` | `string` | No | Search keywords |
| `maxResults` | `number` | No | Max results to return (default: 25) |
| `sortBy` | `string` | No | Sort order (default: Relevance) |
| `verifiedCreatorsOnly` | `boolean` | No | Only show assets from verified creators (default: false) |

---

### `get_asset_details` (Read-only)

Get detailed marketplace metadata for a specific asset. Uses ROBLOX_OPEN_CLOUD_API_KEY or falls back to ROBLOSECURITY cookie (own assets only).

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `assetId` | `number` | Yes | The Roblox asset ID |

---

### `get_asset_thumbnail` (Read-only)

Get the thumbnail image for an asset as base64 PNG, suitable for vision LLMs. Thumbnails API is public but asset validation uses ROBLOX_OPEN_CLOUD_API_KEY.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `assetId` | `number` | Yes | The Roblox asset ID |
| `size` | `string` | No | Thumbnail size (default: 420x420) |

---

### `insert_asset` (Write)

Insert a Roblox asset into Studio by loading it via AssetService and parenting it to a target location. Optionally set position.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `assetId` | `number` | Yes | The Roblox asset ID to insert |
| `parentPath` | `string` | No | Parent instance path (default: game.Workspace) |
| `position` | `object` | No | Optional world position to place the asset |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `preview_asset` (Read-only)

Preview a Roblox asset without permanently inserting it. Loads the asset, builds a hierarchy tree with properties and summary stats, then destroys it. Useful for inspecting asset contents before insertion.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `assetId` | `number` | Yes | The Roblox asset ID to preview |
| `includeProperties` | `boolean` | No | Include detailed properties for each instance (default: true) |
| `maxDepth` | `number` | No | Max hierarchy traversal depth (default: 10) |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `upload_asset` (Write)

Upload any supported asset type to Roblox: Audio (mp3/ogg/wav/flac), Decal (png/jpg/bmp/tga), Model (fbx/gltf/glb/rbxm/rbxmx), Animation (rbxm/rbxmx), or Video (mp4/mov). Decal supports ROBLOSECURITY cookie auth or ROBLOX_OPEN_CLOUD_API_KEY. All other types require Open Cloud API key with asset:write scope + creator ID. Audio: max 7 min, 100 uploads/month (ID-verified). Video: max 5 min, requires 13+ ID-verified.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `filePath` | `string` | Yes | Absolute path to the file on disk |
| `assetType` | `string` | Yes | Type of asset to upload. Must match the file format. |
| `displayName` | `string` | Yes | Display name for the asset (max 50 characters) |
| `description` | `string` | No | Description for the asset (default: empty string) |
| `userId` | `string` | No | Roblox user ID for the asset creator. Overrides ROBLOX_CREATOR_USER_ID env var. |
| `groupId` | `string` | No | Roblox group ID for the asset creator. Overrides ROBLOX_CREATOR_GROUP_ID env var. Takes precedence over userId if both provided. |

---

### `capture_screenshot` (Read-only)

Capture the Roblox Studio viewport at native resolution and return it as an image, plus a text line stating the physical image size and logical viewport size. Works in Edit mode and regular playtests (auto-detects a running client and captures the live play viewport). StudioTestService multiplayer client screenshots are currently blocked by Roblox temporary-texture process scoping; the tool returns a clear error in that case. The returned image is never downscaled, but OS display scaling can make physical image pixels larger than the logical viewport coordinates used by simulate_mouse_input; when that happens the response states the exact coordinate conversion. For reading fine text/UI, use format="png" (lossless) or a higher quality; enlarging the Studio window raises resolution. Requires EditableImage API enabled (Game Settings > Security > "Allow Mesh / Image APIs") and the window to be visible.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `format` | `string` | No | Image format. "jpeg" (default) is compact and crisp at high quality. "png" is lossless — best for reading dense text/UI, but larger (a busy 3D scene may be big). |
| `quality` | `number` | No | JPEG quality 1-100 (default 92). Higher = sharper text, larger size. Ignored for png. |
| `cameraPosition` | `object` | No | Optional temporary edit-camera position. Requires lookAt; the prior camera type/CFrame are restored after capture. |
| `lookAt` | `object` | No | World point the temporary camera faces. Requires cameraPosition. |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `asset_preflight_insert` (Read-only)

Authoritatively check whether an asset can be inserted, BEFORE touching the live scene. Loads the asset with AssetService:LoadAssetAsync into an isolated, unparented container, inspects it (root summary, descendant + script counts), then destroys it. Returns insertabilityVerdict ("yes"/"no") with a typed error code on failure (AUTH for copy-locked/unowned assets) and hasScripts as a safety signal. Use this between marketplace_search and insert_asset — metadata like isFree is only a hint; a real load is the source of truth.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `assetId` | `number` | Yes | Roblox asset id to preflight (from marketplace_search). |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `plan_asset_insert` (Read-only)

One-shot asset discovery: marketplace-search a keyword, run the authoritative insertability preflight (asset_preflight_insert) on the top candidates IN ONE BATCH, and return a ranked, vetted plan — insertable + free + script-free first, with per-candidate warnings (scripts, paid/copy-locked, preflight error). Collapses the search→preflight→search churn an agent otherwise does as many separate round-trips into a single call; then insert the recommended assetId with insert_asset. Use this instead of hand-looping marketplace_search + asset_preflight_insert.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `keyword` | `string` | Yes | What to search for, e.g. "low poly tree". |
| `category` | `string` | No | Marketplace category (Model, Decal, Audio, …). Defaults to Model. |
| `count` | `number` | No | How many top candidates to preflight (default 5, max 10). |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `asset_source_search` (Read-only)

Search free, license-clean (CC0) asset libraries OUTSIDE the Roblox marketplace and return one normalized descriptor shape across providers: { provider, id, name, type, license, attributionRequired, pageUrl, downloadUrl?, thumbnailUrl?, note }. Live search hits Poly Haven (textures/HDRIs/models) and ambientCG (PBR materials); Kenney and Quaternius are browse-only pointers (no search API). The intended flow is asset_source_search → pick a result → import_external_asset with the downloadUrl (which uploads it to Roblox and records provenance). All results are CC0, so no attribution is legally required, but the source is still tracked. Studio-agnostic (web only).

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `query` | `string` | No | Search text (e.g. "brick wall", "rock", "wood floor"). Omit to list (Poly Haven returns its catalog head; ambientCG returns top assets). |
| `providers` | `array` | No | Which libraries to search. Default: all four. |
| `limit` | `number` | No | Per-provider result cap (1–50, default 10). |

---

### `import_external_asset` (Write)

Bring an asset from OUTSIDE the Roblox marketplace into the place: download a URL (or read a local file), upload it to Roblox via Open Cloud, record its provenance (source, license, attribution obligation, sha256, new assetId), and optionally insert it. Use for CC0/CC-BY libraries (Kenney, Quaternius, Poly Haven, ambientCG), your own files, or any direct asset URL. Always pass the license so attribution can be tracked. Requires ROBLOX_OPEN_CLOUD_API_KEY (asset:write) + a creator id (ROBLOX_CREATOR_USER_ID / ROBLOX_CREATOR_GROUP_ID). Only import assets you have the right to upload.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `source` | `string` | Yes | A direct https URL to the asset file, or an absolute local file path. |
| `assetType` | `string` | No | Roblox asset type to upload as (must match the file format). Default "Decal". |
| `displayName` | `string` | No | Display name for the uploaded asset (max 50 chars). |
| `license` | `string` | No | License of the source asset (e.g. "CC0", "CC-BY-4.0"). Drives the attributionRequired flag. |
| `attribution` | `string` | No | Attribution/credit text to record (required for CC-BY-style licenses). |
| `sourceName` | `string` | No | Human label for the source (e.g. "Kenney", "Poly Haven"). |
| `parentPath` | `string` | No | If given, insert the uploaded asset under this path after upload (e.g. "Workspace"). |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `get_asset_provenance` (Read-only)

Return the recorded provenance of externally-imported assets (source URL, license, attribution obligation, sha256, assetId, import time). Pass an assetId for one record, or omit to list all imported this session. Use to produce an attribution manifest or audit where assets came from.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `assetId` | `string` | No | The Roblox assetId to look up. Omit to list all recorded imports. |

---

### `simulate_mouse_input` (Write)

Simulate a mouse click in the running game via UserInputService:CreateVirtualInput. Use during a playtest to click UI buttons, interact with objects, or aim. Fires real UserInputService input and activates GUI buttons. Coordinates are logical viewport pixels (top-left is 0,0). Take a capture_screenshot first: if OS display scaling makes the physical image larger than the logical viewport, the screenshot response states the exact image-pixel-to-input conversion. Auto-targets the running client; only works during a playtest. Note: only click/mouseDown/mouseUp are supported (the API has no mouse-move or scroll).

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `action` | `string` | Yes | Mouse action. "click" does mouseDown + short delay + mouseUp. |
| `x` | `number` | Yes | Logical viewport X coordinate. If reading from a scaled capture_screenshot image, apply the conversion stated in that response first. |
| `y` | `number` | Yes | Logical viewport Y coordinate. If reading from a scaled capture_screenshot image, apply the conversion stated in that response first. |
| `button` | `string` | No | Mouse button (default: Left) |
| `target` | `string` | No | Instance target. Defaults to the running playtest client (client-1) when present, else "edit". Override with "server", "client-2", etc. |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `simulate_keyboard_input` (Write)

Simulate keyboard input in the running game via UserInputService:CreateVirtualInput. Use during a playtest for character movement (W/A/S/D walks at full WalkSpeed with player controls intact), jumping (Space), interactions (E), or any key-driven action. Drives the real input pipeline so game scripts and control modules respond. For sustained movement use action="press" to hold and "release" to let go. Pass "text" instead of keyCode to type a string into the focused TextBox. Auto-targets the running client; only works during a playtest.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `keyCode` | `string` | No | Enum.KeyCode name: "W", "A", "S", "D", "Space", "E", "F", "LeftShift", "LeftControl", "Return", "Tab", "Escape", "One", "Two", etc. Omit if using "text". |
| `action` | `string` | No | "tap" (default) = press + wait + release. "press" = key down only. "release" = key up only. |
| `duration` | `number` | No | Hold duration in seconds for "tap" action (default: 0.1). Use longer values for sustained input like walking. Takes precedence over holdDuration when both are provided. |
| `holdDuration` | `number` | No | Alias for duration, accepted for ProximityPrompt-style callers. If both duration and holdDuration are provided, duration wins. |
| `text` | `string` | No | Type this string into the currently focused TextBox (uses SendTextInput). When provided, keyCode/action are ignored. |
| `target` | `string` | No | Instance target. Defaults to the running playtest client (client-1) when present, else "edit". Override with "server", "client-2", etc. |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `character_navigation` (Write)

Move the player character to a target position or instance during playtest. Uses PathfindingService for automatic navigation around obstacles, falling back to direct movement. Requires an active playtest in "play" mode. Does NOT simulate player input - moves the character directly.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `position` | `array` | No | Target world position [x, y, z]. Either this or instancePath is required. |
| `instancePath` | `string` | No | Instance to navigate to (dot notation). The character walks to its Position. Either this or position is required. |
| `waitForCompletion` | `boolean` | No | Wait for the character to arrive before returning (default: true) |
| `timeout` | `number` | No | Max seconds to wait for navigation to complete (default: 25) |
| `target` | `string` | No | Instance target: "edit" (default), "server", "client-1", "client-2", etc. |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `clone_object` (Write)

Clone an instance to a new parent location. Creates a deep copy of the instance and all its descendants.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `instancePath` | `string` | Yes | Path of the instance to clone |
| `targetParentPath` | `string` | Yes | Path of the parent to place the clone under |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `get_descendants` (Read-only)

Get all descendants of an instance recursively with depth info. More efficient than repeated get_instance_children calls.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `instancePath` | `string` | Yes | Root instance path |
| `maxDepth` | `number` | No | Maximum recursion depth (default: 10) |
| `classFilter` | `string` | No | Only include instances of this class (uses IsA, so "BasePart" matches Part, MeshPart, etc.) |
| `limit` | `number` | No | Max descendants to return (token-saving; adds a pagination block with total/hasMore). |
| `offset` | `number` | No | Descendant offset for paging (default 0). |
| `fields` | `array` | No | Keep only these fields per descendant (e.g. ["name","className","path"]) to cut tokens. |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `get_scene_summary` (Read-only)

Token-lean scene overview: counts descendants by ClassName under a path and returns totals + the top-N classes, instead of dumping the whole tree. Use before get_descendants to understand a scene cheaply.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `instancePath` | `string` | No | Root path to summarize (default game.Workspace). |
| `topN` | `number` | No | How many of the most common classes to list (default 20). |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `compare_instances` (Read-only)

Diff two instances by comparing their properties. Useful for debugging why a duplicate behaves differently.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `instancePathA` | `string` | Yes | First instance path |
| `instancePathB` | `string` | Yes | Second instance path |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `bulk_set_attributes` (Write)

Set multiple attributes on an instance in a single call. More efficient than repeated set_attribute calls.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `instancePath` | `string` | Yes | Instance path |
| `attributes` | `object` | Yes | Map of attribute names to values. Supports Vector3, Color3, UDim2 via _type convention. |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `get_memory_breakdown` (Read-only)

Read per-category memory usage by iterating Enum.DeveloperMemoryTag and calling Stats:GetMemoryUsageMbForTag per item (workaround for Stats:GetMemoryUsageMbAllCategories being gated by Capabilities: InternalTest and not callable from plugin context), plus Stats:GetTotalMemoryUsageMb for the rollup. target="all" (default) returns { peer: { total_mb, categories, timestamp } } for every connected peer except edit-proxy; single-peer targets return that peer's object directly. Optional tags whitelist filters to only those DeveloperMemoryTag entries; unknown tags come back with value 0 and are listed in unknown_tags so cross-version drift doesn't error. timestamp is Unix milliseconds (DateTime.now().UnixTimestampMillis). Per-peer MemoryTrackingEnabled=false surfaces as { error } on that peer only.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `target` | `string` | No | Peer to read from: "edit", "server", "client-N", or "all" (default). |
| `tags` | `array` | No | Optional DeveloperMemoryTag whitelist. Unknown tag names return 0 + unknown_tags list. |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `get_scene_analysis` (Read-only)

Read Roblox SceneAnalysisService data for attribution-focused performance analysis. Complements get_memory_breakdown: returns compact top-N entries for instance composition, script memory, unparented instances, triangle composition, animation memory, and audio memory. Requires the Studio Scene Analysis beta feature; if disabled, returns scene_analysis_not_enabled with betaFeatureRequired=true. target="all" (default) returns per-peer data; single-peer targets return that peer directly. raw=true includes the full nested Scene Analysis tree.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `mode` | `string` | No | Scene analysis mode to read. Defaults to "all". |
| `target` | `string` | No | Peer to read from: "edit", "server", "client-N", or "all" (default). |
| `topN` | `number` | No | Number of flattened top entries to include per mode. Defaults to 10; plugin clamps to 1-100. |
| `raw` | `boolean` | No | Include the full nested SceneAnalysisService tree in each mode result. Defaults to false. |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `export_rbxm` (Read-only)

Serialize one or more instances to a .rbxm file on disk via SerializationService:SerializeInstancesAsync (engine v668+, PluginSecurity). Throws if any path resolves to nil, a service, or a non-creatable instance.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `instance_paths` | `array` | Yes | DataModel paths to serialize (e.g. ["Workspace.TestRig", "ServerStorage.Templates.NPC"]) |
| `output_path` | `string` | Yes | Absolute filesystem path where the .rbxm should be written |
| `target` | `string` | No | Which DataModel to read from (default: "edit"). "server" serializes live runtime state during a playtest. |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `import_rbxm` (Write)

Deserialize a .rbxm via SerializationService:DeserializeInstancesAsync (engine v668+, PluginSecurity) and parent the resulting instances under parent_path. All-or-nothing parenting: if any single instance fails to parent, every already-parented sibling is unparented and the call errors. Wrapped in ChangeHistoryService for edit target so one Ctrl+Z reverses the whole import.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `source` | `object` | Yes | Exactly one of { path }, { url }, or { base64 }. path = read from local disk; url = http(s) only, fetched by the MCP server process, capped at 50 MiB; base64 = raw bytes inline. |
| `parent_path` | `string` | Yes | DataModel path of the Instance to parent imported instances under (e.g. "ServerStorage.Imported") |
| `target` | `string` | No | Which DataModel to import into (default: "edit"). "server" parents into the live play-server DM. |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `find_and_replace_in_scripts` (Write)

Find and replace text across all scripts in the game. Supports literal and Lua pattern matching. Use dryRun to preview changes before applying. Pairs with grep_scripts for search-only operations.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `pattern` | `string` | Yes | Text or Lua pattern to find |
| `replacement` | `string` | Yes | Replacement text. When usePattern is true, supports Lua captures (%1, %2, etc.). |
| `caseSensitive` | `boolean` | No | Case-sensitive matching (default: false). Must be true when usePattern is true. |
| `usePattern` | `boolean` | No | Use Lua pattern matching instead of literal (default: false). Requires caseSensitive: true. |
| `path` | `string` | No | Limit scope to a subtree (e.g. "game.ServerScriptService") |
| `classFilter` | `string` | No | Only search scripts of this class type |
| `dryRun` | `boolean` | No | Preview changes without applying them (default: false) |
| `maxReplacements` | `number` | No | Safety limit on total replacements (default: 1000) |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `get_operation_history` (Read-only)

List recent destructive/bulk operations recorded by the safety layer (deletes, bulk creates, script overwrites, Luau runs, restores), most recent first.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `limit` | `number` | No | Maximum number of entries to return (default 50). |

---

### `list_script_backups` (Read-only)

List script sources the safety layer backed up before set_script_source overwrote them. Restore any of them with restore_script_backup.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|

---

### `restore_script_backup` (Write)

Restore a script to the source captured before the most recent set_script_source overwrite. Use list_script_backups to see available paths.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `instancePath` | `string` | Yes | Script instance path to restore (must have a backup). |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `get_world_snapshot` (Read-only)

Token-lean world model for reasoning before drill-down. Returns place info, descendant counts (total, distinct classes, tagged, sounds + playing/looped, scripts/localScripts/moduleScripts), top classes, notable subtree roots, and an environment summary (clock time, lighting technology, atmosphere/sky/terrain presence). Use this first to answer "where is the UI", "is there music", "is the scene heavy" without dumping the tree.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `path` | `string` | No | Root path to snapshot (default: game). |
| `level` | `string` | No | Detail level (default: overview). |
| `topNPerClass` | `number` | No | How many of the most common classes to list (default 12). |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `get_node_batch` (Read-only)

Read several instances in one round-trip, returning only the requested fields per node. Use after a snapshot or summary, when you already know which paths you want — cheaper than a cascade of get_instance_properties or an expensive get_descendants. Values are serialized compactly (Vector3 -> [x,y,z], Color3 -> [r,g,b], Instance -> full path).

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `paths` | `array` | Yes | Instance paths to read. |
| `fields` | `array` | No | Property names to read per node (e.g. ["Position","Anchored","Material"]). Omit to get just name/className. |
| `includeChildrenCount` | `boolean` | No | Include childCount per node (default false). |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `get_changes_since` (Read-only)

Incremental changefeed: returns which instances were added, removed, or changed (class/child-count) since a prior snapshot, so you refresh only what moved instead of re-pulling the world after each action. Call with no snapshotId to start a baseline (returns a snapshotId); call again with that snapshotId to get the diff (the baseline then rolls forward to now).

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `snapshotId` | `string` | No | Snapshot id from a previous call. Omit to capture a fresh baseline. |
| `path` | `string` | No | Root path to track (default: game). |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `scene_search` (Read-only)

Ranked, multi-signal scene search for "where is X" questions ("find the door system", "where is the shop UI", "what controls day/night"). Scores each instance across name, tags, attribute keys, parent name, and class, and returns the top matches with a score and which terms matched. More intent-aware than search_objects (which is single-field); use it when you do not know exact names/paths.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `query` | `string` | Yes | What you are looking for, e.g. "shop ui", "door system", "day night". |
| `path` | `string` | No | Root path to search under (default: game). |
| `limit` | `number` | No | Max results 1-50 (default 10). |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `ui_create_screen_gui` (Write)

Create a ScreenGui container (defaults to StarterGui). Returns the new instance path. Build elements inside it with ui_create_frame/text/image tools.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `name` | `string` | Yes | Name for the ScreenGui. |
| `parentPath` | `string` | No | Parent path (default "StarterGui"). |
| `ignoreGuiInset` | `boolean` | No | Ignore the top-bar inset. |
| `resetOnSpawn` | `boolean` | No | Recreate the GUI each spawn (default Roblox behavior). |
| `displayOrder` | `number` | No | Render order among ScreenGuis. |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `ui_create_frame` (Write)

Create a Frame inside a GUI container. Size/Position use UDim2 arrays [scaleX, offsetX, scaleY, offsetY].

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `parentPath` | `string` | Yes | Dot-notation path of the parent GUI container (e.g. "StarterGui.MainGui"). |
| `name` | `string` | No | Name for the new element. |
| `size` | `array` | No | UDim2 as [scaleX, offsetX, scaleY, offsetY]. |
| `position` | `array` | No | UDim2 as [scaleX, offsetX, scaleY, offsetY]. |
| `anchorPoint` | `array` | No | AnchorPoint as [x, y], each 0-1. |
| `backgroundColor` | `array` | No | Color as [r, g, b], each 0-255. |
| `backgroundTransparency` | `number` | No | 0 (opaque) to 1 (invisible). |
| `text` | `string` | No | Text content (text elements only). |
| `font` | `string` | No | Enum.Font member name, e.g. "GothamBold" (text elements only). |
| `textScaled` | `boolean` | No | Auto-scale text to fit (text elements only). |
| `textColor` | `array` | No | Color as [r, g, b], each 0-255. |
| `textSize` | `number` | No | Fixed text size in pixels (text elements only). |
| `image` | `string` | No | Image asset id, e.g. "rbxassetid://123" (image elements only). |
| `visible` | `boolean` | No | Initial visibility. |
| `zIndex` | `number` | No | Render order. |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `ui_create_text_label` (Write)

Create a TextLabel. Supports text, font, TextScaled, and colors.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `parentPath` | `string` | Yes | Dot-notation path of the parent GUI container (e.g. "StarterGui.MainGui"). |
| `name` | `string` | No | Name for the new element. |
| `size` | `array` | No | UDim2 as [scaleX, offsetX, scaleY, offsetY]. |
| `position` | `array` | No | UDim2 as [scaleX, offsetX, scaleY, offsetY]. |
| `anchorPoint` | `array` | No | AnchorPoint as [x, y], each 0-1. |
| `backgroundColor` | `array` | No | Color as [r, g, b], each 0-255. |
| `backgroundTransparency` | `number` | No | 0 (opaque) to 1 (invisible). |
| `text` | `string` | No | Text content (text elements only). |
| `font` | `string` | No | Enum.Font member name, e.g. "GothamBold" (text elements only). |
| `textScaled` | `boolean` | No | Auto-scale text to fit (text elements only). |
| `textColor` | `array` | No | Color as [r, g, b], each 0-255. |
| `textSize` | `number` | No | Fixed text size in pixels (text elements only). |
| `image` | `string` | No | Image asset id, e.g. "rbxassetid://123" (image elements only). |
| `visible` | `boolean` | No | Initial visibility. |
| `zIndex` | `number` | No | Render order. |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `ui_create_text_button` (Write)

Create a TextButton. Supports text, font, TextScaled, and colors.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `parentPath` | `string` | Yes | Dot-notation path of the parent GUI container (e.g. "StarterGui.MainGui"). |
| `name` | `string` | No | Name for the new element. |
| `size` | `array` | No | UDim2 as [scaleX, offsetX, scaleY, offsetY]. |
| `position` | `array` | No | UDim2 as [scaleX, offsetX, scaleY, offsetY]. |
| `anchorPoint` | `array` | No | AnchorPoint as [x, y], each 0-1. |
| `backgroundColor` | `array` | No | Color as [r, g, b], each 0-255. |
| `backgroundTransparency` | `number` | No | 0 (opaque) to 1 (invisible). |
| `text` | `string` | No | Text content (text elements only). |
| `font` | `string` | No | Enum.Font member name, e.g. "GothamBold" (text elements only). |
| `textScaled` | `boolean` | No | Auto-scale text to fit (text elements only). |
| `textColor` | `array` | No | Color as [r, g, b], each 0-255. |
| `textSize` | `number` | No | Fixed text size in pixels (text elements only). |
| `image` | `string` | No | Image asset id, e.g. "rbxassetid://123" (image elements only). |
| `visible` | `boolean` | No | Initial visibility. |
| `zIndex` | `number` | No | Render order. |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `ui_create_image_label` (Write)

Create an ImageLabel. Set image to an "rbxassetid://..." string.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `parentPath` | `string` | Yes | Dot-notation path of the parent GUI container (e.g. "StarterGui.MainGui"). |
| `name` | `string` | No | Name for the new element. |
| `size` | `array` | No | UDim2 as [scaleX, offsetX, scaleY, offsetY]. |
| `position` | `array` | No | UDim2 as [scaleX, offsetX, scaleY, offsetY]. |
| `anchorPoint` | `array` | No | AnchorPoint as [x, y], each 0-1. |
| `backgroundColor` | `array` | No | Color as [r, g, b], each 0-255. |
| `backgroundTransparency` | `number` | No | 0 (opaque) to 1 (invisible). |
| `text` | `string` | No | Text content (text elements only). |
| `font` | `string` | No | Enum.Font member name, e.g. "GothamBold" (text elements only). |
| `textScaled` | `boolean` | No | Auto-scale text to fit (text elements only). |
| `textColor` | `array` | No | Color as [r, g, b], each 0-255. |
| `textSize` | `number` | No | Fixed text size in pixels (text elements only). |
| `image` | `string` | No | Image asset id, e.g. "rbxassetid://123" (image elements only). |
| `visible` | `boolean` | No | Initial visibility. |
| `zIndex` | `number` | No | Render order. |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `ui_create_image_button` (Write)

Create an ImageButton. Set image to an "rbxassetid://..." string.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `parentPath` | `string` | Yes | Dot-notation path of the parent GUI container (e.g. "StarterGui.MainGui"). |
| `name` | `string` | No | Name for the new element. |
| `size` | `array` | No | UDim2 as [scaleX, offsetX, scaleY, offsetY]. |
| `position` | `array` | No | UDim2 as [scaleX, offsetX, scaleY, offsetY]. |
| `anchorPoint` | `array` | No | AnchorPoint as [x, y], each 0-1. |
| `backgroundColor` | `array` | No | Color as [r, g, b], each 0-255. |
| `backgroundTransparency` | `number` | No | 0 (opaque) to 1 (invisible). |
| `text` | `string` | No | Text content (text elements only). |
| `font` | `string` | No | Enum.Font member name, e.g. "GothamBold" (text elements only). |
| `textScaled` | `boolean` | No | Auto-scale text to fit (text elements only). |
| `textColor` | `array` | No | Color as [r, g, b], each 0-255. |
| `textSize` | `number` | No | Fixed text size in pixels (text elements only). |
| `image` | `string` | No | Image asset id, e.g. "rbxassetid://123" (image elements only). |
| `visible` | `boolean` | No | Initial visibility. |
| `zIndex` | `number` | No | Render order. |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `ui_apply_layout` (Write)

Add a UIListLayout or UIGridLayout to a GUI container so its children arrange automatically.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `targetPath` | `string` | Yes | Container to add the layout to. |
| `layout` | `string` | Yes | Layout type. |
| `fillDirection` | `string` | No | List only: "Vertical" or "Horizontal". |
| `padding` | `number` | No | Pixel padding between items. |
| `cellSize` | `array` | No | UDim2 as [scaleX, offsetX, scaleY, offsetY]. |
| `horizontalAlignment` | `string` | No | Enum.HorizontalAlignment member. |
| `verticalAlignment` | `string` | No | Enum.VerticalAlignment member. |
| `sortOrder` | `string` | No | Enum.SortOrder member (default LayoutOrder). |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `ui_make_mobile_friendly` (Write)

Apply responsive safeguards (UIScale + TextScaled) to every GuiObject under the target so the UI reflows on small screens.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `targetPath` | `string` | Yes | GUI container/path to make mobile-friendly. |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `environment_set_time_of_day` (Write)

Set Lighting time. Pass a number (0-24 ClockTime) or an "HH:MM:SS" string.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `time` | `undefined` | Yes | Number 0-24 (ClockTime) or "HH:MM:SS" string. |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `environment_set_lighting_preset` (Write)

Apply a named lighting preset: sunny, sunset, night, horror, cyberpunk, obby, simulator, realistic. Set withPostFx for a polished look (Future lighting + idempotent Bloom/ColorCorrection/SunRays).

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `preset` | `string` | Yes | Preset name. |
| `withPostFx` | `boolean` | No | Also enable Future lighting + add named, idempotent Bloom/ColorCorrection/SunRays effects (default false). |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `environment_set_atmosphere` (Write)

Create or update the Lighting Atmosphere (density, color, decay, glare, haze).

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `density` | `number` | No | Atmosphere density 0-1. |
| `offset` | `number` | No | Atmosphere offset. |
| `color` | `array` | No | Color as [r, g, b], each 0-255. |
| `decay` | `array` | No | Color as [r, g, b], each 0-255. |
| `glare` | `number` | No | Sun glare 0-10. |
| `haze` | `number` | No | Haze 0-10. |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `environment_set_sky` (Write)

Create or update the Lighting Sky (sun/moon textures, star count, skybox faces).

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `sunTextureId` | `string` | No | Sun texture asset id. |
| `moonTextureId` | `string` | No | Moon texture asset id. |
| `starCount` | `number` | No | Number of stars. |
| `skyboxFaces` | `string` | No | A single asset id applied to all six skybox faces. |
| `celestialBodiesShown` | `boolean` | No | Show sun/moon/stars. |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `environment_create_day_night_cycle_script` (Write)

Generate a Script in ServerScriptService that continuously advances Lighting.ClockTime. Replaces an existing one of the same name.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `minutesPerDay` | `number` | No | Real minutes per in-game day (default 10). |
| `scriptName` | `string` | No | Script name (default "DayNightCycle"). |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `terrain_generate_baseplate` (Write)

Fill a flat terrain slab. Volume is capped by the safety layer; use dryRun to preview.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `size` | `array` | Yes | World position/size as [x, y, z]. |
| `position` | `array` | No | World position/size as [x, y, z]. |
| `material` | `string` | No | Enum.Material member name (default "Grass"). |
| `dryRun` | `boolean` | No | Preview without filling. |
| `confirm` | `boolean` | No | Approve a gated fill. |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `terrain_generate_island` (Write)

Fill a ball of land at a center point, optionally surrounded by water.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `center` | `array` | Yes | World position/size as [x, y, z]. |
| `radius` | `number` | Yes | Island radius in studs. |
| `material` | `string` | No | Land material (default "Sand"). |
| `waterMaterial` | `string` | No | Optional surrounding water material. |
| `waterRadius` | `number` | No | Optional water disk radius. |
| `dryRun` | `boolean` | No | Preview without filling. |
| `confirm` | `boolean` | No | Approve a gated fill. |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `terrain_generate_mountains` (Write)

Generate noise-driven mountain terrain across a region. Volume (extent x maxHeight) is capped by the safety layer.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `center` | `array` | Yes | World position/size as [x, y, z]. |
| `extent` | `array` | Yes | Region footprint as [x, z] studs. |
| `maxHeight` | `number` | Yes | Maximum peak height in studs. |
| `material` | `string` | No | Material (default "Rock"). |
| `resolution` | `number` | No | Column size in studs (default 16, min 4). |
| `seed` | `number` | No | Noise seed. |
| `frequency` | `number` | No | Noise frequency divisor (default 100). |
| `dryRun` | `boolean` | No | Preview without filling. |
| `confirm` | `boolean` | No | Approve a gated fill. |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `terrain_generate_water` (Write)

Fill a block of Water material (e.g. an ocean or lake).

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `size` | `array` | Yes | World position/size as [x, y, z]. |
| `position` | `array` | No | World position/size as [x, y, z]. |
| `dryRun` | `boolean` | No | Preview without filling. |
| `confirm` | `boolean` | No | Approve a gated fill. |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `terrain_paint_material` (Write)

Fill a region with a material, or replace one material with another inside the region (set replaceMaterial).

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `min` | `array` | Yes | World position/size as [x, y, z]. |
| `max` | `array` | Yes | World position/size as [x, y, z]. |
| `material` | `string` | Yes | Target Enum.Material member. |
| `replaceMaterial` | `string` | No | If set, only replaces this source material. |
| `dryRun` | `boolean` | No | Preview without painting. |
| `confirm` | `boolean` | No | Approve a gated operation. |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `terrain_clear_region` (Write)

Clear (fill with Air) a terrain region. Irreversible — requires confirm:true. Use dryRun to preview.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `min` | `array` | Yes | World position/size as [x, y, z]. |
| `max` | `array` | Yes | World position/size as [x, y, z]. |
| `dryRun` | `boolean` | No | Preview without clearing. |
| `confirm` | `boolean` | No | Required to actually clear the region. |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `template_create_obby_game` (Write)

Scaffold a complete obby: spawn, numbered checkpoints, kill bricks, a finish, leaderstats + checkpoint server logic, and a timer HUD. Idempotent.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `checkpoints` | `number` | No | Number of checkpoints beyond the start (default 5). |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `template_create_simulator_game` (Write)

Scaffold a simulator: currency leaderstat, a click button HUD + RemoteEvent, a shop folder, and a placeholder data ModuleScript. Idempotent.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `currencyName` | `string` | No | Currency name (default "Coins"). |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `template_create_tycoon_game` (Write)

Scaffold a tycoon: a plot with a base, a purchase button (ProximityPrompt + touch), a Cash leaderstat, and a basic buy/unlock flow. Idempotent.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `startingCash` | `number` | No | Starting Cash per player (default 0). |
| `buttonPrice` | `number` | No | Price of the first button (default 50). |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `template_create_round_game` (Write)

Scaffold a round-based game: a lobby with spawn, an arena with teleport points, and a server round loop (intermission → teleport in → round → teleport out). Idempotent.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `roundSeconds` | `number` | No | Round length in seconds (default 90). |
| `intermissionSeconds` | `number` | No | Intermission length in seconds (default 15). |
| `teleportPoints` | `number` | No | Number of arena teleport points (default 4). |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `sync_pull` (Read-only)

Pull every Script/LocalScript/ModuleScript from Studio into local files (.server.lua/.client.lua/.module.lua) and write a sync manifest. Does not modify Studio.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `syncDir` | `string` | No | Target directory (default ./roblox-src or $ROBLOX_SYNC_DIR). |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `sync_status` (Read-only)

Compare local files against Studio using the sync manifest. Reports local-only changes, studio-only changes, and conflicts (both sides changed). Read-only.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `syncDir` | `string` | No | Sync directory (default ./roblox-src or $ROBLOX_SYNC_DIR). |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `sync_push` (Write)

Push locally-changed scripts back into Studio. Skips files that also changed in Studio (conflicts) instead of overwriting; use dryRun to preview. Resolve conflicts manually or sync_pull to take Studio.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `syncDir` | `string` | No | Sync directory (default ./roblox-src or $ROBLOX_SYNC_DIR). |
| `dryRun` | `boolean` | No | Preview which files would be pushed without writing to Studio. |
| `confirm` | `boolean` | No | Reserved for future gated pushes. |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `marketplace_search` (Read-only)

Search Roblox's public marketplace/toolbox for insertable assets (models, decals, audio, meshes) — no Open Cloud key required. Returns asset ids + names to use with insert_asset.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `keyword` | `string` | Yes | Search text, e.g. "low poly tree". |
| `category` | `string` | No | Friendly name (Model, Decal, Audio, Mesh, Plugin, Video) or a raw toolbox category id. Default Model. |
| `limit` | `number` | No | Max results 1-50 (default 10). |
| `sortType` | `string` | No | Sort, e.g. "Relevance" (default). |

---

### `marketplace_search_and_insert` (Write)

Search the public marketplace and insert the top match into the place in one step (key-free, via InsertService). Returns the inserted asset and alternative matches.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `keyword` | `string` | Yes | Search text for the asset to insert. |
| `category` | `string` | No | Friendly name or toolbox category id. Default Model. |
| `parentPath` | `string` | No | Where to insert (default "game.Workspace"). |
| `position` | `object` | No | Optional world position { x, y, z }. |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `audio_create_sound` (Write)

Create a Sound under a parent with a SoundId (number or rbxassetid://). Configure volume, looping, playback speed, and optionally play it. AUDIO-LOAD LIMITATION: in the Edit DataModel, catalog/uploaded audio (rbxassetid://) frequently fails to load (IsLoaded=false, TimeLength=0) because Edit has no active audio render path and is subject to asset-permission gating — same constraint class as catalog models in a session. Only built-in rbxasset://sounds/* assets reliably load in Edit. Verify real playback and TimeLength in a playtest. Useful built-in broadband noise sources: rbxasset://sounds/action_falling.mp3 (~10s, wind-like) and rbxasset://sounds/action_swim.mp3 (~4.9s, water).

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `parentPath` | `string` | Yes | Where to create the Sound (e.g. "Workspace" or a Part path). |
| `soundId` | `undefined` | Yes | Audio asset id (number) or full rbxassetid:// URI. |
| `name` | `string` | No | Name for the Sound. |
| `volume` | `number` | No | Volume 0-10 (default Roblox value). |
| `looped` | `boolean` | No | Loop the sound. |
| `playbackSpeed` | `number` | No | Playback speed multiplier. |
| `playOnCreate` | `boolean` | No | Call :Play() immediately. |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `audio_play_sound` (Write)

Play an existing Sound instance by path.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `path` | `string` | Yes | Path to the Sound instance. |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `animation_create` (Write)

Create an Animation instance with an AnimationId (number or rbxassetid://) under a parent — e.g. inside a Humanoid, tool, or ReplicatedStorage.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `parentPath` | `string` | Yes | Where to create the Animation. |
| `animationId` | `undefined` | Yes | Animation asset id (number) or rbxassetid:// URI. |
| `name` | `string` | No | Name for the Animation (default "Animation"). |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `animation_play` (Write)

Load and play an animation on a rig (finds/creates an Animator under its Humanoid or AnimationController). Best observed during a playtest.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `rigPath` | `string` | Yes | Path to the rig model (with a Humanoid or AnimationController). |
| `animationId` | `undefined` | Yes | Animation asset id (number) or rbxassetid:// URI. |
| `looped` | `boolean` | No | Loop the track. |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `asset_apply_texture` (Write)

Apply an image/texture asset to a target, choosing the right property by class (ImageLabel→Image, Decal/Texture→Texture, MeshPart→TextureID, SurfaceAppearance→ColorMap). Override with property.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `targetPath` | `string` | Yes | Path to the instance to texture. |
| `assetId` | `undefined` | Yes | Image asset id (number) or rbxassetid:// URI. |
| `property` | `string` | No | Force a specific property instead of inferring from class. |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `image_generate` (Write)

Generate an image from a text prompt via Pollinations (default model zimage; any model from enter.pollinations.ai/#models). Saves a local file and returns its path. Requires POLLINATIONS_API_KEY. To use it in Roblox, upload it (image_generate_and_upload or upload_asset) then asset_apply_texture.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `prompt` | `string` | Yes | Text description of the image to generate. |
| `model` | `string` | No | Pollinations model (default "zimage"). |
| `width` | `number` | No | Width px 16-2048 (default 1024). |
| `height` | `number` | No | Height px 16-2048 (default 1024). |
| `seed` | `number` | No | Seed for reproducible results (default 0). |

---

### `image_generate_and_upload` (Write)

Generate an image (Pollinations) and upload it to Roblox in one step, returning the new assetId to use with asset_apply_texture. Requires POLLINATIONS_API_KEY and Roblox upload auth (ROBLOX_OPEN_CLOUD_API_KEY with asset:write, or ROBLOSECURITY for Decals).

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `prompt` | `string` | Yes | Text description of the image to generate. |
| `model` | `string` | No | Pollinations model (default "zimage"). |
| `width` | `number` | No | Width px 16-2048 (default 1024). |
| `height` | `number` | No | Height px 16-2048 (default 1024). |
| `seed` | `number` | No | Seed (default 0). |
| `assetType` | `string` | No | Roblox asset type to upload as (default "Decal"). |
| `displayName` | `string` | No | Asset display name (default from prompt). |

---

### `generate_model_native` (Write)

Generate a 3D model from a text prompt using Roblox's native GenerationService (on-platform, free, moderation-aware) and insert it into the place. Returns the model path, generation UUID, named parts, and bounding box. Takes ~30s (within the heavy-Luau timeout). Use this instead of an external text-to-3D API or composing parts by hand. Default schema "Body1" produces a single mesh; "Car5" a five-part car; or pass `parts` for a custom multi-part model.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `prompt` | `string` | Yes | Text description of the object to generate, e.g. "a small wooden stool". |
| `parentPath` | `string` | No | Path to parent the model under (default "Workspace"). |
| `name` | `string` | No | Name for the inserted model (default from the generator). |
| `predefinedSchema` | `string` | No | Predefined schema: "Body1" (single mesh, default) or "Car5" (five-part car chassis). Ignored if `parts` is given. |
| `parts` | `array` | No | Custom schema: names of the parts to produce (e.g. ["body","wheel_fl","wheel_fr"]). Overrides predefinedSchema. |
| `size` | `object` | No | Optional target size (studs) as {x,y,z}. |
| `maxTriangles` | `number` | No | Optional max triangle budget for the generated mesh. |
| `generateTextures` | `boolean` | No | Whether to texture the result (default true). |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `generate_model` (Write)

Compatibility alias for generate_model_native. Generate a 3D model from a text prompt using Roblox GenerationService.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `prompt` | `string` | Yes | Text description of the model to generate. |
| `name` | `string` | No | Name for the generated model. |
| `schema` | `string` | No | Alias for predefinedSchema. |
| `schema_groups` | `array` | No | Alias for parts. |
| `size` | `object` | No |  |
| `max_triangles` | `number` | No | Alias for maxTriangles. |
| `generate_textures` | `boolean` | No | Alias for generateTextures. |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `ui_component_catalog` (Read-only)

Return the UI design system the agent should build against: theme tokens (spacing scale, radius, typography, colors, min text size), canonical component anatomies (button, card, modal, hud_meter, list_row, nav_rail) and concrete design guidance. Read this FIRST before building UI so layouts are consistent instead of ad-hoc, then verify with design_lint and standardize with apply_theme.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|

---

### `apply_theme` (Write)

Standardize an existing UI onto a theme — recolors Frames/buttons/text to the theme tokens, raises sub-readable text to the minimum size, removes hard borders, and adds rounded corners where missing. Use after building (or on legacy UI) to remove "AI slop" inconsistency; pair with ui_component_catalog (the canon) and design_lint (the metric).

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `rootPath` | `string` | Yes | Path to the ScreenGui/GuiObject to theme (e.g. "StarterGui.MainMenu"). |
| `theme` | `string` | No | Theme to apply (default "dark"). |
| `minTextSize` | `number` | No | Raise any text below this size (default 14). |
| `roundCorners` | `boolean` | No | Add a UICorner where missing (default true). |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `design_lint` (Read-only)

Deterministically lint a UI for common quality problems and return scored, structured findings — a cheap, reproducible design-quality metric. Catches: tiny_text (TextSize < 9), offscreen elements, overlapping interactive elements, non_responsive_size (large pure-offset sizing that won't scale), no_layout_container (4+ children with no UIListLayout/UIGridLayout), and stretched_image_no_slice. Use it to drive "make this UI better" and to verify before/after. Geometric checks use edit-mode layout; topbar/safe-area need a playtest.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `rootPath` | `string` | No | Path to a specific ScreenGui/GuiObject (e.g. "StarterGui.MainMenu"). Omit to scan every ScreenGui in StarterGui. |
| `minTextSize` | `number` | No | Minimum readable text size (default 9). |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `design_review` (Read-only)

Vision-based UI critique: screenshots a ScreenGui (temporarily staged so it renders) and asks a vision model to rate visual hierarchy, spacing, color/contrast, alignment and "AI slop" risk, then return specific Roblox-phrased fixes. Run AFTER design_lint passes (lint is the cheap deterministic gate; this is the qualitative amplifier). Requires POLLINATIONS_API_KEY. Pass a ScreenGui path.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `rootPath` | `string` | Yes | Path to the ScreenGui to review (e.g. "StarterGui.MainMenu"). |
| `instruction` | `string` | No | Optional extra focus for the reviewer (e.g. "mobile layout", "is the CTA prominent?"). |
| `model` | `string` | No | Vision model (default "openai-fast"; any vision-capable model from enter.pollinations.ai). |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `diagnose_scripts` (Read-only)

Capture the Studio output log and return a structured report of errors and warnings, with each error mapped to its script path and line where possible. Use to drive "fix all script errors".

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `maxEntries` | `number` | No | How many recent log entries to scan (default 200). |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `list_recipes` (Read-only)

List the available recipes — typed, proven, idempotent build macros (e.g. proximity_door, ambient_sound, kill_brick) — with their parameters. Pick one, then run it with apply_recipe instead of hand-writing the Luau.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|

---

### `apply_recipe` (Write)

Run a recipe (a proven, idempotent build macro) with typed parameters — faster and more reliable than generating gameplay Luau from scratch. Re-running a recipe replaces its named instances rather than duplicating. Use list_recipes to see ids and params.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `recipe` | `string` | Yes | Recipe id from list_recipes (e.g. "proximity_door"). |
| `params` | `object` | No | Recipe-specific parameters (see list_recipes). |
| `instance_id` | `string` | No | Connected Studio place id. Required only when multiple places are open. |

---

### `get_roblox_docs` (Read-only)

Fetch official Roblox engine API documentation as markdown from create.roblox.com. Call this before writing or editing code that uses an engine class, enum, datatype, or Luau library you are not fully certain about (for example ProximityPrompt, Enum.KeyCode, CFrame, TweenService). Results are cached; very large pages are truncated with a section index, and the section parameter reads one section in full.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `name` | `string` | Yes | Exact PascalCase name of the class, enum, datatype, or library, e.g. "ProximityPrompt", "KeyCode", "CFrame", "table". |
| `doc_type` | `string` | No | Documentation category. Defaults to classes. |
| `section` | `string` | No | Optional ##-level section to return instead of the whole page, e.g. "Description", "Properties", "Methods", "Events", "Code Samples". |

---

### `tool_catalog_search` (Read-only)

Find the right tool for a task without loading every tool schema. Returns a compact, ranked list of matching tools (name, domain, read/write, when to use, required args). Use this first when you are unsure which tool to call, then call the tool it points to.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `query` | `string` | Yes | Task or capability you need, e.g. "play a sound", "find a tree model", "read script source". |
| `domains` | `array` | No | Optional: restrict results to these domains. |
| `readOnly` | `boolean` | No | Optional: only return read tools. |
| `limit` | `integer` | No | Max results (default 8). |

---

### `get_session_summary` (Read-only)

Summarize this MCP server session without exposing tool payloads: total tool calls, failures, average duration, per-tool counts, and recent tool names/outcomes. Use when the bridge feels flaky or after a dogfood run to identify timeouts/errors.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|

---

### `load_toolset` (Read-only)

Load one or more tool domains. This expands the advertised MCP tool list and sends tools/list_changed. Some hosts still require their own schema-selection step after receiving that notification; that client-side step cannot be completed by the server. Use --profile core|builder|tester|full to preload common domain groups, or ROBLOX_MCP_LAZY_TOOLS=0|false|off for every schema upfront.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `toolsets` | `array` | Yes | Domains to load (e.g. ["ui","assets"]). Accepts "domain.suffix" shorthand too. |

---

