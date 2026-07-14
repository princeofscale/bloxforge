// Recipes / macros (research review #5): typed, proven, idempotent Luau sequences
// the agent picks by id + params instead of re-synthesizing gameplay code each time
// — higher success rate and fewer tokens. Each recipe runs via execute-luau (no
// plugin change). Idempotent: named instances are recreated, not duplicated.

import { luaString, luaNumber, PATH_RESOLVER_LUA } from './luau-emit.js';

export interface RecipeParam {
  name: string;
  type: 'string' | 'number' | 'boolean';
  required?: boolean;
  description: string;
}

export interface RecipeInfo {
  id: string;
  description: string;
  params: RecipeParam[];
}

type RecipeFn = (params: Record<string, unknown>) => string;

function str(params: Record<string, unknown>, key: string, fallback = ''): string {
  const v = params[key];
  return typeof v === 'string' && v.length > 0 ? v : fallback;
}
function num(params: Record<string, unknown>, key: string, fallback: number): number {
  const v = Number(params[key]);
  return Number.isFinite(v) ? v : fallback;
}

// --- proximity_door: a door Part + ProximityPrompt + open/close Script ---
const proximityDoor: RecipeFn = (p) => {
  const parent = str(p, 'parentPath', 'game.Workspace');
  const name = str(p, 'name', 'Door');
  const x = num(p, 'x', 0), y = num(p, 'y', 5), z = num(p, 'z', 0);
  return `${PATH_RESOLVER_LUA}
local parent = resolvePath(${luaString(parent)})
if not parent then return { error = "Parent not found: " .. ${luaString(parent)} } end
local existing = parent:FindFirstChild(${luaString(name)})
if existing then existing:Destroy() end
if _G.__mcp and _G.__mcp.checkCancelled and _G.__mcp.checkCancelled() then return { cancelled = true } end
local door = Instance.new("Part")
door.Name = ${luaString(name)}
door.Size = Vector3.new(8, 10, 1)
door.Anchored = true
door.Position = Vector3.new(${luaNumber(x)}, ${luaNumber(y)}, ${luaNumber(z)})
door.Parent = parent
local prompt = Instance.new("ProximityPrompt")
prompt.ActionText = "Open / Close"
prompt.ObjectText = ${luaString(name)}
prompt.HoldDuration = 0
prompt.Parent = door
local script = Instance.new("Script")
script.Name = "DoorToggle"
script.Source = [===[
local door = script.Parent
local prompt = door:FindFirstChildOfClass("ProximityPrompt")
local open = false
prompt.Triggered:Connect(function()
	open = not open
	door.CanCollide = not open
	door.Transparency = open and 0.6 or 0
end)
]===]
script.Parent = door
return { recipe = "proximity_door", created = door:GetFullName() }`;
};

// --- ambient_sound: a looping Sound in a SoundGroup, auto-playing ---
const ambientSound: RecipeFn = (p) => {
  const soundId = str(p, 'soundId', 'rbxassetid://9046863145');
  const volume = num(p, 'volume', 0.3);
  const name = str(p, 'name', 'AmbientMusic');
  return `local SoundService = game:GetService("SoundService")
local groupName = "MCPMusicGroup"
local group = SoundService:FindFirstChild(groupName)
if not group then group = Instance.new("SoundGroup") group.Name = groupName group.Parent = SoundService end
local existing = SoundService:FindFirstChild(${luaString(name)})
if existing then existing:Destroy() end
if _G.__mcp and _G.__mcp.checkCancelled and _G.__mcp.checkCancelled() then return { cancelled = true } end
local sound = Instance.new("Sound")
sound.Name = ${luaString(name)}
sound.SoundId = ${luaString(soundId)}
sound.Looped = true
sound.Volume = ${luaNumber(volume)}
sound.SoundGroup = group
sound.Parent = SoundService
pcall(function() sound:Play() end)
return { recipe = "ambient_sound", created = sound:GetFullName(), playing = sound.IsPlaying }`;
};

// --- kill_brick: a Part that damages/destroys characters on touch ---
const killBrick: RecipeFn = (p) => {
  const parent = str(p, 'parentPath', 'game.Workspace');
  const name = str(p, 'name', 'KillBrick');
  const damage = num(p, 'damage', 100);
  const x = num(p, 'x', 0), y = num(p, 'y', 1), z = num(p, 'z', 0);
  return `${PATH_RESOLVER_LUA}
local parent = resolvePath(${luaString(parent)})
if not parent then return { error = "Parent not found: " .. ${luaString(parent)} } end
local existing = parent:FindFirstChild(${luaString(name)})
if existing then existing:Destroy() end
if _G.__mcp and _G.__mcp.checkCancelled and _G.__mcp.checkCancelled() then return { cancelled = true } end
local brick = Instance.new("Part")
brick.Name = ${luaString(name)}
brick.Size = Vector3.new(8, 1, 8)
brick.Anchored = true
brick.BrickColor = BrickColor.new("Really red")
brick.Material = Enum.Material.Neon
brick.Position = Vector3.new(${luaNumber(x)}, ${luaNumber(y)}, ${luaNumber(z)})
brick.Parent = parent
local script = Instance.new("Script")
script.Name = "KillOnTouch"
script.Source = [===[
local DAMAGE = ${luaNumber(damage)}
script.Parent.Touched:Connect(function(hit)
	local hum = hit.Parent and hit.Parent:FindFirstChildOfClass("Humanoid")
	if hum then hum:TakeDamage(DAMAGE) end
end)
]===]
script.Parent = brick
return { recipe = "kill_brick", created = brick:GetFullName() }`;
};

const REGISTRY: Record<string, { info: RecipeInfo; build: RecipeFn }> = {
  proximity_door: {
    info: {
      id: 'proximity_door',
      description: 'A door part with a ProximityPrompt that toggles open/closed (collision + transparency).',
      params: [
        { name: 'parentPath', type: 'string', description: 'Where to put it (default game.Workspace).' },
        { name: 'name', type: 'string', description: 'Door name (default "Door").' },
        { name: 'x', type: 'number', description: 'Position X (default 0).' },
        { name: 'y', type: 'number', description: 'Position Y (default 5).' },
        { name: 'z', type: 'number', description: 'Position Z (default 0).' },
      ],
    },
    build: proximityDoor,
  },
  ambient_sound: {
    info: {
      id: 'ambient_sound',
      description: 'A looping background Sound in a shared SoundGroup, auto-playing.',
      params: [
        { name: 'soundId', type: 'string', description: 'rbxassetid:// of the audio.' },
        { name: 'volume', type: 'number', description: '0–1 (default 0.3).' },
        { name: 'name', type: 'string', description: 'Sound name (default "AmbientMusic").' },
      ],
    },
    build: ambientSound,
  },
  kill_brick: {
    info: {
      id: 'kill_brick',
      description: 'A neon-red part that damages characters that touch it.',
      params: [
        { name: 'parentPath', type: 'string', description: 'Where to put it (default game.Workspace).' },
        { name: 'name', type: 'string', description: 'Name (default "KillBrick").' },
        { name: 'damage', type: 'number', description: 'Damage per touch (default 100).' },
        { name: 'x', type: 'number', description: 'Position X (default 0).' },
        { name: 'y', type: 'number', description: 'Position Y (default 1).' },
        { name: 'z', type: 'number', description: 'Position Z (default 0).' },
      ],
    },
    build: killBrick,
  },
};

export function listRecipes(): RecipeInfo[] {
  return Object.values(REGISTRY).map((r) => r.info);
}

export function hasRecipe(id: string): boolean {
  return id in REGISTRY;
}

/** Build the Luau for a recipe, or throw if the id is unknown. */
export function buildRecipeLuau(id: string, params: Record<string, unknown> = {}): string {
  const entry = REGISTRY[id];
  if (!entry) {
    throw new Error(`Unknown recipe "${id}". Available: ${Object.keys(REGISTRY).join(', ')}`);
  }
  return entry.build(params);
}
