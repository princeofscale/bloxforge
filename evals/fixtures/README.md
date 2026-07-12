# Canonical Benchmark Fixture

This directory will contain the canonical benchmark place for BloxForge eval runs.

> **Status:** Specification only. The `.rbxl` file must be created manually in
> Roblox Studio — it cannot be generated from code alone.

## Purpose

A small, deterministic Roblox place that exercises all major tool categories.
Eval cases in `evals/cases/` reference objects, scripts, and behaviors in this
place by name and path.

## Required Hierarchy

```
game
├── Workspace
│   ├── Map
│   │   ├── SpawnLocation
│   │   ├── Checkpoint1 (Part, Anchored, BrickColor=Lime green)
│   │   ├── Checkpoint2 (Part, Anchored, BrickColor=Lime green)
│   │   ├── Checkpoint3 (Part, Anchored, BrickColor=Lime green)
│   │   ├── FinishLine (Part, Anchored, BrickColor=Gold)
│   │   ├── DamagePart (Part, Anchored, BrickColor=Really red)
│   │   ├── DoorSystem
│   │   │   ├── Door (Part)
│   │   │   ├── Button (Part + ProximityPrompt)
│   │   │   └── DoorScript (Script)
│   │   ├── ToggleSwitch
│   │   │   ├── Switch (Part + ClickDetector)
│   │   │   ├── Light (Part + PointLight)
│   │   │   └── SwitchScript (Script)
│   │   └── ObscurelyNamed
│   │       ├── Xq7_relay (Part) — semantic discovery test
│   │       └── ctrl_node_alpha (Part) — semantic discovery test
│   ├── Baseplate
│   └── Camera
├── ServerScriptService
│   ├── GameManager (Script — round loop, leaderboard)
│   ├── DamageHandler (Script — touches DamagePart → reduce health)
│   └── BrokenScript (Script — intentional Luau error: undefined variable)
├── ReplicatedStorage
│   ├── SharedModule (ModuleScript — utility functions)
│   └── GameConfig (ModuleScript — constants)
├── StarterGui
│   ├── TimerGui (ScreenGui + TextLabel)
│   └── ShopGui (ScreenGui + Frame + TextButton "BuyButton")
├── StarterPlayer
│   └── StarterPlayerScripts
│       └── ClientUI (LocalScript)
├── Lighting
│   └── (default studio lighting)
└── SoundService
    └── BackgroundMusic (Sound)
```

## Scripts

### DoorScript (Workspace.Map.DoorSystem.DoorScript)
```lua
local door = script.Parent.Door
local button = script.Parent.Button
local prompt = button:FindFirstChildOfClass("ProximityPrompt")
local open = false

prompt.Triggered:Connect(function()
    open = not open
    door.Transparency = open and 1 or 0
    door.CanCollide = not open
end)
```

### BrokenScript (ServerScriptService.BrokenScript)
```lua
-- Intentional error for diagnostic testing
local result = undefinedVariable + 1
print(result)
```

### DamageHandler (ServerScriptService.DamageHandler)
```lua
local damagePart = workspace.Map.DamagePart

damagePart.Touched:Connect(function(hit)
    local humanoid = hit.Parent:FindFirstChildOfClass("Humanoid")
    if humanoid then
        humanoid:TakeDamage(10)
    end
end)
```

## Intentional Bugs

| Script | Bug | Purpose |
|---|---|---|
| `BrokenScript` | `undefinedVariable` reference | Test `diagnose_scripts` detection |
| `DamageHandler` | No cooldown, damages repeatedly | Test runtime analysis |

## Semantic Discovery Cases

| Query | Expected Match | Why |
|---|---|---|
| "the part players touch to win" | `FinishLine` | Name is descriptive but not obvious |
| "the relay node" | `Xq7_relay` | Non-obvious name, needs semantic search |
| "damage zone" | `DamagePart` | Reasonable name match |
| "door control" | `DoorSystem` | Structural match |

## Reset Procedure

1. Delete all objects added during a test run
2. Restore `BrokenScript` to its intentionally broken state
3. Verify `DoorSystem` is in closed state (door visible, collidable)
4. Verify no extra scripts were added

## Versioning

- Fixture version is tracked in a `StringValue` named `FixtureVersion` under `ReplicatedStorage`
- Bump version when hierarchy, scripts, or expected behaviors change
- Eval cases must declare the minimum fixture version they require

## Creating the Fixture

1. Open Roblox Studio → New Baseplate
2. Build the hierarchy above
3. Paste the scripts
4. Save as `evals/fixtures/benchmark.rbxl`
5. Add a `StringValue` named `FixtureVersion` to `ReplicatedStorage` with value `1`
6. Verify by running `diagnose_scripts` — should find exactly 1 error (BrokenScript)
