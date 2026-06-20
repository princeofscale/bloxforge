// World fingerprint generator for get_changes_since. Captures a cheap per-node
// signature (className + child count) keyed by full path, so the server can diff
// two captures and report added/removed/changed nodes without the agent
// re-pulling the whole world after every action. Runs via execute-luau.

import { luaString, luaNumber, PATH_RESOLVER_LUA } from './luau-emit.js';

export function buildWorldFingerprintLuau(path = 'game', maxNodes = 8000): string {
	const safePath = luaString(path);
	const safeMax = luaNumber(Math.max(1, Math.floor(maxNodes)));
	return `${PATH_RESOLVER_LUA}
local root = resolvePath(${safePath})
if not root then return { error = "Path not found: " .. ${safePath} } end
local fp = {}
local count = 0
local truncated = false
for _, d in ipairs(root:GetDescendants()) do
\tif count >= ${safeMax} then truncated = true break end
\tlocal ok, full = pcall(function() return d:GetFullName() end)
\tif ok then
\t\tfp[full] = d.ClassName .. "|" .. tostring(#d:GetChildren())
\t\tcount = count + 1
\tend
end
return { fingerprint = fp, count = count, truncated = truncated, root = ${safePath} }`;
}
