// Helpers for emitting safe Luau literals and expressions from TypeScript.
// The UI / environment / terrain tools generate small Luau snippets that run in
// the Studio plugin's edit context via /api/execute-luau. Centralizing literal
// emission here keeps that generated code injection-safe and consistent.

/** Emit a Luau double-quoted string literal with the dangerous bytes escaped. */
export function luaString(value: string): string {
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
  return `"${escaped}"`;
}

/** Emit a finite Luau number; non-finite values collapse to 0. */
export function luaNumber(value: number): string {
  return Number.isFinite(value) ? String(value) : '0';
}

export function luaBool(value: boolean): string {
  return value ? 'true' : 'false';
}

function clampChannel(channel: number): number {
  return Math.max(0, Math.min(255, Math.round(channel)));
}

/** Emit Color3.fromRGB with channels clamped to integer 0-255. */
export function color3FromRGB(r: number, g: number, b: number): string {
  return `Color3.fromRGB(${clampChannel(r)}, ${clampChannel(g)}, ${clampChannel(b)})`;
}

/** Emit UDim2.new from (scaleX, offsetX, scaleY, offsetY). */
export function udim2(scaleX: number, offsetX: number, scaleY: number, offsetY: number): string {
  return `UDim2.new(${luaNumber(scaleX)}, ${luaNumber(offsetX)}, ${luaNumber(scaleY)}, ${luaNumber(offsetY)})`;
}

/** Emit Vector2.new. */
export function vector2(x: number, y: number): string {
  return `Vector2.new(${luaNumber(x)}, ${luaNumber(y)})`;
}

/** Emit Vector3.new. */
export function vector3(x: number, y: number, z: number): string {
  return `Vector3.new(${luaNumber(x)}, ${luaNumber(y)}, ${luaNumber(z)})`;
}

// A reusable Lua prelude for walking "the place" rather than "the DataModel".
// Studio's own plumbing is parented into the DataModel alongside the developer's
// content and dwarfs it: on an empty baseplate 1676 of 1714 descendants were
// Stats, StylingService, MemStorageService, PluginGuiService and CoreGui. Any
// generator that starts from `game` therefore answers about Studio, not the game
// — scene_search("button") returned 29 hits, every one of them Studio's own UI,
// and a world fingerprint spent 202KB of its payload on noise to carry 3KB of
// content. An explicit path is never filtered, so CoreGui stays reachable.
export const PLACE_SCOPE_LUA = `local DEVELOPER_SERVICES = {
\tWorkspace = true, Players = true, Lighting = true, MaterialService = true,
\tReplicatedFirst = true, ReplicatedStorage = true, ServerScriptService = true,
\tServerStorage = true, StarterGui = true, StarterPack = true, StarterPlayer = true,
\tSoundService = true, Teams = true, Chat = true, TextChatService = true,
\tLocalizationService = true, TestService = true,
}
local function scopedDescendants(root)
\tif root ~= game then return root:GetDescendants() end
\tlocal out = {}
\tfor _, c in ipairs(root:GetChildren()) do
\t\tif DEVELOPER_SERVICES[c.Name] then
\t\t\ttable.insert(out, c)
\t\t\tfor _, d in ipairs(c:GetDescendants()) do table.insert(out, d) end
\t\tend
\tend
\treturn out
end
local function inPlaceScope(root, child)
\treturn root ~= game or DEVELOPER_SERVICES[child.Name] == true
end
local function scopeLabel(root)
\tif root == game then
\t\treturn "place services only (Studio internals such as CoreGui and Stats excluded; pass an explicit path to include them)"
\tend
\treturn "exact subtree"
end`;

// A reusable Lua prelude that resolves a dot-notation DataModel path (e.g.
// "StarterGui.MainGui.Panel" or "game.Workspace.Model") to an Instance. The
// first non-"game" segment is treated as a service; remaining segments are
// FindFirstChild lookups. Returns nil if any segment is missing.
export const PATH_RESOLVER_LUA = `local function resolvePath(path)
\tlocal node = nil
\tfor segment in string.gmatch(path, "[^.]+") do
\t\tif segment == "game" then
\t\t\tnode = game
\t\telseif node == nil then
\t\t\tlocal ok, service = pcall(function() return game:GetService(segment) end)
\t\t\tif ok and service then
\t\t\t\tnode = service
\t\t\telse
\t\t\t\tnode = game:FindFirstChild(segment)
\t\t\tend
\t\telse
\t\t\tnode = node:FindFirstChild(segment)
\t\tend
\t\tif node == nil then return nil end
\tend
\treturn node
end`;
