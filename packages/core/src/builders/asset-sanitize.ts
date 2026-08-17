// Sanitising a model that is already in the scene.
//
// `asset_preflight_insert` answers "can I insert asset 123, and does it carry
// scripts" before anything is parented. It counts them; it does not read them,
// and it cannot help once a model is already sitting in Workspace — which is
// where a model arrives when it came from a Package, an .rbxm, a collaborator,
// or an insert made before anyone thought to preflight it.
//
// This pair reads what those scripts actually do and then neutralises them. The
// scan is a read; the apply disables or removes, inside one undo waypoint, and
// only against a subtree that still hashes to what the scan recorded.

import { luaString } from './luau-emit.js';

/**
 * Patterns worth reporting in a model you did not write. Each is a capability
 * the model would exercise at runtime, not a style opinion — the point is to
 * let a caller see "this decorative tree opens an HTTP connection" before it
 * ships, not to lint someone's code.
 *
 * Kept as Luau string.find patterns (not regex) and matched against the source
 * with plain=false so the character classes work.
 */
export const SANITIZE_PATTERNS: Array<{ id: string; pattern: string; why: string }> = [
  { id: 'require_asset_id', pattern: 'require%s*%(%s*%d+', why: 'loads and runs another asset from Roblox at runtime; its contents are not in this place and can change under you' },
  { id: 'http_request', pattern: 'HttpService', why: 'reaches the network' },
  { id: 'dynamic_code', pattern: 'loadstring%s*%(', why: 'builds code at runtime, so what it runs cannot be read here' },
  { id: 'env_access', pattern: '[gs]etfenv%s*%(', why: 'rewrites the environment of another function, commonly used to hide behaviour' },
  { id: 'purchase_prompt', pattern: 'Prompt%a*Purchase', why: 'prompts the player to spend Robux' },
  { id: 'player_kick', pattern: ':Kick%s*%(', why: 'can remove players from the experience' },
  { id: 'datastore', pattern: 'DataStoreService', why: 'reads or writes your persistent player data' },
  { id: 'teleport', pattern: 'TeleportService', why: 'can send players to another place' },
  { id: 'remote_creation', pattern: 'Instance%.new%s*%(%s*["\']Remote', why: 'creates a client/server channel at runtime' },
];

/**
 * Reads every script under `instancePath`, plus any remote objects, and returns
 * the material for both the report and the plan hash. Source text itself is NOT
 * returned — only its length and the matched pattern ids — because a foreign
 * model can carry a great deal of source and none of it needs to reach the
 * model's context to make this decision. `get_script_source` is there for a
 * caller who wants to read one.
 */
export function buildSanitizeScanLuau(instancePath: string): string {
  const patternRows = SANITIZE_PATTERNS
    .map((p) => `\t{ id = ${luaString(p.id)}, pattern = ${luaString(p.pattern)} },`)
    .join('\n');

  return `local target = ${luaString(instancePath)}
local ScriptEditorService = game:GetService("ScriptEditorService")
local PATTERNS = {
${patternRows}
}

local node = game
for segment in string.gmatch(target, "[^%.]+") do
\tif segment ~= "game" then
\t\tnode = node and node:FindFirstChild(segment)
\tend
end
if not node then
\treturn { found = false, path = target }
end

-- ponytail: djb2, not sha256 — Luau exposes no hash to a plugin, and the plan
-- hash needs *some* content signal because source length alone lets an edit of
-- the same size pass as unchanged. Collisions are conceivable but this guards
-- against drift, not against an attacker who controls the file and the clock.
-- Upgrade path: a real digest if Roblox ever exposes one to plugins.
-- The accumulator stays under 2^53 (4294967295 * 33 + 255), so no precision loss.
local function checksum(s)
\tlocal h = 5381
\tfor i = 1, #s do
\t\th = (h * 33 + string.byte(s, i)) % 4294967296
\tend
\treturn h
end

-- The editor buffer is the truth for an open script; Source can lag behind it.
local function readSource(inst)
\tlocal ok, text = pcall(function()
\t\tlocal doc = ScriptEditorService:FindScriptDocument(inst)
\t\treturn doc and doc:GetText() or nil
\tend)
\tif ok and text then return text end
\tlocal ok2, src = pcall(function() return inst.Source end)
\treturn ok2 and src or ""
end

local scripts = {}
local remotes = {}
local descendantCount = 0

local function inspect(inst)
\tdescendantCount = descendantCount + 1
\tif inst:IsA("LuaSourceContainer") then
\t\tlocal source = readSource(inst)
\t\tlocal findings = {}
\t\tfor _, p in ipairs(PATTERNS) do
\t\t\tif string.find(source, p.pattern) then
\t\t\t\ttable.insert(findings, p.id)
\t\t\tend
\t\tend
\t\tlocal enabled = nil
\t\tif inst:IsA("BaseScript") then enabled = inst.Enabled end
\t\ttable.insert(scripts, {
\t\t\tpath = "game." .. inst:GetFullName(),
\t\t\tname = inst.Name,
\t\t\tclassName = inst.ClassName,
\t\t\tenabled = enabled,
\t\t\tsourceBytes = #source,
\t\t\tsourceChecksum = checksum(source),
\t\t\tfindings = findings,
\t\t})
\telseif inst:IsA("RemoteEvent") or inst:IsA("RemoteFunction") or inst:IsA("UnreliableRemoteEvent") then
\t\ttable.insert(remotes, { path = "game." .. inst:GetFullName(), className = inst.ClassName })
\tend
end

inspect(node)
for _, d in ipairs(node:GetDescendants()) do
\tinspect(d)
end

return {
\tfound = true,
\tpath = "game." .. node:GetFullName(),
\tclassName = node.ClassName,
\tdescendantCount = descendantCount,
\tscripts = scripts,
\tremotes = remotes,
}`;
}

export type SanitizeAction = 'disable' | 'remove';

/**
 * Disables or removes the scripts the scan found.
 *
 * `disable` only works on a BaseScript — a ModuleScript has no Enabled — so a
 * plan containing ModuleScripts reports them as un-disableable rather than
 * quietly leaving them live. `remove` unparents rather than Destroy()s, which
 * is what makes it undoable.
 *
 * The caller passes the exact paths the plan recorded, and only a script the
 * plan named is touched — one added between plan and apply is left alone rather
 * than swept up in an operation the caller never previewed.
 *
 * Those paths are matched against a walk of the subtree, not resolved through
 * `FindFirstChild`. Two children may share a name, which in a foreign model
 * usually means two `Script`s called "Script": resolving the same path twice
 * returned the same instance twice, so one script was disabled twice, the other
 * stayed live, and the receipt said two were disabled. On `remove` the second
 * resolve unparented an instance the caller never saw. A path is a description
 * of a place in the tree, and this walks the tree.
 */
export function buildSanitizeApplyLuau(rootPath: string, scriptPaths: string[], action: SanitizeAction): string {
  const counts = new Map<string, number>();
  for (const path of scriptPaths) counts.set(path, (counts.get(path) ?? 0) + 1);
  const rows = [...counts].map(([path, n]) => `\t[${luaString(path)}] = ${n},`).join('\n');
  return `local ROOT = ${luaString(rootPath)}
-- How many instances the plan recorded at each path. Not a set: duplicate names
-- are the common case in a model you did not write.
local WANTED = {
${rows}
}
local action = ${luaString(action)}
local applied, skipped = {}, {}

local function resolve(full)
\tlocal node = game
\tfor segment in string.gmatch(full, "[^%.]+") do
\t\tif segment ~= "game" then
\t\t\tnode = node and node:FindFirstChild(segment)
\t\tend
\tend
\treturn node
end

local root = resolve(ROOT)
if not root then
\treturn { action = action, applied = {}, skipped = {}, appliedCount = 0, skippedCount = 0, error = "not found: " .. ROOT }
end

local function act(inst, full)
\tif action == "disable" then
\t\tif inst:IsA("BaseScript") then
\t\t\tinst.Enabled = false
\t\t\ttable.insert(applied, { path = full, action = "disabled" })
\t\telse
\t\t\ttable.insert(skipped, { path = full, reason = "ModuleScript has no Enabled; use action \\"remove\\" or leave it and audit its callers" })
\t\tend
\telse
\t\t-- Unparent rather than Destroy so the change stays undoable.
\t\tinst.Parent = nil
\t\ttable.insert(applied, { path = full, action = "removed" })
\tend
end

local function visit(inst)
\tif not inst:IsA("LuaSourceContainer") then return end
\tlocal full = "game." .. inst:GetFullName()
\tlocal remaining = WANTED[full]
\tif remaining and remaining > 0 then
\t\tWANTED[full] = remaining - 1
\t\tact(inst, full)
\tend
end

visit(root)
for _, d in ipairs(root:GetDescendants()) do visit(d) end

-- Anything the plan named and the walk did not reach. Sorted, because pairs()
-- order is unspecified and this list ends up in a receipt the caller diffs.
local unmatched = {}
for full, remaining in pairs(WANTED) do
\tif remaining > 0 then table.insert(unmatched, { path = full, remaining = remaining }) end
end
table.sort(unmatched, function(a, b) return a.path < b.path end)
for _, row in ipairs(unmatched) do
\ttable.insert(skipped, {
\t\tpath = row.path,
\t\treason = string.format("%d of the scripts the plan recorded at this path were not found under %s", row.remaining, ROOT),
\t})
end

return { action = action, applied = applied, skipped = skipped, appliedCount = #applied, skippedCount = #skipped }`;
}
