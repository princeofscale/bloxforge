// Where things physically are.
//
// Every other read tool in this repo answers a question about the *tree*: what
// classes exist, what is named what, which script controls the day/night cycle.
// None of them answer the question an agent has to answer before it can place a
// single part: how big is the world, where is the floor, and which patch of it
// is empty. Names and classes cannot tell you that a new building would land
// inside an existing one.
//
// This returns a fixed-cost spatial picture: the bounding volume, the ground
// plane if there is one, the largest things and where they sit, and a coarse
// occupancy grid over the XZ plane. The grid is the point — a few hundred
// characters that say where the free space is, instead of thousands of stud
// coordinates the agent would have to intersect itself.

import { luaString, luaNumber, PATH_RESOLVER_LUA } from './luau-emit.js';

/** Above this share of the grid a part is scenery, not an obstacle. */
export const BROAD_PART_COVERAGE = 0.4;

/** Parts scanned before the walk gives up and says so. */
export const SCAN_LIMIT = 20000;

/**
 * Reads only. Everything is derived in one descendant walk so the cost does not
 * grow with how much of the answer the caller wants.
 */
export function buildSpatialLayoutLuau(path: string, gridSize: number, topLandmarks: number): string {
  return `${PATH_RESOLVER_LUA}

local root = resolvePath(${luaString(path)})
if not root then
\treturn { found = false, path = ${luaString(path)} }
end

local GRID = ${luaNumber(gridSize)}
local TOP = ${luaNumber(topLandmarks)}
local LIMIT = ${luaNumber(SCAN_LIMIT)}
local BROAD = ${luaNumber(BROAD_PART_COVERAGE)}

local function r1(v)
\treturn math.floor(v * 10 + 0.5) / 10
end

-- World-axis half-extents of a rotated part: project each local axis onto the
-- world axis and add. A rotated 1x1x10 beam occupies more X than its Size says.
local function aabb(part)
\tlocal cf, s = part.CFrame, part.Size
\tlocal r, u, l = cf.RightVector, cf.UpVector, cf.LookVector
\tlocal hx = math.abs(r.X) * s.X / 2 + math.abs(u.X) * s.Y / 2 + math.abs(l.X) * s.Z / 2
\tlocal hy = math.abs(r.Y) * s.X / 2 + math.abs(u.Y) * s.Y / 2 + math.abs(l.Y) * s.Z / 2
\tlocal hz = math.abs(r.Z) * s.X / 2 + math.abs(u.Z) * s.Y / 2 + math.abs(l.Z) * s.Z / 2
\tlocal p = cf.Position
\treturn p.X - hx, p.X + hx, p.Y - hy, p.Y + hy, p.Z - hz, p.Z + hz
end

local parts = {}
local spawns = {}
local scanned = 0
local truncated = false
local minX, maxX = math.huge, -math.huge
local minY, maxY = math.huge, -math.huge
local minZ, maxZ = math.huge, -math.huge

for _, d in ipairs(root:GetDescendants()) do
\tscanned = scanned + 1
\tif scanned > LIMIT then
\t\ttruncated = true
\t\tbreak
\tend
\tif d:IsA("SpawnLocation") then
\t\t-- Every spawn is collected, not the first twelve. The list is capped only
\t\t-- where it is reported: the ground-confidence test below asks whether *a*
\t\t-- spawn rests on the candidate floor, and stopping at twelve made that
\t\t-- answer depend on traversal order in a place with more. Bounded by the
\t\t-- scan LIMIT above, which is what keeps this from being unbounded.
\t\t-- CFrame.Position rather than .Position: the same value, and the one a
\t\t-- non-Studio Luau host can actually read.
\t\tlocal p = d.CFrame.Position
\t\ttable.insert(spawns, { path = "game." .. d:GetFullName(), position = { r1(p.X), r1(p.Y), r1(p.Z) } })
\tend
\t-- Terrain is a BasePart but has no meaningful CFrame/Size of its own.
\tif d:IsA("BasePart") and not d:IsA("Terrain") then
\t\tlocal x0, x1, y0, y1, z0, z1 = aabb(d)
\t\ttable.insert(parts, { x0 = x0, x1 = x1, y0 = y0, y1 = y1, z0 = z0, z1 = z1, inst = d })
\t\tif x0 < minX then minX = x0 end
\t\tif x1 > maxX then maxX = x1 end
\t\tif y0 < minY then minY = y0 end
\t\tif y1 > maxY then maxY = y1 end
\t\tif z0 < minZ then minZ = z0 end
\t\tif z1 > maxZ then maxZ = z1 end
\tend
end

-- Reported spawns are capped; the count says how many there were, so a short
-- list is not read as "this is every spawn in the place".
local SPAWN_REPORT_LIMIT = 12
local spawnCount = #spawns
local reportedSpawns = spawns
if spawnCount > SPAWN_REPORT_LIMIT then
\treportedSpawns = {}
\tfor i = 1, SPAWN_REPORT_LIMIT do reportedSpawns[i] = spawns[i] end
end

if #parts == 0 then
\treturn {
\t\tfound = true,
\t\tpath = "game." .. root:GetFullName(),
\t\tpartCount = 0,
\t\tspawns = reportedSpawns,
\t\tspawnCount = spawnCount,
\t\tspawnsTruncated = spawnCount > #reportedSpawns,
\t\ttruncated = truncated,
\t}
end

-- The ground: the widest flat thing. A tall wall can have a large footprint too,
-- so require it to be flat relative to its own span before calling it a floor.
--
-- This is a guess, and the response says so. Everything else here is measured —
-- bounds, the occupancy grid, the SpawnLocations — but the floor is inferred,
-- and it is the one an agent builds on top of. The rule has already been wrong
-- once in testing (a 390x300x2 wall), and it stays wrong for a flat roof above
-- the real floor, a water plane, or a ceiling. So the candidate carries a
-- confidence and the evidence behind it rather than arriving as a fact.
local ground = nil
local groundArea = 0
local runnerUpArea = 0
for _, p in ipairs(parts) do
\tlocal dx, dz = p.x1 - p.x0, p.z1 - p.z0
\tlocal dy = p.y1 - p.y0
\tlocal area = dx * dz
\tif dy <= 0.25 * math.min(dx, dz) then
\t\tif area > groundArea then
\t\t\trunnerUpArea = groundArea
\t\t\tgroundArea = area
\t\t\tground = p
\t\telseif area > runnerUpArea then
\t\t\trunnerUpArea = area
\t\tend
\tend
end

local cellX = math.max((maxX - minX) / GRID, 0.001)
local cellZ = math.max((maxZ - minZ) / GRID, 0.001)
local counts = {}
for row = 1, GRID do
\tcounts[row] = {}
\tfor col = 1, GRID do counts[row][col] = 0 end
end

local broadParts = 0
for _, p in ipairs(parts) do
\tlocal c0 = math.max(1, math.min(GRID, math.floor((p.x0 - minX) / cellX) + 1))
\tlocal c1 = math.max(1, math.min(GRID, math.floor((p.x1 - minX) / cellX) + 1))
\tlocal r0 = math.max(1, math.min(GRID, math.floor((p.z0 - minZ) / cellZ) + 1))
\tlocal r1i = math.max(1, math.min(GRID, math.floor((p.z1 - minZ) / cellZ) + 1))
\t-- A baseplate covers every cell and would render the grid uniformly full.
\tif ((c1 - c0 + 1) * (r1i - r0 + 1)) > BROAD * GRID * GRID then
\t\tbroadParts = broadParts + 1
\telse
\t\tfor row = r0, r1i do
\t\t\tfor col = c0, c1 do
\t\t\t\tcounts[row][col] = counts[row][col] + 1
\t\t\tend
\t\tend
\tend
end

-- Rows run north (high Z) to south, so the grid reads like a map.
local rows = {}
for row = GRID, 1, -1 do
\tlocal chars = {}
\tfor col = 1, GRID do
\t\tlocal n = counts[row][col]
\t\tif n == 0 then
\t\t\tchars[col] = "."
\t\telseif n >= 10 then
\t\t\tchars[col] = "#"
\t\telse
\t\t\tchars[col] = tostring(n)
\t\tend
\tend
\ttable.insert(rows, table.concat(chars))
end

-- Landmarks are the root's own children, not individual parts: an agent reasons
-- about "the tower", not about the 40 bricks it is made of.
local landmarks = {}
for _, child in ipairs(root:GetChildren()) do
\tlocal size, pos, kind
\tif child:IsA("Model") then
\t\tlocal cf, s = child:GetBoundingBox()
\t\tsize, pos, kind = s, cf.Position, "Model"
\telseif child:IsA("BasePart") and not child:IsA("Terrain") then
\t\tlocal x0, x1, y0, y1, z0, z1 = aabb(child)
\t\tsize = Vector3.new(x1 - x0, y1 - y0, z1 - z0)
\t\tpos = Vector3.new((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)
\t\tkind = child.ClassName
\tend
\tif size then
\t\ttable.insert(landmarks, {
\t\t\tname = child.Name,
\t\t\tclassName = kind,
\t\t\tposition = { r1(pos.X), r1(pos.Y), r1(pos.Z) },
\t\t\tsize = { r1(size.X), r1(size.Y), r1(size.Z) },
\t\t\t_v = size.X * size.Y * size.Z,
\t\t})
\tend
end
-- Ties break by name and then by position. Two parts of identical volume are
-- common — a pair of walls, a row of crates — and which one was called a
-- landmark should not depend on traversal order. Landmarks carry no path, so
-- name plus position is what distinguishes them; two entries alike in all four
-- are indistinguishable in the output as well, and their order cannot matter.
table.sort(landmarks, function(a, b)
\tif a._v ~= b._v then return a._v > b._v end
\tif a.name ~= b.name then return a.name < b.name end
\tfor i = 1, 3 do
\t\tif a.position[i] ~= b.position[i] then return a.position[i] < b.position[i] end
\tend
\treturn false
end)
while #landmarks > TOP do table.remove(landmarks) end
for _, l in ipairs(landmarks) do l._v = nil end

local result = {
\tfound = true,
\tpath = "game." .. root:GetFullName(),
\tpartCount = #parts,
\ttruncated = truncated,
\tbounds = {
\t\tmin = { r1(minX), r1(minY), r1(minZ) },
\t\tmax = { r1(maxX), r1(maxY), r1(maxZ) },
\t\tsize = { r1(maxX - minX), r1(maxY - minY), r1(maxZ - minZ) },
\t},
\tgrid = {
\t\tsize = GRID,
\t\tcell = { r1(cellX), r1(cellZ) },
\t\torigin = { r1(minX), r1(minZ) },
\t\tbroadParts = broadParts,
\t\trows = rows,
\t},
\tlandmarks = landmarks,
\tspawns = reportedSpawns,
\tspawnCount = spawnCount,
\tspawnsTruncated = spawnCount > #reportedSpawns,
}

if ground then
\t-- Deterministic evidence, scored deterministically. Three signals, each one
\t-- something a person would check by eye:
\t--   * a SpawnLocation resting just above it — players are put on the floor,
\t--     so this is the strongest confirmation available without rendering;
\t--   * no rival flat surface of comparable area, which is what a roof or a
\t--     second storey would look like;
\t--   * nothing large and flat below it, which is what being a roof looks like.
\tlocal confidence = 0.5
\tlocal basis = {}
\ttable.insert(basis, string.format("largest flat surface, %d studs squared", math.floor(groundArea + 0.5)))

\tlocal spawnAbove = nil
\tfor _, s in ipairs(spawns) do
\t\tlocal dy = s.position[2] - ground.y1
\t\tif dy >= -1 and dy <= 8 then spawnAbove = r1(dy) break end
\tend
\tif spawnAbove then
\t\tconfidence = confidence + 0.25
\t\ttable.insert(basis, string.format("a SpawnLocation rests %.1f studs above it", spawnAbove))
\tend

\tif runnerUpArea < 0.6 * groundArea then
\t\tconfidence = confidence + 0.15
\t\ttable.insert(basis, "no rival flat surface within 60% of its area")
\telse
\t\ttable.insert(basis, string.format(
\t\t\t"another flat surface covers %d studs squared, so this may be the wrong storey",
\t\t\tmath.floor(runnerUpArea + 0.5)))
\tend

\tlocal below = nil
\tfor _, p in ipairs(parts) do
\t\tlocal dx, dz = p.x1 - p.x0, p.z1 - p.z0
\t\tif p.y1 < ground.y0 - 1 and (p.y1 - p.y0) <= 0.25 * math.min(dx, dz)
\t\t\tand dx * dz > 0.5 * groundArea then
\t\t\tbelow = p
\t\t\tbreak
\t\tend
\tend
\tif below then
\t\tconfidence = confidence - 0.25
\t\ttable.insert(basis, string.format(
\t\t\t"%s is flat, comparably large, and lower — this may be a roof over it",
\t\t\t"game." .. below.inst:GetFullName()))
\tend

\tresult.ground = {
\t\tpath = "game." .. ground.inst:GetFullName(),
\t\ttopY = r1(ground.y1),
\t\tspan = { r1(ground.x1 - ground.x0), r1(ground.z1 - ground.z0) },
\t\tmaterial = ground.inst.Material.Name,
\t\t-- Never 1: this is a guess, and a tool that reports certainty it does not
\t\t-- have is worse than one that reports nothing.
\t\tinferred = true,
\t\tconfidence = math.max(0.05, math.min(0.95, r1(confidence))),
\t\tbasis = basis,
\t}
end

local terrain = game:GetService("Workspace"):FindFirstChildOfClass("Terrain")
if terrain then
\tlocal ok, cells = pcall(function() return terrain:CountCells() end)
\tresult.terrainCells = ok and cells or 0
end

return result`;
}
