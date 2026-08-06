// Fitting a foreign model to the scene it landed in.
//
// A model from the marketplace, a Package or an .rbxm almost never arrives
// usable: it is built at whatever scale its author worked in, and its pivot is
// wherever their modelling tool left it — frequently the world origin, which
// makes every subsequent move and rotate behave strangely. Both are mechanical
// to correct and tedious to correct by hand, and both are things an agent
// currently has no way to even see.
//
// A Roblox character is about 5 studs tall, which is the only absolute reference
// the platform gives you; everything else is relative to it.

import { luaString, luaNumber } from './luau-emit.js';

export type PivotPolicy = 'base' | 'center' | 'keep';

/**
 * Reports what would have to change, and returns the same numbers the plan hash
 * is built from. Reads only.
 */
export function buildFitScanLuau(instancePath: string): string {
  return `local target = ${luaString(instancePath)}

local node = game
for segment in string.gmatch(target, "[^%.]+") do
\tif segment ~= "game" then
\t\tnode = node and node:FindFirstChild(segment)
\tend
end
if not node then
\treturn { found = false, path = target }
end
if not node:IsA("Model") then
\treturn { found = true, isModel = false, path = "game." .. node:GetFullName(), className = node.ClassName }
end

local extents = node:GetExtentsSize()
local pivot = node:GetPivot()
local boundsCF = node:GetBoundingBox()
local scale = node:GetScale()

-- Where the pivot sits inside the bounding box, in studs. This is what makes a
-- model rotate around its foot instead of around a point ten studs away.
local offset = boundsCF:PointToObjectSpace(pivot.Position)

local partCount = 0
local unanchored = 0
for _, d in ipairs(node:GetDescendants()) do
\tif d:IsA("BasePart") then
\t\tpartCount = partCount + 1
\t\tif not d.Anchored then unanchored = unanchored + 1 end
\tend
end

return {
\tfound = true,
\tisModel = true,
\tpath = "game." .. node:GetFullName(),
\tclassName = node.ClassName,
\tscale = scale,
\textents = { extents.X, extents.Y, extents.Z },
\tcenter = { boundsCF.Position.X, boundsCF.Position.Y, boundsCF.Position.Z },
\tpivotOffset = { offset.X, offset.Y, offset.Z },
\tpartCount = partCount,
\tunanchoredParts = unanchored,
}`;
}

/**
 * Applies a uniform scale and/or moves the pivot.
 *
 * `ScaleTo` is relative to the model's authored size, so the caller passes the
 * absolute target scale the plan computed rather than a factor — recomputing a
 * factor here against a model that has since been scaled would compound.
 *
 * The pivot move keeps the model where it is on screen: it changes what the
 * pivot *is*, not where the geometry sits.
 */
export function buildFitApplyLuau(instancePath: string, targetScale: number | undefined, pivot: PivotPolicy): string {
  return `local target = ${luaString(instancePath)}
local targetScale = ${targetScale === undefined ? 'nil' : luaNumber(targetScale)}
local pivotPolicy = ${luaString(pivot)}

local node = game
for segment in string.gmatch(target, "[^%.]+") do
\tif segment ~= "game" then
\t\tnode = node and node:FindFirstChild(segment)
\tend
end
if not node or not node:IsA("Model") then
\treturn { ok = false, error = "not a Model: " .. target }
end

local changed = {}

if targetScale ~= nil then
\tlocal before = node:GetScale()
\tnode:ScaleTo(targetScale)
\ttable.insert(changed, { what = "scale", from = before, to = node:GetScale() })
end

if pivotPolicy ~= "keep" then
\tlocal boundsCF, size = node:GetBoundingBox()
\tlocal beforePivot = node:GetPivot().Position
\tlocal newPosition
\tif pivotPolicy == "base" then
\t\t-- Bottom-centre: the point a model should stand on.
\t\tnewPosition = boundsCF.Position - Vector3.new(0, size.Y / 2, 0)
\telse
\t\tnewPosition = boundsCF.Position
\tend
\t-- Rotation is preserved; only the pivot's location moves.
\tnode.WorldPivot = CFrame.new(newPosition) * (node:GetPivot() - node:GetPivot().Position)
\ttable.insert(changed, {
\t\twhat = "pivot",
\t\tfrom = { beforePivot.X, beforePivot.Y, beforePivot.Z },
\t\tto = { newPosition.X, newPosition.Y, newPosition.Z },
\t})
end

local extents = node:GetExtentsSize()
return {
\tok = true,
\tpath = "game." .. node:GetFullName(),
\tchanged = changed,
\tscale = node:GetScale(),
\textents = { extents.X, extents.Y, extents.Z },
}`;
}
