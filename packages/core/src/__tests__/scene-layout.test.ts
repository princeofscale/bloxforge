import { WorldModelTools } from '../tools/world-model-tools.js';
import { buildSpatialLayoutLuau, SCAN_LIMIT } from '../builders/scene-layout.js';

// The grid arithmetic itself runs in Luau and is verified against a live Studio.
// What is testable here is the contract around it: the clamps, the failure
// modes, and whether the notes actually explain the numbers.

const layout = (over: Record<string, unknown> = {}) => ({
  found: true,
  path: 'game.Workspace',
  partCount: 40,
  truncated: false,
  bounds: { min: [-256, 0, -256], max: [256, 40, 256], size: [512, 40, 512] },
  grid: {
    size: 4,
    cell: [128, 128],
    origin: [-256, -256],
    broadParts: 1,
    rows: ['....', '.11.', '.2#.', '....'],
  },
  ground: { path: 'game.Workspace.Baseplate', topY: 0.5, span: [512, 512], material: 'Plastic' },
  landmarks: [{ name: 'Tower', className: 'Model', position: [0, 20, 0], size: [10, 40, 10] }],
  spawns: [{ path: 'game.Workspace.SpawnLocation', position: [0, 1, 0] }],
  ...over,
});

function runtimeReturning(value: unknown) {
  const codes: string[] = [];
  return {
    codes,
    runtime: {
      callSingle: async (_endpoint: string, data: unknown) => {
        codes.push((data as { code: string }).code);
        return { returnValue: JSON.stringify(value) };
      },
    },
  };
}

const parse = (r: { content: Array<{ type: string }> }) =>
  JSON.parse((r.content[0] as { text?: string })?.text ?? '{}');

describe('get_spatial_layout', () => {
  it('defaults to Workspace, since that is the only place geometry lives', async () => {
    const { runtime, codes } = runtimeReturning(layout());
    await new WorldModelTools(runtime).getSpatialLayout();
    expect(codes[0]).toContain('"game.Workspace"');
  });

  it('clamps the grid so a caller cannot ask for a 10,000-cell wall of text', async () => {
    const { runtime, codes } = runtimeReturning(layout());
    await new WorldModelTools(runtime).getSpatialLayout('game.Workspace', 500, 500);
    expect(codes[0]).toContain('local GRID = 48');
    expect(codes[0]).toContain('local TOP = 40');
  });

  it('clamps upward too, so a zero grid does not divide by nothing', async () => {
    const { runtime, codes } = runtimeReturning(layout());
    await new WorldModelTools(runtime).getSpatialLayout('game.Workspace', 0, 0);
    expect(codes[0]).toContain('local GRID = 4');
    expect(codes[0]).toContain('local TOP = 1');
  });

  it('explains what the grid characters mean, which is the whole point of returning one', async () => {
    const { runtime } = runtimeReturning(layout());
    const body = parse(await new WorldModelTools(runtime).getSpatialLayout());
    const notes = body.notes.join(' ');
    expect(notes).toMatch(/"\." is empty/);
    expect(notes).toMatch(/12 of 16 cells are empty/);
  });

  it('says where to stand things when a ground plane was found', async () => {
    const { runtime } = runtimeReturning(layout());
    const body = parse(await new WorldModelTools(runtime).getSpatialLayout());
    expect(body.notes.join(' ')).toMatch(/stand things at y=0\.5/);
  });

  it('warns that an empty cell is not empty ground when a baseplate was excluded', async () => {
    const { runtime } = runtimeReturning(layout());
    const body = parse(await new WorldModelTools(runtime).getSpatialLayout());
    expect(body.notes.join(' ')).toMatch(/empty of obstacles, not of ground/);
  });

  it('does not claim a ground plane when nothing flat was wide enough', async () => {
    const { runtime } = runtimeReturning(layout({ ground: undefined }));
    const body = parse(await new WorldModelTools(runtime).getSpatialLayout());
    expect(body.notes.join(' ')).toMatch(/No flat part wide enough/);
  });

  it('calls out a missing SpawnLocation, which decides where players land', async () => {
    const { runtime } = runtimeReturning(layout({ spawns: [] }));
    const body = parse(await new WorldModelTools(runtime).getSpatialLayout());
    expect(body.notes.join(' ')).toMatch(/No SpawnLocation/);
  });

  it('says the picture is partial rather than letting a truncated walk read as complete', async () => {
    const { runtime } = runtimeReturning(layout({ truncated: true }));
    const body = parse(await new WorldModelTools(runtime).getSpatialLayout());
    expect(body.notes.join(' ')).toContain(String(SCAN_LIMIT));
  });

  it('reports an empty space as free rather than as a broken read', async () => {
    const { runtime } = runtimeReturning({ found: true, path: 'game.Workspace', partCount: 0, spawns: [] });
    const body = parse(await new WorldModelTools(runtime).getSpatialLayout());
    expect(body.notes).toEqual(['No parts under this path — the space is empty, so any placement is free.']);
  });

  it('refuses a path that does not resolve', async () => {
    const { runtime } = runtimeReturning({ found: false });
    await expect(new WorldModelTools(runtime).getSpatialLayout('game.Workspace.Nope')).rejects.toThrow(/not found/);
  });

  it('fails loudly when the runtime returns something that is not a layout', async () => {
    const runtime = { callSingle: async () => ({ returnValue: 42 }) };
    await expect(new WorldModelTools(runtime).getSpatialLayout()).rejects.toThrow(/could not read/);
  });
});

describe('generated Luau', () => {
  it('escapes the path it was given', () => {
    expect(buildSpatialLayoutLuau('game."; evil()--', 8, 4)).toContain('\\"');
  });

  it('expands rotated parts onto world axes rather than trusting Size', () => {
    // A 1x1x10 beam laid on its side occupies ten studs of X, not one.
    expect(buildSpatialLayoutLuau('game.Workspace', 8, 4)).toContain('math.abs(l.X) * s.Z / 2');
  });

  // The cap used to stop the collection, not just the report: in a place with
  // more than twelve spawns, whether the floor got its strongest evidence
  // depended on which twelve the traversal reached first. Asserted end-to-end
  // in tests/generated-luau-runtime.luau against a place shaped to expose it.
  it('caps the spawn list where it is reported, not where it is collected', () => {
    const code = buildSpatialLayoutLuau('game.Workspace', 8, 4);
    expect(code).toContain('if d:IsA("SpawnLocation") then');
    expect(code).not.toContain('#spawns < 12');
    expect(code).toContain('local spawnCount = #spawns');
    expect(code).toContain('spawnsTruncated = spawnCount > #reportedSpawns');
  });

  it('excludes Terrain, which is a BasePart with no meaningful CFrame of its own', () => {
    expect(buildSpatialLayoutLuau('game.Workspace', 8, 4)).toContain('not d:IsA("Terrain")');
  });
});
