import * as fs from 'node:fs';
import * as http from 'node:http';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { RojoCommandRunner } from '../rojo/command-runner.js';
import { RojoProcessManager } from '../rojo/process-manager.js';
import { RojoTools } from '../rojo/rojo-tools.js';

const fixture = path.resolve(process.cwd(), 'src/__tests__/fixtures/fake-rojo.mjs');
const fakeCommand = { executable: process.execPath, prefixArgs: [fixture], source: 'test' as const };

describe('Rojo command and process management', () => {
  let root: string;
  let projectFile: string;
  let manager: RojoProcessManager;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'bloxforge-rojo-process-'));
    projectFile = path.join(root, 'game.project.json');
    fs.writeFileSync(projectFile, '{"name":"Game","tree":{}}');
    process.env.BLOXFORGE_PROJECT_ROOT = root;
    manager = new RojoProcessManager(new RojoCommandRunner(fakeCommand));
  });

  afterEach(async () => {
    await manager.stopAll();
    delete process.env.BLOXFORGE_PROJECT_ROOT;
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('detects version and optional stable syncback support', async () => {
    await expect(manager.getVersion()).resolves.toMatchObject({
      version: '7.7.0',
      features: expect.arrayContaining(['syncback']),
    });
  });

  test('feature-detects syncback instead of requiring a prerelease', async () => {
    const runner = new RojoCommandRunner(fakeCommand, { FAKE_ROJO_VERSION: 'Rojo 7.6.1' });
    await expect(runner.version()).resolves.toMatchObject({
      version: '7.6.1',
      features: [],
    });
  });

  test('uses native syncback only through a dry-run plan and confirmation gate', async () => {
    const input = path.join(root, 'place.rbxl');
    fs.writeFileSync(input, 'fixture');
    const rojo = new RojoTools(new RojoCommandRunner(fakeCommand), manager);
    const plan = await rojo.nativeSyncbackPlan(root, 'game.project.json', 'place.rbxl');
    expect(plan).toMatchObject({ dryRun: true, ok: true, planHash: expect.stringMatching(/^sha256:/) });
    await expect(rojo.nativeSyncbackApply(root, 'game.project.json', 'place.rbxl', false))
      .rejects.toThrow(/Confirmation required/);
    fs.writeFileSync(input, 'changed after preview');
    await expect(rojo.nativeSyncbackApply(
      root,
      'game.project.json',
      'place.rbxl',
      true,
      plan.planHash,
    )).rejects.toThrow(/changed since preview/);
  });

  test('excludes only what the project declares ignored from the recovery snapshot', async () => {
    // Rojo evaluates globIgnorePaths and syncbackRules.ignorePaths per path,
    // relative to the project directory, and refuses to write to a match — so
    // those files cannot need restoring. Everything else stays in the snapshot.
    fs.writeFileSync(projectFile, JSON.stringify({
      name: 'Game',
      globIgnorePaths: ['Packages/**'],
      syncbackRules: { ignorePaths: ['generated/*.luau'] },
      tree: {},
    }));
    const input = path.join(root, 'place.rbxl');
    fs.writeFileSync(input, 'fixture');
    for (const [file, content] of [
      ['src/Kept.luau', 'kept'],
      ['Packages/Vendored.luau', 'vendored'],
      ['generated/Machine.luau', 'generated'],
      ['generated/nested/Deep.luau', 'not matched by generated/*.luau'],
    ] as const) {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.writeFileSync(path.join(root, file), content);
    }
    const rojo = new RojoTools(new RojoCommandRunner(fakeCommand), manager);
    const before = await rojo.nativeSyncbackPlan(root, 'game.project.json', 'place.rbxl');

    // An edit to an ignored file cannot change the plan; an edit to a covered
    // one must.
    fs.writeFileSync(path.join(root, 'Packages/Vendored.luau'), 'vendored changed');
    expect((await rojo.nativeSyncbackPlan(root, 'game.project.json', 'place.rbxl')).planHash)
      .toBe(before.planHash);

    // `generated/*.luau` does not cross a directory separator, so the nested
    // file is still covered — matching Rojo's own glob semantics.
    fs.writeFileSync(path.join(root, 'generated/nested/Deep.luau'), 'deep changed');
    expect((await rojo.nativeSyncbackPlan(root, 'game.project.json', 'place.rbxl')).planHash)
      .not.toBe(before.planHash);
  });

  test('restores every source when native syncback fails partway through', async () => {
    const input = path.join(root, 'place.rbxl');
    const source = path.join(root, 'src', 'existing.lua');
    fs.mkdirSync(path.dirname(source), { recursive: true });
    fs.writeFileSync(input, 'fixture');
    fs.writeFileSync(source, 'original');
    const runner = new RojoCommandRunner(fakeCommand, { FAKE_ROJO_SYNCBACK_FAIL: '1' });
    const rojo = new RojoTools(runner, manager);
    const plan = await rojo.nativeSyncbackPlan(root, 'game.project.json', 'place.rbxl');

    await expect(rojo.nativeSyncbackApply(
      root,
      'game.project.json',
      'place.rbxl',
      true,
      plan.planHash,
    )).rejects.toThrow(/restored/);
    expect(fs.readFileSync(source, 'utf8')).toBe('original');
    expect(fs.existsSync(path.join(root, 'src', 'created.lua'))).toBe(false);
    expect(fs.readdirSync(path.join(root, '.bloxforge', 'backups'))).toHaveLength(1);
  });

  test('starts once, captures bounded readiness logs, and stops gracefully', async () => {
    const [first, second] = await Promise.all([
      manager.start(projectFile, { port: 34872 }),
      manager.start(projectFile, { port: 34872 }),
    ]);

    expect(first.status).toBe('running');
    expect(second.pid).toBe(first.pid);
    expect(manager.logs(projectFile).lines.join('\n')).toContain('listening');
    await expect(manager.stop(projectFile)).resolves.toMatchObject({ status: 'stopped' });
  });

  test('enforces configured servePlaceIds when a place is selected', async () => {
    fs.writeFileSync(projectFile, '{"name":"Game","servePlaceIds":[123],"tree":{}}');
    const rojo = new RojoTools(new RojoCommandRunner(fakeCommand), manager);
    await expect(rojo.serveStart(root, 'game.project.json', undefined, 34875, 456))
      .rejects.toThrow(/not allowed by servePlaceIds/);
    await expect(rojo.serveStart(root, 'game.project.json', undefined, 34875, 123))
      .resolves.toMatchObject({ status: 'running' });
  });

  test('reports crashes and startup timeouts', async () => {
    await expect(manager.start(projectFile, {
      port: 34873,
      env: { FAKE_ROJO_CRASH: '1' },
      readinessTimeoutMs: 1000,
    })).rejects.toThrow(/exited before becoming ready/);
    await expect(manager.start(projectFile, {
      port: 34874,
      env: { FAKE_ROJO_SILENT: '1' },
      readinessTimeoutMs: 50,
    })).rejects.toThrow(/did not become ready/);
    expect(manager.status(projectFile)).toBeUndefined();
  });

  test('a handshake the child does not outlive is a foreign listener, not readiness', async () => {
    // `child.exitCode === null` proved nothing: a Rojo that binds between the
    // free-port check and the child's own bind answers /api/rojo while our child
    // is still on its way to an EADDRINUSE exit, and that response was accepted.
    await expect(manager.start(projectFile, {
      port: 34876,
      env: { FAKE_ROJO_EXIT_AFTER_MS: '150' },
      readinessTimeoutMs: 2000,
    })).rejects.toThrow(/Another Rojo already answers/);
    expect(manager.status(projectFile)).toBeUndefined();
  });

  test('a foreign Rojo is not adopted when the child fails to spawn', async () => {
    // The exact race, staged deterministically: the foreign server binds inside
    // the awaited version() call, which is precisely the gap between
    // assertPortAvailable and spawn, and the child then fails to start.
    //
    // This covers the race end to end. It does *not* isolate the `error`-only
    // branch of `outlives`: on this Node a failed spawn emits `exit` as well, so
    // every variant of the ownership check catches this particular case. The
    // settle window itself is covered by the FAKE_ROJO_EXIT_AFTER_MS test above,
    // which does fail without it.
    const foreign = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
        sessionId: 'not-ours', serverVersion: '7.7.0', protocolVersion: 4, projectName: 'SomebodyElse',
      }));
    });
    const missing = new RojoCommandRunner({
      executable: path.join(root, 'no-such-rojo'),
      prefixArgs: [],
      source: 'test',
    });
    jest.spyOn(missing, 'version').mockImplementation(async () => {
      await new Promise<void>((resolve) => foreign.listen(34877, '127.0.0.1', resolve));
      return { available: true, ok: true, version: '7.7.0' } as never;
    });

    const broken = new RojoProcessManager(missing);
    try {
      await expect(broken.start(projectFile, { port: 34877, readinessTimeoutMs: 1500 }))
        .rejects.toThrow(/Another Rojo already answers/);
      expect(broken.status(projectFile)).toBeUndefined();
    } finally {
      await new Promise<void>((resolve) => foreign.close(() => resolve()));
    }
  });

  test('rejects occupied ports before spawning', async () => {
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as net.AddressInfo;
    try {
      await expect(manager.start(projectFile, { port: address.port })).rejects.toThrow(/already in use/);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test('regenerates a sourcemap over its own previous output but refuses metadata', async () => {
    const rojo = new RojoTools(new RojoCommandRunner(fakeCommand), manager);
    await expect(rojo.generateSourcemap(root, 'game.project.json')).resolves.toMatchObject({ ok: true });
    fs.writeFileSync(path.join(root, 'sourcemap.json'), '{}');
    // sourcemap.json classifies as a `.json` value source; blocking it would
    // make every regeneration after the first fail.
    await expect(rojo.generateSourcemap(root, 'game.project.json')).resolves.toMatchObject({ ok: true });

    fs.writeFileSync(path.join(root, 'Thing.meta.json'), '{}');
    await expect(rojo.generateSourcemap(root, 'game.project.json', 'Thing.meta.json'))
      .rejects.toThrow(/must not overwrite the Rojo source/);
    await expect(rojo.buildProject(root, 'game.project.json', 'out.lua'))
      .rejects.toThrow(/must use one of/);
  });

  test('rejects non-loopback serve addresses', async () => {
    await expect(manager.start(projectFile, { host: '0.0.0.0', port: 34876 }))
      .rejects.toThrow(/loopback/);
  });

  test('returns a structured missing-binary result', async () => {
    const runner = new RojoCommandRunner({
      executable: path.join(root, 'missing-rojo'),
      prefixArgs: [],
      source: 'test',
    });
    await expect(runner.version()).resolves.toMatchObject({
      available: false,
      error: expect.stringContaining('not installed'),
    });
  });
});
