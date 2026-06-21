import { listRecipes, hasRecipe, buildRecipeLuau } from '../builders/recipes.js';

describe('recipe registry', () => {
  it('lists recipes with id, description, and params', () => {
    const recipes = listRecipes();
    expect(recipes.map((r) => r.id).sort()).toEqual(['ambient_sound', 'kill_brick', 'proximity_door']);
    for (const r of recipes) {
      expect(r.description.length).toBeGreaterThan(0);
      expect(Array.isArray(r.params)).toBe(true);
    }
  });

  it('knows which recipes exist', () => {
    expect(hasRecipe('proximity_door')).toBe(true);
    expect(hasRecipe('nope')).toBe(false);
  });

  it('throws a helpful error for an unknown recipe', () => {
    expect(() => buildRecipeLuau('nope')).toThrow(/Unknown recipe.*Available/);
  });
});

describe('buildRecipeLuau', () => {
  it('proximity_door is idempotent and wires a ProximityPrompt + toggle script', () => {
    const code = buildRecipeLuau('proximity_door', { parentPath: 'game.Workspace', name: 'Gate', x: 1, y: 5, z: 2 });
    expect(code).toContain('resolvePath("game.Workspace")');
    expect(code).toContain('if existing then existing:Destroy() end'); // idempotent
    expect(code).toContain('Instance.new("ProximityPrompt")');
    expect(code).toContain('door.Name = "Gate"');
    expect(code).toContain('Vector3.new(1, 5, 2)');
  });

  it('ambient_sound loops in a shared SoundGroup and plays', () => {
    const code = buildRecipeLuau('ambient_sound', { soundId: 'rbxassetid://123', volume: 0.5 });
    expect(code).toContain('SoundGroup');
    expect(code).toContain('sound.Looped = true');
    expect(code).toContain('sound.SoundId = "rbxassetid://123"');
    expect(code).toContain('sound.Volume = 0.5');
  });

  it('kill_brick damages via Humanoid:TakeDamage on touch', () => {
    const code = buildRecipeLuau('kill_brick', { damage: 50 });
    expect(code).toContain('Touched:Connect');
    expect(code).toContain('FindFirstChildOfClass("Humanoid")');
    expect(code).toContain('local DAMAGE = 50');
  });

  it('escapes string params safely', () => {
    const code = buildRecipeLuau('proximity_door', { name: 'a"]; os.exit() --' });
    expect(code).not.toContain('door.Name = a"]; os.exit()');
    expect(code).toContain('\\"');
  });
});
