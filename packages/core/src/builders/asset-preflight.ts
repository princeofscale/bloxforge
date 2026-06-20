// Asset insert preflight. The research review's authoritative finding on the
// marketplace AUTH problem: you cannot reliably tell from search metadata whether
// an asset will insert — `isFree` is a hint, not the truth. The source of truth is
// an actual load. This generator loads the asset with AssetService:LoadAssetAsync
// (the modern replacement for InsertService:LoadAsset, which supports third-party
// assets) into an *isolated, unparented* container, inspects it (root summary,
// script count), then destroys it — so the agent learns insertability and danger
// (bundled scripts) WITHOUT touching the live scene. Runs via execute-luau.

import { luaNumber } from './luau-emit.js';

export function buildAssetPreflightLuau(assetId: number): string {
  const safeId = luaNumber(Math.floor(assetId));
  return `local AssetService = game:GetService("AssetService")
local assetId = ${safeId}
local res = { assetId = assetId }
local ok, modelOrErr = pcall(function() return AssetService:LoadAssetAsync(assetId) end)
if not ok then
\tres.insertabilityVerdict = "no"
\tres.error = tostring(modelOrErr)
\treturn res
end
local container = modelOrErr
local scriptCount = 0
local descendantCount = 0
for _, d in ipairs(container:GetDescendants()) do
\tdescendantCount = descendantCount + 1
\tif d:IsA("LuaSourceContainer") then scriptCount = scriptCount + 1 end
end
local roots = {}
for _, c in ipairs(container:GetChildren()) do
\ttable.insert(roots, { name = c.Name, className = c.ClassName })
end
res.insertabilityVerdict = "yes"
res.hasScripts = scriptCount > 0
res.scriptCount = scriptCount
res.rootCount = #container:GetChildren()
res.descendantCount = descendantCount
res.roots = roots
-- Isolated cleanup: the container was never parented into the live DataModel.
container:Destroy()
return res`;
}
