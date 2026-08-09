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

-- A UI shaped to separate a correct contrast calculation from a plausible one.
-- rbx-dom has no default for a property that was never assigned, so every
-- property design_lint reads is set explicitly here — including AbsolutePosition
-- and AbsoluteSize, which Roblox computes and Lune does not.
local cam = roblox.Instance.new("Camera")
cam.Name = "RuntimeTestCamera"
cam.ViewportSize = roblox.Vector2.new(1280, 720)
cam.Parent = ws
ws.CurrentCamera = cam

local sg = dm:GetService("StarterGui")
local screen = roblox.Instance.new("ScreenGui")
screen.Name = "Menu"
screen.Parent = sg

local function label(name, parent, color, size, pos)
	local t = roblox.Instance.new("TextLabel")
	t.Name = name
	t.Text = name
	t.TextColor3 = color
	t.TextTransparency = 0
	t.TextStrokeTransparency = 1
	t.TextSize = 16
	t.BackgroundTransparency = 1
	t.BackgroundColor3 = roblox.Color3.fromRGB(0, 0, 0)
	t.AbsolutePosition = pos
	t.AbsoluteSize = size
	t.Visible = true
	t.Parent = parent
	return t
end

local function panel(name, parent, color, transparency, pos)
	local f = roblox.Instance.new("Frame")
	f.Name = name
	f.BackgroundColor3 = color
	f.BackgroundTransparency = transparency
	f.AbsolutePosition = pos
	f.AbsoluteSize = roblox.Vector2.new(300, 200)
	f.Visible = true
	f.Parent = parent
	return f
end

-- Opaque dark panel: the palette's own text/bg pair, and a near-invisible one.
local dark = panel("Dark", screen, roblox.Color3.fromRGB(26, 27, 30), 0, roblox.Vector2.new(0, 0))
label("Readable", dark, roblox.Color3.fromRGB(233, 236, 239), roblox.Vector2.new(200, 20), roblox.Vector2.new(4, 4))
label("Faint", dark, roblox.Color3.fromRGB(60, 62, 66), roblox.Vector2.new(200, 20), roblox.Vector2.new(4, 28))

-- The case that separates real compositing from a shortcut. A half-transparent
-- white panel over black renders mid-grey, so white text on it is ~3.95:1.
-- Reading only the panel's own colour would say white-on-white (1:1); ignoring
-- the panel would say white-on-black (21:1). Only the composite gives 3.95.
local black = panel("Black", screen, roblox.Color3.fromRGB(0, 0, 0), 0, roblox.Vector2.new(0, 220))
local veil = panel("Veil", black, roblox.Color3.fromRGB(255, 255, 255), 0.5, roblox.Vector2.new(0, 220))
label("Composited", veil, roblox.Color3.fromRGB(255, 255, 255), roblox.Vector2.new(200, 20), roblox.Vector2.new(4, 224))

-- No opaque layer anywhere above: the 3D viewport shows through.
label("Floating", screen, roblox.Color3.fromRGB(255, 255, 255), roblox.Vector2.new(200, 20), roblox.Vector2.new(400, 4))

-- A gradient backdrop is a range of contrast, not a number.
local gradientPanel = panel("Gradient", screen, roblox.Color3.fromRGB(120, 120, 120), 0, roblox.Vector2.new(400, 40))
roblox.Instance.new("UIGradient").Parent = gradientPanel
label("OverGradient", gradientPanel, roblox.Color3.fromRGB(130, 130, 130), roblox.Vector2.new(200, 20), roblox.Vector2.new(404, 44))

-- Same terrible ratio, but stroked: WCAG has no model for an outline, so this
-- must not be reported as a warning.
local strokeHost = panel("StrokeHost", screen, roblox.Color3.fromRGB(26, 27, 30), 0, roblox.Vector2.new(400, 260))
local stroked = label("Stroked", strokeHost, roblox.Color3.fromRGB(60, 62, 66), roblox.Vector2.new(200, 20), roblox.Vector2.new(404, 264))
stroked.TextStrokeTransparency = 0

-- A stroke on text that already passes changes nothing: the outline sits at the
-- glyph edge and the glyph body is still on the same backdrop, so a passing
-- ratio cannot be pulled under the bar. Reporting these would make every
-- well-designed stroked label an "unknown".
local strokedOk = label("StrokedOk", strokeHost, roblox.Color3.fromRGB(233, 236, 239), roblox.Vector2.new(200, 20), roblox.Vector2.new(404, 288))
strokedOk.TextStrokeTransparency = 0.2

-- A CanvasGroup draws its subtree to a buffer and fades the buffer, so the text
-- and its backdrop fade together against whatever is outside the group. The
-- layer walk cannot express that: without this branch it would report the ratio
-- the group would have had at full opacity, which here is a comfortable pass.
local fadedGroup = roblox.Instance.new("CanvasGroup")
fadedGroup.Name = "Faded"
fadedGroup.GroupTransparency = 0.6
fadedGroup.BackgroundColor3 = roblox.Color3.fromRGB(26, 27, 30)
fadedGroup.BackgroundTransparency = 0
fadedGroup.AbsolutePosition = roblox.Vector2.new(700, 0)
fadedGroup.AbsoluteSize = roblox.Vector2.new(300, 200)
fadedGroup.Visible = true
fadedGroup.Parent = screen
label("InFadedGroup", fadedGroup, roblox.Color3.fromRGB(233, 236, 239), roblox.Vector2.new(200, 20), roblox.Vector2.new(704, 4))

local function env()
	return {
		game = dm,
		workspace = ws,
		Vector3 = roblox.Vector3,
		Vector2 = roblox.Vector2,
		Color3 = roblox.Color3,
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

-- === design_lint contrast ===================================================
local lint = run("design-lint")
if lint then
	local byPath = {}
	for _, f in ipairs(lint.findings or {}) do byPath[f.path] = f end
	local function finding(name)
		return byPath["StarterGui.Menu." .. name] or byPath["StarterGui.Menu.Dark." .. name]
			or byPath["StarterGui.Menu.Black.Veil." .. name] or byPath["StarterGui.Menu.Gradient." .. name]
			or byPath["StarterGui.Menu.StrokeHost." .. name] or byPath["StarterGui.Menu.Faded." .. name]
	end

	check("contrast: the palette's own text/bg pair raises nothing", finding("Readable") == nil,
		finding("Readable") and finding("Readable").detail or "")

	local faint = finding("Faint")
	if faint then
		eq("contrast: near-invisible text is a warning", faint.rule, "low_contrast")
		eq("contrast: severity", faint.severity, "warn")
		eq("contrast: the resolved backdrop is the opaque panel", faint.background, "#1A1B1E")
		near("contrast: ratio", faint.ratio, 1.61, 0.01)
	else
		check("contrast: near-invisible text is reported", false)
	end

	-- The one that proves alpha compositing rather than a shortcut: reading the
	-- veil's own colour would give white-on-white (1:1), ignoring the veil would
	-- give white-on-black (21:1). Only compositing gives mid-grey and ~3.98:1.
	--
	-- 3.98 and not 3.95: the ratio is computed from the exact composited 0.5,
	-- while the hex rounds it to 128/255 = 0.50196. Deriving the expectation
	-- from the printed hex instead of the real value is off by 0.03.
	local composited = finding("Composited")
	if composited then
		eq("contrast: half-transparent white over black resolves to mid-grey", composited.background, "#808080")
		near("contrast: composited ratio", composited.ratio, 3.98, 0.01)
	else
		check("contrast: text over a translucent layer is measured", false)
	end

	local floating = finding("Floating")
	if floating then
		eq("contrast: nothing opaque behind the text is unknown, not a guess", floating.rule, "contrast_unknown")
		check("contrast: says why", floating.detail:find("nothing opaque") ~= nil, floating.detail)
	else
		check("contrast: text over the viewport is reported as unknown", false)
	end

	local gradient = finding("OverGradient")
	if gradient then
		eq("contrast: a gradient backdrop is unknown", gradient.rule, "contrast_unknown")
		check("contrast: names the gradient", gradient.detail:find("UIGradient") ~= nil, gradient.detail)
	else
		check("contrast: text over a gradient is reported as unknown", false)
	end

	-- Same 1.61:1 as Faint, but stroked. WCAG models no outline, and an outline
	-- usually helps, so this must not carry the warning severity.
	local stroked = finding("Stroked")
	if stroked then
		eq("contrast: stroked text is not a warning", stroked.severity, "info")
		eq("contrast: stroked text is reported as unknown", stroked.rule, "contrast_unknown")
		check("contrast: says the stroke is why", stroked.detail:find("stroke") ~= nil, stroked.detail)
	else
		check("contrast: stroked low-contrast text is still reported", false)
	end

	-- A stroke on text that already clears the bar is not an unknown. Reporting
	-- it would turn every well-designed stroked label into a finding, which is
	-- how a lint stops being read.
	check("contrast: a stroke on passing text raises nothing", finding("StrokedOk") == nil,
		finding("StrokedOk") and finding("StrokedOk").detail or "")

	local faded = finding("InFadedGroup")
	if faded then
		eq("contrast: a translucent CanvasGroup is unknown, not the opaque ratio", faded.rule, "contrast_unknown")
		check("contrast: names the CanvasGroup", faded.detail:find("CanvasGroup") ~= nil, faded.detail)
	else
		check("contrast: text inside a faded CanvasGroup is reported as unknown", false)
	end
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
