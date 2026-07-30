import * as fs from 'node:fs';
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
