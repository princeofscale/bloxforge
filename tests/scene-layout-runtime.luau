-- Runs the Luau that get_spatial_layout generates, against a real DataModel,
-- without Roblox Studio.
--
-- The occupancy grid and the world-axis bounding boxes are the only parts of
-- that tool an agent actually reasons from, and both live in generated Luau
-- where the Jest suite cannot reach them. Lune gives real CFrame, Vector3 and
-- Instance semantics, so the arithmetic can be checked here instead of only
-- against a live Studio.
--
-- Not covered: Model:GetBoundingBox(), which Lune does not implement, so the
-- landmark path is exercised for BaseParts only.
--
-- Run: node scripts/test-scene-layout-runtime.mjs

local roblox = require("@lune/roblox")
local luau = require("@lune/luau")
local fs = require("@lune/fs")
local process = require("@lune/process")

local passed, failed = 0, 0

local function check(label, ok, detail)
	if ok then
		passed += 1
	else
		failed += 1
		print(string.format("  x %s%s", label, detail and (": " .. detail) or ""))
	end
end

local function eq(label, actual, expected)
	check(label, actual == expected, string.format("expected %s, got %s", tostring(expected), tostring(actual)))
end

local function near(label, actual, expected, tolerance)
	check(label, math.abs(actual - expected) <= tolerance,
		string.format("expected ~%s, got %s", tostring(expected), tostring(actual)))
end

local codePath = process.args[1]
if not codePath then
	print("usage: lune tests/scene-layout-runtime.luau <generated.luau>")
	process.exit(1)
end
local code = fs.readFile(codePath)

-- A place shaped to catch the three things that would silently be wrong:
-- a baseplate swallowing the grid, a rotated part measured by its Size, and a
-- ground guess landing on something that is not the floor.
local dm = roblox.Instance.new("DataModel")
local ws = dm:GetService("Workspace")

local ground = roblox.Instance.new("Part")
ground.Name = "Ground"
ground.Anchored = true
ground.Size = roblox.Vector3.new(400, 1, 400)
ground.CFrame = roblox.CFrame.new(0, 0, 0)
ground.Parent = ws

local spawn = roblox.Instance.new("SpawnLocation")
spawn.Name = "SpawnLocation"
spawn.Anchored = true
spawn.Size = roblox.Vector3.new(6, 1, 6)
spawn.CFrame = roblox.CFrame.new(0, 1, 0)
spawn.Parent = ws

-- Three towers clustered in the +X/+Z quadrant.
for i = 1, 3 do
	local tower = roblox.Instance.new("Part")
	tower.Name = "Tower" .. i
	tower.Anchored = true
	tower.Size = roblox.Vector3.new(30, 60, 30)
	tower.CFrame = roblox.CFrame.new(60 + i * 45, 30, 120)
	tower.Parent = ws
end

-- A beam whose Size says four studs of X but which lies along X for eighty.
local beam = roblox.Instance.new("Part")
beam.Name = "Beam"
beam.Anchored = true
beam.Size = roblox.Vector3.new(4, 4, 80)
beam.CFrame = roblox.CFrame.new(-120, 3, -120) * roblox.CFrame.Angles(0, math.rad(90), 0)
beam.Parent = ws

local run = luau.load(code, {
	environment = {
		game = dm,
		workspace = ws,
		Vector3 = roblox.Vector3,
		CFrame = roblox.CFrame,
	},
})
local ok, result = pcall(run)
if not ok then
	print("  x generated Luau failed to run: " .. tostring(result))
	process.exit(1)
end

print("get_spatial_layout generated Luau (Lune):")

eq("found", result.found, true)
eq("path", result.path, "game.Workspace")
eq("partCount counts every BasePart, SpawnLocation included", result.partCount, 6)

-- Bounds must come from the world-axis boxes, not from Size. The beam reaches
-- x = -160 only if its local Z axis was projected onto world X.
near("bounds.min.x reaches the far end of the rotated beam", result.bounds.min[1], -200, 0.01)
near("bounds.max.x reaches the far tower", result.bounds.max[1], 210, 0.01)
near("bounds.max.y is the tower top", result.bounds.max[2], 60, 0.01)

eq("ground is the wide flat part", result.ground.path, "game.Workspace.Ground")
near("ground.topY is the surface, not the centre", result.ground.topY, 0.5, 0.01)

eq("one spawn found", #result.spawns, 1)
eq("spawn path", result.spawns[1].path, "game.Workspace.SpawnLocation")

eq("the baseplate is excluded from the grid", result.grid.broadParts, 1)
eq("grid has one row per cell", #result.grid.rows, result.grid.size)
eq("every row is as wide as the grid", #result.grid.rows[1], result.grid.size)

-- Rows run north first, so row 1 is the highest Z. Deriving the index from the
-- returned origin and cell size also proves those three agree with each other.
local function rowFor(z)
	local raw = math.floor((z - result.grid.origin[2]) / result.grid.cell[2]) + 1
	raw = math.max(1, math.min(result.grid.size, raw))
	return result.grid.size - raw + 1
end
local function occupied(row)
	local n = 0
	for i = 1, #row do
		if row:sub(i, i) ~= "." then n += 1 end
	end
	return n
end

local beamRow = result.grid.rows[rowFor(-120)]
check("the rotated beam spans several cells of X",
	occupied(beamRow) >= 3,
	string.format("row %q has %d occupied cells; a beam measured by Size would occupy 1", beamRow, occupied(beamRow)))

local towerRow = result.grid.rows[rowFor(120)]
check("the towers register in their own row", occupied(towerRow) >= 3,
	string.format("row %q has %d occupied cells", towerRow, occupied(towerRow)))

local emptyRow = result.grid.rows[rowFor(0)]
check("the middle of the place reads as free once the baseplate is excluded",
	occupied(emptyRow) <= 1,
	string.format("row %q has %d occupied cells; only the spawn belongs there", emptyRow, occupied(emptyRow)))

-- A tall thin wall has a large footprint too and must not be mistaken for ground.
local wall = roblox.Instance.new("Part")
wall.Name = "Wall"
wall.Anchored = true
wall.Size = roblox.Vector3.new(390, 300, 2)
wall.CFrame = roblox.CFrame.new(0, 150, 190)
wall.Parent = ws

local ok2, result2 = pcall(luau.load(code, {
	environment = { game = dm, workspace = ws, Vector3 = roblox.Vector3, CFrame = roblox.CFrame },
}))
check("re-run with a wall succeeded", ok2, tostring(result2))
if ok2 then
	eq("a tall wall is not mistaken for the ground", result2.ground.path, "game.Workspace.Ground")
end

print(string.format("  %d passed, %d failed", passed, failed))
if failed > 0 then
	process.exit(1)
end
