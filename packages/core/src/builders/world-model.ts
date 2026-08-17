// World-model read generators. The research review's top finding: an agent should
// reason from a token-lean *world snapshot* (signal layers, not the whole
// DataModel), then drill down with a batch read — rather than firing many small
// per-instance calls or one giant get_descendants. Both run via execute-luau, so
// no plugin rebuild is needed.

import { luaString, luaNumber, luaBool, PATH_RESOLVER_LUA, PLACE_SCOPE_LUA } from './luau-emit.js';

// Shared Luau: serialize a Roblox value into a compact JSON-friendly shape so the
// agent gets [x,y,z] / [r,g,b] / names instead of opaque tostring() blobs.
const SERIALIZE_LUA = `local function ser(v)
\tlocal t = typeof(v)
\t-- A property that is genuinely unset is not a value this could not parse.
\t-- Both used to come back looking alike — as the string "nil", and then as an
\t-- opaque wrapper — so a caller could not tell "no value" from "no idea".
\tif v == nil then return { __unset = true } end
\tif t == "Vector3" then return { v.X, v.Y, v.Z }
\telseif t == "Vector2" then return { v.X, v.Y }
\telseif t == "Color3" then return { math.floor(v.R*255+0.5), math.floor(v.G*255+0.5), math.floor(v.B*255+0.5) }
\telseif t == "CFrame" then
\t\t-- Position alone made a CFrame field indistinguishable from Position, and
\t\t-- silently dropped the orientation the caller asked for. Six numbers:
\t\t-- x, y, z, then pitch/yaw/roll in degrees.
\t\tlocal p = v.Position
\t\tlocal rx, ry, rz = v:ToOrientation()
\t\treturn { p.X, p.Y, p.Z, math.deg(rx), math.deg(ry), math.deg(rz) }
\telseif t == "UDim" then return { v.Scale, v.Offset }
\telseif t == "UDim2" then return { v.X.Scale, v.X.Offset, v.Y.Scale, v.Y.Offset }
\telseif t == "Rect" then return { v.Min.X, v.Min.Y, v.Max.X, v.Max.Y }
\telseif t == "NumberRange" then return { v.Min, v.Max }
\telseif t == "Ray" then
\t\tlocal o, d = v.Origin, v.Direction
\t\treturn { o.X, o.Y, o.Z, d.X, d.Y, d.Z }
\telseif t == "Region3" then
\t\t-- Region3 exposes CFrame and Size rather than its corners, so the corners
\t\t-- are derived. Reporting one corner would be a point, not a region.
\t\tlocal c, s = v.CFrame.Position, v.Size / 2
\t\treturn { c.X - s.X, c.Y - s.Y, c.Z - s.Z, c.X + s.X, c.Y + s.Y, c.Z + s.Z }
\telseif t == "NumberSequence" then
\t\tlocal keys = {}
\t\tfor _, k in v.Keypoints do keys[#keys + 1] = { k.Time, k.Value, k.Envelope } end
\t\treturn keys
\telseif t == "ColorSequence" then
\t\tlocal keys = {}
\t\tfor _, k in v.Keypoints do
\t\t\tkeys[#keys + 1] = { k.Time, math.floor(k.Value.R*255+0.5), math.floor(k.Value.G*255+0.5), math.floor(k.Value.B*255+0.5) }
\t\tend
\t\treturn keys
\telseif t == "PhysicalProperties" then
\t\treturn { v.Density, v.Friction, v.Elasticity, v.FrictionWeight, v.ElasticityWeight }
\telseif t == "Faces" then return { v.Top, v.Bottom, v.Left, v.Right, v.Back, v.Front }
\telseif t == "Axes" then return { v.X, v.Y, v.Z }
\telseif t == "BrickColor" then return v.Name
\telseif t == "EnumItem" then return v.Name
\telseif t == "Instance" then return v:GetFullName()
\telseif t == "number" or t == "boolean" or t == "string" then return v
\t-- Anything left is stringified, and says so. An opaque blob that looks like a
\t-- value is how a caller writes back something that is not what it read; a
\t-- blob that names itself is a gap the caller can see.
\telse return { __opaque = tostring(v), __type = t } end
end`;

/**
 * Roblox types this serializer reports structurally rather than as a string.
 *
 * Kept beside the Luau and asserted against `LOSSY_WITHOUT_FULL_SHAPE`: that
 * list names the types a flat value truncates, and every one of them has to be
 * handled here or the list is documentation rather than a guard. `CFrame` was
 * on it once, and losing its rotation was silent precisely because nothing
 * connected the two.
 */
export const STRUCTURED_VALUE_TYPES: readonly string[] = [
  'Vector3', 'Vector2', 'Color3', 'CFrame', 'UDim', 'UDim2', 'Rect', 'NumberRange',
  'Ray', 'Region3', 'NumberSequence', 'ColorSequence', 'PhysicalProperties',
  'Faces', 'Axes', 'BrickColor', 'EnumItem', 'Instance',
];

/**
 * Batch read: resolve several paths in one round-trip and return only the
 * requested fields per node. Replaces a cascade of get_instance_properties /
 * an expensive get_descendants when the agent already knows which nodes it wants.
 */
export function buildNodeBatchLuau(
  paths: string[],
  fields: string[] = [],
  includeChildrenCount = false,
): string {
  const pathList = paths.map((p) => luaString(p)).join(', ');
  const fieldList = fields.map((f) => luaString(f)).join(', ');
  return `${PATH_RESOLVER_LUA}
${SERIALIZE_LUA}
local paths = { ${pathList} }
local fields = { ${fieldList} }
local out = {}
for _, p in ipairs(paths) do
\tlocal inst = resolvePath(p)
\tif not inst then
\t\ttable.insert(out, { path = p, error = "not found" })
\telse
\t\tlocal row = { path = p, name = inst.Name, className = inst.ClassName }
\t\tif #fields > 0 then
\t\t\tlocal props = {}
\t\t\tfor _, f in ipairs(fields) do
\t\t\t\tlocal ok, val = pcall(function() return inst[f] end)
\t\t\t\tif ok then props[f] = ser(val) end
\t\t\tend
\t\t\trow.props = props
\t\tend
\t\tif ${luaBool(includeChildrenCount)} then row.childCount = #inst:GetChildren() end
\t\ttable.insert(out, row)
\tend
end
return { nodes = out, count = #out }`;
}

export type SnapshotLevel = 'overview' | 'standard';

/**
 * Token-lean world snapshot for reasoning before drill-down. `overview` returns
 * place info, class/tag/audio/script counts, notable subtree roots, and the
 * environment summary — enough to answer "where is the UI", "is there music",
 * "is the scene heavy", "are there tags" without dumping the tree.
 */
export function buildWorldSnapshotLuau(
  path = 'game',
  level: SnapshotLevel = 'overview',
  topNPerClass = 12,
): string {
  const safePath = luaString(path);
  const safeTopN = luaNumber(Math.max(1, Math.floor(topNPerClass)));
  return `${PATH_RESOLVER_LUA}
${PLACE_SCOPE_LUA}
local root = resolvePath(${safePath})
if not root then return { error = "Path not found: " .. ${safePath} } end

local descendants = scopedDescendants(root)

local byClass = {}
local total = 0
local soundCount, soundPlaying, soundLooped = 0, 0, 0
local scriptCount, localScriptCount, moduleCount = 0, 0, 0
local taggedCount = 0
for _, d in ipairs(descendants) do
		if _G.__mcp and _G.__mcp.checkCancelled and _G.__mcp.checkCancelled() then return { cancelled = true } end
\tif _G.__mcp and _G.__mcp.checkCancelled and _G.__mcp.checkCancelled() then return { cancelled = true } end
\ttotal = total + 1
\tbyClass[d.ClassName] = (byClass[d.ClassName] or 0) + 1
\tif d:IsA("Sound") then
\t\tsoundCount = soundCount + 1
\t\tlocal ok1, playing = pcall(function() return d.Playing end)
\t\tif ok1 and playing then soundPlaying = soundPlaying + 1 end
\t\tlocal ok2, looped = pcall(function() return d.Looped end)
\t\tif ok2 and looped then soundLooped = soundLooped + 1 end
\telseif d:IsA("LocalScript") then localScriptCount = localScriptCount + 1
\telseif d:IsA("ModuleScript") then moduleCount = moduleCount + 1
\telseif d:IsA("Script") then scriptCount = scriptCount + 1
\tend
\tlocal okt, tags = pcall(function() return #d:GetTags() > 0 end)
\tif okt and tags then taggedCount = taggedCount + 1 end
end

local arr = {}
for cls, n in pairs(byClass) do table.insert(arr, { className = cls, count = n }) end
-- Ties break by name. Without it the order comes from pairs(), which is
-- unspecified: two reads of an unchanged scene could disagree, and an agent
-- diffing them sees changes that did not happen.
table.sort(arr, function(a, b)
\tif a.count ~= b.count then return a.count > b.count end
\treturn a.className < b.className
end)
local top = {}
for i = 1, math.min(${safeTopN}, #arr) do top[i] = arr[i] end

-- Notable subtree roots: direct children of the root that actually contain
-- something. At game level this would otherwise dump ~110 empty services and
-- defeat the token-lean purpose, so skip childless roots and cap the list.
local roots = {}
local ROOT_LIMIT = 30
for _, c in ipairs(root:GetChildren()) do
\tlocal childCount = #c:GetChildren()
\tif childCount > 0 and inPlaceScope(root, c) then
\t\ttable.insert(roots, { name = c.Name, className = c.ClassName, path = c:GetFullName(), childCount = childCount })
\tend
\tif #roots >= ROOT_LIMIT then break end
end

-- Environment summary (global Lighting + presence of key atmosphere objects).
-- Read individual properties through pcall: some (e.g. Lighting.Technology) need
-- the RobloxScript capability and throw under the plugin's PluginSecurity context.
local env = {}
local function safeGet(fn)
\tlocal ok, v = pcall(fn)
\tif ok then return v end
\treturn nil
end
local lighting = game:GetService("Lighting")
if lighting then
\tenv.clockTime = safeGet(function() return lighting.ClockTime end)
\tenv.technology = safeGet(function() return tostring(lighting.Technology) end)
\tenv.hasAtmosphere = lighting:FindFirstChildOfClass("Atmosphere") ~= nil
\tenv.hasSky = lighting:FindFirstChildOfClass("Sky") ~= nil
end
local ws = game:GetService("Workspace")
env.hasTerrain = ws and ws:FindFirstChildOfClass("Terrain") ~= nil
env.hasClouds = ws and ws.Terrain ~= nil and ws.Terrain:FindFirstChildOfClass("Clouds") ~= nil

local snapshot = {
\troot = ${safePath},
\tlevel = ${luaString(level)},
\t-- Say so rather than quietly returning different numbers than the DataModel holds.
\tscope = scopeLabel(root),
\tplace = { placeId = game.PlaceId, name = game.Name },
\tcounts = {
\t\ttotalDescendants = total,
\t\tdistinctClasses = #arr,
\t\ttagged = taggedCount,
\t\tsounds = soundCount,
\t\tsoundsPlaying = soundPlaying,
\t\tsoundsLooped = soundLooped,
\t\tscripts = scriptCount,
\t\tlocalScripts = localScriptCount,
\t\tmoduleScripts = moduleCount,
\t},
\ttopClasses = top,
\troots = roots,
\tenvironment = env,
}
return snapshot`;
}
