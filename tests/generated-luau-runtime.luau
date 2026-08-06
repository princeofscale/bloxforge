-- Runs the Luau this server generates against a real DataModel, without Studio.
--
-- Generated Luau is where the read tools actually compute their answers, and
-- none of it is reachable from Jest — it could only ever be checked by hand
-- against a live Studio, which in practice means checked once and then never
-- again. Lune gives real CFrame, Vector3 and Instance semantics, so the
-- arithmetic and the traversals can be asserted here instead.
--
-- Not covered: Model:GetBoundingBox(), which Lune does not implement, so the
-- spatial landmark path is exercised for BaseParts only.
--
-- Run: node scripts/test-generated-luau-runtime.mjs

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

local dir = process.args[1]
if not dir then
	print("usage: lune tests/generated-luau-runtime.luau <dir-of-generated-luau>")
	process.exit(1)
end

-- A place shaped to catch the things that would silently be wrong: a baseplate
-- swallowing the occupancy grid, a rotated part measured by its Size, and a
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

local function env()
	return {
		game = dm,
		workspace = ws,
		Vector3 = roblox.Vector3,
		CFrame = roblox.CFrame,
		Enum = roblox.Enum,
	}
end

local function run(name)
	local code = fs.readFile(dir .. "/" .. name .. ".luau")
	local okLoad, fn = pcall(luau.load, code, { environment = env() })
	if not okLoad then
		check(name .. " loads", false, tostring(fn):sub(1, 200))
		return nil
	end
	local okRun, result = pcall(fn)
	if not okRun then
		check(name .. " runs", false, tostring(result):match("^[^\n]*") or "?")
		return nil
	end
	return result
end

print("generated Luau against a real DataModel (Lune):")

-- === get_spatial_layout =====================================================
local layout = run("spatial-layout")
if layout then
	eq("layout: found", layout.found, true)
	eq("layout: path", layout.path, "game.Workspace")
	eq("layout: every BasePart counted, SpawnLocation included", layout.partCount, 6)

	-- Bounds come from world-axis boxes, not from Size. The beam reaches
	-- x = -160 only if its local Z axis was projected onto world X.
	near("layout: bounds reach the far end of the rotated beam", layout.bounds.min[1], -200, 0.01)
	near("layout: bounds reach the far tower", layout.bounds.max[1], 210, 0.01)
	near("layout: bounds top is the tower top", layout.bounds.max[2], 60, 0.01)

	eq("layout: ground is the wide flat part", layout.ground.path, "game.Workspace.Ground")
	near("layout: ground.topY is the surface, not the centre", layout.ground.topY, 0.5, 0.01)

	eq("layout: one spawn found", #layout.spawns, 1)
	eq("layout: spawn path", layout.spawns[1].path, "game.Workspace.SpawnLocation")

	eq("layout: the baseplate is excluded from the grid", layout.grid.broadParts, 1)
	eq("layout: one row per cell", #layout.grid.rows, layout.grid.size)
	eq("layout: every row is as wide as the grid", #layout.grid.rows[1], layout.grid.size)

	-- Rows run north first. Deriving the index from the returned origin and cell
	-- size also proves those three agree with each other.
	local function rowFor(z)
		local raw = math.floor((z - layout.grid.origin[2]) / layout.grid.cell[2]) + 1
		raw = math.max(1, math.min(layout.grid.size, raw))
		return layout.grid.size - raw + 1
	end
	local function occupied(row)
		local n = 0
		for i = 1, #row do
			if row:sub(i, i) ~= "." then n += 1 end
		end
		return n
	end

	local beamRow = layout.grid.rows[rowFor(-120)]
	check("layout: the rotated beam spans several cells of X", occupied(beamRow) >= 3,
		string.format("row %q has %d occupied cells; a beam measured by Size would occupy 1",
			beamRow, occupied(beamRow)))

	local towerRow = layout.grid.rows[rowFor(120)]
	check("layout: the towers register in their own row", occupied(towerRow) >= 3,
		string.format("row %q has %d occupied cells", towerRow, occupied(towerRow)))

	local emptyRow = layout.grid.rows[rowFor(0)]
	check("layout: the middle reads as free once the baseplate is excluded", occupied(emptyRow) <= 1,
		string.format("row %q has %d occupied cells; only the spawn belongs there",
			emptyRow, occupied(emptyRow)))
end

-- === get_node_batch =========================================================
local batch = run("node-batch")
if batch then
	local rows = batch.nodes
	eq("batch: rows arrive under `nodes`", typeof(rows), "table")
	eq("batch: count agrees with the rows", batch.count, 2)
	eq("batch: one row per requested path", #rows, 2)
	eq("batch: name", rows[1].name, "Ground")
	eq("batch: className", rows[1].className, "Part")
	eq("batch: requested property came back", rows[1].props.Anchored, true)
	eq("batch: childCount", rows[1].childCount, 0)
	-- A missing path must come back as a row saying so, not drop out of the
	-- result and leave the caller matching answers to requests by position.
	eq("batch: a missing path reports itself rather than vanishing", rows[2].error, "not found")
	eq("batch: the missing row keeps its path", rows[2].path, "game.Workspace.Nope")
end

-- === scene_search ===========================================================
local search = run("scene-search")
if search then
	check("search: found something", search.total > 0, "total = " .. tostring(search.total))
	eq("search: the best hit is the part actually named Ground", search.results[1].name, "Ground")
	check("search: reports which terms matched", #search.results[1].matched > 0)
end

-- === get_changes_since (fingerprint) ========================================
local fp = run("world-fingerprint")
if fp then
	check("fingerprint: counted the subtree", (fp.count or 0) > 0, "count = " .. tostring(fp.count))
	local entries = 0
	for _ in pairs(fp.fingerprint or {}) do entries += 1 end
	check("fingerprint: produced entries to diff against", entries > 0)
end

-- === asset_fit_plan scan ====================================================
-- Generated for a path that does not exist: it must say so rather than throw,
-- because the tool turns `found = false` into an explanation for the caller.
local fit = run("fit-scan")
if fit then
	eq("fit: an unresolvable path fails closed", fit.found, false)
end

-- === ground detection, second pass ==========================================
-- A tall thin wall has a large footprint too and must not become the floor.
local wall = roblox.Instance.new("Part")
wall.Name = "Wall"
wall.Anchored = true
wall.Size = roblox.Vector3.new(390, 300, 2)
wall.CFrame = roblox.CFrame.new(0, 150, 190)
wall.Parent = ws

local layout2 = run("spatial-layout")
if layout2 then
	eq("layout: a tall wall is not mistaken for the ground", layout2.ground.path, "game.Workspace.Ground")
end

print(string.format("  %d passed, %d failed", passed, failed))
if failed > 0 then
	process.exit(1)
end
