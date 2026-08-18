import * as fs from 'node:fs';

// Two filesystem failures that no portable directory permission can produce on
// both POSIX and Windows: a state write that fails *after* the files are
// written, and a rollback step that cannot undo one of them.
let mockUnlinkFailure: Error | undefined;
let mockRenameFailure: RegExp | undefined;
jest.mock('node:fs', () => {
  const actual = jest.requireActual('node:fs');
  return {
    ...actual,
    unlinkSync: (...args: unknown[]) => {
      if (mockUnlinkFailure) throw mockUnlinkFailure;
      return actual.unlinkSync(...args);
    },
    renameSync: (from: string, to: string) => {
      if (mockRenameFailure?.test(to)) throw new Error(`EPERM: operation not permitted, rename '${to}'`);
      return actual.renameSync(from, to);
    },
  };
});

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

  it('refuses to move a rename source the plan never read', async () => {
    // The write path re-read each file before writing; the rename path moved it
    // unconditionally. So a source whose on-disk content is not what the plan
    // recorded — an ignored file, or one edited after the preview — was moved
    // into a managed path and then recorded as the confirmed baseline.
    await tools.syncPull(dir, 'place-1', { confirm: true });
    const file = path.join(dir, 'ServerScriptService/Main.server.lua');
    callSingle.mockResolvedValue({
      items: [{
        ...studioPage('print("hello")').items[0],
        path: 'game.ServerScriptService.Renamed',
        pathSegments: ['ServerScriptService', 'Renamed'],
      }],
      continuationToken: undefined,
    });
    const ignoring = new SyncTools(
      new SyncManager({ ignore: ['**/Main.server.lua'] }),
      { callSingle, recordOperation: jest.fn() },
    );

    await expect(ignoring.syncPull(dir, 'place-1', { confirm: true }))
      .rejects.toThrow(/changed on disk after the plan was produced/);
    expect(fs.existsSync(path.join(dir, 'ServerScriptService/Renamed.server.lua'))).toBe(false);
    expect(fs.existsSync(file)).toBe(true);
  });

  it('does not push a file that changed while an earlier push was in flight', async () => {
    // sync_push sent plan.local, never re-reading, so an edit landing between
    // planning and the write overwrote Studio with unreviewed content and was
    // then recorded as the agreed baseline.
    const studioItem = (name: string) => ({
      ...studioPage('print("hello")').items[0],
      path: `game.ServerScriptService.${name}`,
      pathSegments: ['ServerScriptService', name],
    });
    callSingle.mockResolvedValue({
      items: [studioItem('Main'), studioItem('Other')],
      continuationToken: undefined,
    });
    await tools.syncPull(dir, 'place-1', { confirm: true });

    const second = path.join(dir, 'ServerScriptService/Other.server.lua');
    fs.writeFileSync(path.join(dir, 'ServerScriptService/Main.server.lua'), 'print("local main")');
    fs.writeFileSync(second, 'print("local other")');
    callSingle.mockImplementation(async (endpoint: string) => {
      if (endpoint !== '/api/read-managed-scripts') {
        // A concurrent editor lands while the first script is being pushed.
        fs.writeFileSync(second, 'print("edited mid-push")');
        return {};
      }
      return { items: [studioItem('Main'), studioItem('Other')], continuationToken: undefined };
    });

    const payload = textPayload(await tools.syncPush(dir, 'place-1', { confirm: true }));
    expect(payload.pushed).toEqual(['ServerScriptService/Main.server.lua']);
    expect(payload.failed).toEqual([{
      path: 'ServerScriptService/Other.server.lua',
      error: expect.stringContaining('changed on disk after the plan was produced'),
    }]);
    // Its baseline must still describe the pulled Studio content, not the edit
    // that was never sent.
    const state = JSON.parse(fs.readFileSync(path.join(dir, '.bloxforge/rojo-state.json'), 'utf8'));
    expect(state.entries['ServerScriptService/Other.server.lua'].studioHash).toBe('plugin-hash');
    expect(fs.readFileSync(second, 'utf8')).toBe('print("edited mid-push")');
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

  it('rolls the filesystem back when the state write fails after files are written', () => {
    // The state file is written last, and it is part of the same transaction:
    // files it does not describe must not stay on disk. Failing it by putting a
    // directory in its place does not test that — the *read* fails first and
    // the apply never starts — so the write itself is what fails here.
    mockRenameFailure = /rojo-state\.json$/;
    return tools.syncPull(dir, 'place-1', { confirm: true })
      .then(() => { throw new Error('expected the state write to fail'); })
      .catch((error: Error) => {
        expect(error.message).toMatch(/rojo-state\.json/);
        expect(fs.existsSync(path.join(dir, 'ServerScriptService/Main.server.lua'))).toBe(false);
      })
      .finally(() => { mockRenameFailure = undefined; });
  });

  // Restoring a file was the one rollback step not wrapped in a try. One
  // unwritable file threw out of the handler, which discarded the error that
  // caused the rollback and skipped the rename undo — so the caller was told
  // why the write failed and nothing about the tree being left changed.
  it('says which files a failed rollback left changed, and where the copies are', async () => {
    mockRenameFailure = /rojo-state\.json$/;
    mockUnlinkFailure = new Error('EPERM: operation not permitted');
    try {
      const failure = await tools.syncPull(dir, 'place-1', { confirm: true }).catch((e: Error) => e.message);
      expect(failure).toMatch(/rollback did not finish/);
      // The original cause survives, the file is named, and the copies are found.
      expect(failure).toMatch(/rojo-state\.json/);
      expect(failure).toMatch(/could not remove .*Main\.server\.lua/);
      expect(failure).toMatch(/backups/);
      // The write did happen, which is the whole point of saying so.
      expect(fs.existsSync(path.join(dir, 'ServerScriptService/Main.server.lua'))).toBe(true);
    } finally {
      mockRenameFailure = undefined;
      mockUnlinkFailure = undefined;
    }
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
