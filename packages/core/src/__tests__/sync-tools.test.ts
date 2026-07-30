import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { SyncManager } from '../sync/sync-manager.js';
import { SyncTools } from '../tools/sync-tools.js';

const studioPage = (source: string) => ({
  items: [{
    path: 'game.ServerScriptService.Main',
    pathSegments: ['ServerScriptService', 'Main'],
    className: 'Script',
    source,
    sourceHash: 'plugin-hash',
    sourceLength: source.length,
  }],
  continuationToken: undefined,
});

function textPayload(result: { content: Array<{ type: string; text?: string }> }) {
  return JSON.parse(result.content[0].text!);
}

describe('SyncTools safety', () => {
  let root: string;
  let dir: string;
  let callSingle: jest.Mock;
  let tools: SyncTools;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'roblox-sync-tools-'));
    dir = path.join(root, 'roblox-src');
    process.env.BLOXFORGE_PROJECT_ROOT = root;
    callSingle = jest.fn(async () => studioPage('print("hello")'));
    tools = new SyncTools(new SyncManager(), { callSingle, recordOperation: jest.fn() });
  });

  afterEach(() => {
    delete process.env.BLOXFORGE_PROJECT_ROOT;
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('previews pull changes without writing until explicitly confirmed', async () => {
    const result = await tools.syncPull(dir, 'place-1', { dryRun: true });
    const payload = textPayload(result);

    expect(callSingle).toHaveBeenCalledWith(
      '/api/read-managed-scripts',
      expect.objectContaining({ limit: 100, maxSourceBytes: 1024 * 1024 }),
      'edit',
      'place-1',
    );
    expect(payload.added).toEqual(['ServerScriptService/Main.server.lua']);
    expect(fs.existsSync(path.join(dir, 'ServerScriptService/Main.server.lua'))).toBe(false);
  });

  it('atomically writes confirmed files and stores hashes instead of source snapshots', async () => {
    await tools.syncPull(dir, 'place-1', { confirm: true });

    expect(fs.readFileSync(path.join(dir, 'ServerScriptService/Main.server.lua'), 'utf8')).toBe('print("hello")');
    const stateText = fs.readFileSync(path.join(dir, '.bloxforge/rojo-state.json'), 'utf8');
    const state = JSON.parse(stateText);
    expect(state.schemaVersion).toBe(2);
    expect(state.entries['ServerScriptService/Main.server.lua'].contentHash).toMatch(/^sha256:/);
    expect(stateText).not.toContain('print(\\"hello\\")');
  });

  it('does not overwrite a locally changed file when Studio also changed', async () => {
    await tools.syncPull(dir, 'place-1', { confirm: true });
    fs.writeFileSync(path.join(dir, 'ServerScriptService/Main.server.lua'), 'print("local")');
    callSingle.mockResolvedValue(studioPage('print("studio")'));

    const result = await tools.syncPull(dir, 'place-1', { confirm: true });
    const payload = textPayload(result);

    expect(payload.conflicts).toEqual(['ServerScriptService/Main.server.lua']);
    expect(fs.readFileSync(path.join(dir, 'ServerScriptService/Main.server.lua'), 'utf8')).toBe('print("local")');
  });

  it('uses baseline Studio hashes to avoid retransmitting unchanged source', async () => {
    await tools.syncPull(dir, 'place-1', { confirm: true });
    fs.writeFileSync(path.join(dir, 'ServerScriptService/Main.server.lua'), 'print("local")');
    callSingle.mockImplementation(async (_endpoint, data) => ({
      items: [{
        ...studioPage('').items[0],
        source: undefined,
        sourceLength: 'print("hello")'.length,
        sourceHash: 'plugin-hash',
        unchanged: true,
        sourceOmitted: true,
      }],
      continuationToken: undefined,
      knownHashes: data.knownHashes,
    }));

    const payload = textPayload(await tools.syncStatus(dir, 'place-1'));
    expect(callSingle).toHaveBeenLastCalledWith(
      '/api/read-managed-scripts',
      expect.objectContaining({
        knownHashes: { 'game.ServerScriptService.Main': 'plugin-hash' },
      }),
      'edit',
      'place-1',
    );
    expect(payload.localOnlyChanges).toEqual(['ServerScriptService/Main.server.lua']);
    expect(payload.tooLarge).toEqual([]);
  });

  it('rejects sync directories outside the configured project root', async () => {
    await expect(tools.syncPull(path.join(root, '..', 'escape'), 'place-1', { dryRun: true }))
      .rejects.toThrow(/project root/);
  });

  it('rejects Studio names that collide on one portable local path', async () => {
    callSingle.mockResolvedValue({
      items: [
        {
          ...studioPage('print("upper")').items[0],
          path: 'game.ServerScriptService.Upper',
          pathSegments: ['ServerScriptService', 'Main'],
        },
        {
          ...studioPage('print("lower")').items[0],
          path: 'game.ServerScriptService.Lower',
          pathSegments: ['ServerScriptService', 'main'],
        },
      ],
      continuationToken: undefined,
    });

    const payload = textPayload(await tools.syncPull(dir, 'place-1', { confirm: true }));
    expect(payload.conflicts).toEqual(expect.arrayContaining([
      'ServerScriptService/Main.server.lua',
      'ServerScriptService/main.server.lua',
    ]));
    expect(fs.existsSync(path.join(dir, 'ServerScriptService/Main.server.lua'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'ServerScriptService/main.server.lua'))).toBe(false);
  });

  it('represents renames explicitly and applies them only after confirmation', async () => {
    await tools.syncPull(dir, 'place-1', { confirm: true });
    callSingle.mockResolvedValue({
      ...studioPage('print("hello")'),
      items: [{
        ...studioPage('print("hello")').items[0],
        path: 'game.ServerScriptService.Renamed',
        pathSegments: ['ServerScriptService', 'Renamed'],
      }],
    });

    const preview = textPayload(await tools.syncStatus(dir, 'place-1'));
    expect(preview.renamed).toEqual([{
      from: 'ServerScriptService/Main.server.lua',
      to: 'ServerScriptService/Renamed.server.lua',
    }]);
    await tools.syncPull(dir, 'place-1', { confirm: true });
    expect(fs.existsSync(path.join(dir, 'ServerScriptService/Main.server.lua'))).toBe(false);
    expect(fs.readFileSync(path.join(dir, 'ServerScriptService/Renamed.server.lua'), 'utf8')).toBe('print("hello")');
  });

  it('requires an explicit deleteMissing choice before deleting a managed local file', async () => {
    await tools.syncPull(dir, 'place-1', { confirm: true });
    callSingle.mockResolvedValue({ items: [], continuationToken: undefined });

    await tools.syncPull(dir, 'place-1', { confirm: true });
    const file = path.join(dir, 'ServerScriptService/Main.server.lua');
    expect(fs.existsSync(file)).toBe(true);
    const applied = textPayload(await tools.syncPull(dir, 'place-1', {
      confirm: true,
      deleteMissing: true,
    }));
    expect(applied.deleted).toEqual(['ServerScriptService/Main.server.lua']);
    expect(fs.existsSync(file)).toBe(false);
  });

  it('reports Studio names no portable file name can represent instead of encoding them', async () => {
    callSingle.mockResolvedValue({
      items: [{
        ...studioPage('print("bad")').items[0],
        path: 'game.ServerScriptService.Bad:Name',
        pathSegments: ['ServerScriptService', 'Bad:Name'],
      }],
      continuationToken: undefined,
    });

    const payload = textPayload(await tools.syncPull(dir, 'place-1', { confirm: true }));
    expect(payload.unsupported).toEqual([
      { path: 'game.ServerScriptService.Bad:Name', reason: expect.stringContaining('":"') },
    ]);
    expect(payload.added).toEqual([]);
    expect(fs.readdirSync(dir).filter((name) => name !== '.bloxforge')).toEqual([]);
  });

  it('refuses to guess a rename when two scripts share the same content', async () => {
    await tools.syncPull(dir, 'place-1', { confirm: true });
    const clone = (name: string) => ({
      ...studioPage('print("hello")').items[0],
      path: `game.ServerScriptService.${name}`,
      pathSegments: ['ServerScriptService', name],
    });
    callSingle.mockResolvedValue({ items: [clone('A'), clone('B')], continuationToken: undefined });

    const payload = textPayload(await tools.syncStatus(dir, 'place-1'));
    expect(payload.renamed).toEqual([]);
    expect(payload.ambiguous).toEqual([{
      from: 'ServerScriptService/Main.server.lua',
      candidates: expect.arrayContaining([
        'ServerScriptService/A.server.lua',
        'ServerScriptService/B.server.lua',
      ]),
    }]);
  });

  it('fails closed on a corrupt state file until the baseline is explicitly reset', async () => {
    await tools.syncPull(dir, 'place-1', { confirm: true });
    const statePath = path.join(dir, '.bloxforge/rojo-state.json');
    fs.writeFileSync(statePath, '{ this is not json');

    await expect(tools.syncStatus(dir, 'place-1')).rejects.toThrow(/unusable.*resetBaseline=true/s);

    const payload = textPayload(await tools.syncStatus(dir, 'place-1', { resetBaseline: true }));
    expect(payload.conflicts).toEqual([]);
    expect(fs.readdirSync(path.join(dir, '.bloxforge')).some((name) => name.includes('quarantine'))).toBe(true);
  });

  it('rejects a state file that belongs to a different directory', async () => {
    await tools.syncPull(dir, 'place-1', { confirm: true });
    const statePath = path.join(dir, '.bloxforge/rojo-state.json');
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    fs.writeFileSync(statePath, JSON.stringify({ ...state, projectIdentity: '/somewhere/else' }));

    await expect(tools.syncStatus(dir, 'place-1')).rejects.toThrow(/different directory/);
  });

  it('rolls the filesystem back when the state write fails after files are written', async () => {
    const stateDir = path.join(dir, '.bloxforge');
    fs.mkdirSync(dir, { recursive: true });
    // A directory where the state file belongs makes the final write fail.
    fs.mkdirSync(path.join(stateDir, 'rojo-state.json'), { recursive: true });

    await expect(tools.syncPull(dir, 'place-1', { confirm: true })).rejects.toThrow();
    expect(fs.existsSync(path.join(dir, 'ServerScriptService/Main.server.lua'))).toBe(false);
  });

  it('binds a bounded apply to the plan hash it was previewed from', async () => {
    const preview = textPayload(await tools.syncStatus(dir, 'place-1'));
    expect(preview.planHash).toMatch(/^sha256:/);

    await expect(tools.syncPull(dir, 'place-1', { confirm: true, requirePlanHash: true }))
      .rejects.toThrow(/expectedPlanHash is required/);

    callSingle.mockResolvedValue(studioPage('print("changed since preview")'));
    await expect(tools.syncPull(dir, 'place-1', {
      confirm: true,
      requirePlanHash: true,
      expectedPlanHash: preview.planHash,
    })).rejects.toThrow(/plan changed since preview/i);
    expect(fs.existsSync(path.join(dir, 'ServerScriptService/Main.server.lua'))).toBe(false);
  });
});
