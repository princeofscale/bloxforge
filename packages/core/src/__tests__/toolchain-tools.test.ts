import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { RojoCommandRunner, clearRojoCommandCache } from '../rojo/command-runner.js';
import { RokitTools } from '../toolchain/rokit-tools.js';
import { WallyTools } from '../toolchain/wally-tools.js';

describe('Rokit toolchain resolution', () => {
  let root: string;
  let rokitRoot: string;
  const saved = { ...process.env };

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'bloxforge-rokit-'));
    rokitRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bloxforge-rokit-home-'));
    process.env.BLOXFORGE_PROJECT_ROOT = root;
    process.env.ROKIT_ROOT = rokitRoot;
    delete process.env.BLOXFORGE_ROJO_BIN;
    fs.writeFileSync(path.join(root, 'rokit.toml'), '[tools]\nrojo = "rojo-rbx/rojo@7.7.0"\n');
    clearRojoCommandCache();
  });

  afterEach(() => {
    process.env = { ...saved };
    clearRojoCommandCache();
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(rokitRoot, { recursive: true, force: true });
  });

  const shim = () => path.join(rokitRoot, 'bin', process.platform === 'win32' ? 'rojo.exe' : 'rojo');

  test('uses the installed Rokit shim and never a "rokit run" wrapper', () => {
    fs.mkdirSync(path.dirname(shim()), { recursive: true });
    fs.writeFileSync(shim(), '');

    const command = new RojoCommandRunner().resolve(root);
    expect(command).toMatchObject({
      source: 'rokit',
      executable: shim(),
      prefixArgs: [],
      manifest: fs.realpathSync(path.join(root, 'rokit.toml')),
    });
  });

  test('reports that Rokit install is needed instead of falling back silently', () => {
    process.env.PATH = fs.mkdtempSync(path.join(os.tmpdir(), 'bloxforge-empty-path-'));
    clearRojoCommandCache();

    const command = new RojoCommandRunner().resolve(root);
    expect(command.prefixArgs).toEqual([]);
    expect(command.installHint).toMatch(/rokit_install|rokit install/);
  });

  test('a pinned project never silently runs a working global Rojo', () => {
    // The previous check probed PATH first, so a machine with any global Rojo
    // ran that against a project pinned to a version it does not have installed.
    const fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), 'bloxforge-global-rojo-'));
    const global = path.join(fakeBin, process.platform === 'win32' ? 'rojo.cmd' : 'rojo');
    fs.writeFileSync(global, process.platform === 'win32' ? '@echo Rojo 7.5.0\r\n' : '#!/bin/sh\necho "Rojo 7.5.0"\n', { mode: 0o755 });
    process.env.PATH = `${fakeBin}${path.delimiter}${process.env.PATH ?? ''}`;
    clearRojoCommandCache();

    const command = new RojoCommandRunner().resolve(root);
    expect(command.source).toBe('rokit');
    expect(command.installHint).toBeDefined();
    fs.rmSync(fakeBin, { recursive: true, force: true });
  });

  test('re-resolves when an external rokit install creates the shim', () => {
    // `rokit install` writes the shim without touching rokit.toml, so a cache
    // keyed only on the manifest served the stale answer until a restart.
    expect(new RojoCommandRunner().resolve(root).installHint).toBeDefined();

    fs.mkdirSync(path.dirname(shim()), { recursive: true });
    fs.writeFileSync(shim(), '');

    const after = new RojoCommandRunner().resolve(root);
    expect(after).toMatchObject({ source: 'rokit', executable: shim() });
    expect(after.installHint).toBeUndefined();
  });

  test('does not read a toolchain manifest above the project root', () => {
    const outer = fs.mkdtempSync(path.join(os.tmpdir(), 'bloxforge-outer-'));
    const inner = path.join(outer, 'project');
    fs.mkdirSync(inner);
    fs.writeFileSync(path.join(outer, 'rokit.toml'), '[tools]\nrojo = "rojo-rbx/rojo@7.7.0"\n');
    process.env.BLOXFORGE_PROJECT_ROOT = inner;
    clearRojoCommandCache();

    expect(new RojoCommandRunner().resolve(inner).manifest).toBeUndefined();
    fs.rmSync(outer, { recursive: true, force: true });
  });

  test('re-resolves after rokit.toml changes rather than caching once per process', () => {
    const before = new RojoCommandRunner().resolve(root);
    expect(before.executable).not.toBe(shim());

    fs.mkdirSync(path.dirname(shim()), { recursive: true });
    fs.writeFileSync(shim(), '');
    fs.writeFileSync(path.join(root, 'rokit.toml'), '[tools]\nrojo = "rojo-rbx/rojo@7.7.1"\n');

    const after = new RojoCommandRunner().resolve(root);
    expect(after.executable).toBe(shim());
    expect(after.installHint).toBeUndefined();
  });

  test('reads the manifest without modifying it and refuses unsafe specs', () => {
    const tools = new RokitTools();
    const before = fs.readFileSync(path.join(root, 'rokit.toml'), 'utf8');

    expect(tools.getManifest(root)).toMatchObject({
      kind: 'rokit',
      legacy: false,
      tools: [{ name: 'rojo', owner: 'rojo-rbx', repo: 'rojo', version: '7.7.0', valid: true }],
    });
    expect(fs.readFileSync(path.join(root, 'rokit.toml'), 'utf8')).toBe(before);

    expect(tools.install(root, false).error).toMatch(/Confirmation required/);
    expect(tools.addTool(root, 'rojo-rbx/rojo@7.7.0', false).error).toMatch(/Confirmation required/);
    expect(tools.update(root, undefined, false).error).toMatch(/Confirmation required/);
    expect(() => tools.addTool(root, '--not-a-spec', true)).toThrow(/Tool spec/);
    expect(() => tools.update(root, 'rojo; rm -rf /', true)).toThrow(/Tool name/);
  });

  test('treats aftman.toml as legacy without migrating it', () => {
    fs.rmSync(path.join(root, 'rokit.toml'));
    fs.writeFileSync(path.join(root, 'aftman.toml'), '[tools]\nrojo = "rojo-rbx/rojo@7.7.0"\n');

    expect(new RokitTools().detect(root)).toMatchObject({ kind: 'aftman', legacy: true });
    expect(fs.existsSync(path.join(root, 'rokit.toml'))).toBe(false);
  });
});

describe('Wally toolchain', () => {
  let root: string;
  const saved = { ...process.env };

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'bloxforge-wally-'));
    process.env.BLOXFORGE_PROJECT_ROOT = root;
    fs.writeFileSync(path.join(root, 'wally.toml'), `
[package]
name = "biff/minimal"
version = "0.1.0"
registry = "https://github.com/UpliftGames/wally-index"
realm = "shared"

[dependencies]
Roact = "roblox/roact@1.4.4"

[server-dependencies]
Datastore = "kampfkarren/datastore@1.0.0"
`);
    fs.writeFileSync(path.join(root, 'wally.lock'), `
registry = "https://github.com/UpliftGames/wally-index"

[[package]]
name = "roblox/roact"
version = "1.4.4"
checksum = "aaa"
dependencies = [["Symbol", "roblox/symbol@2.0.1"]]

[[package]]
name = "roblox/symbol"
version = "2.0.1"
checksum = "bbb"
dependencies = []
`);
  });

  afterEach(() => {
    process.env = { ...saved };
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('returns real packages and edges rather than TOML key names', () => {
    const graph = new WallyTools().dependencyGraph(root);
    expect(graph.nodes.map((node) => node.id)).toEqual(['roblox/roact@1.4.4', 'roblox/symbol@2.0.1']);
    expect(graph.nodes.map((node) => node.checksum)).toEqual(['aaa', 'bbb']);
    expect(graph.edges).toEqual([{
      from: 'roblox/roact@1.4.4',
      alias: 'Symbol',
      to: 'roblox/symbol@2.0.1',
      resolved: true,
    }]);
    expect(graph.unresolved).toEqual([]);
  });

  test('reports every manifest realm and a lockfile that misses a dependency', () => {
    const tools = new WallyTools();
    expect(tools.getManifest(root).dependencies).toEqual([
      { alias: 'Roact', spec: 'roblox/roact@1.4.4', realm: 'shared', section: 'dependencies' },
      { alias: 'Datastore', spec: 'kampfkarren/datastore@1.0.0', realm: 'server', section: 'server-dependencies' },
    ]);

    const validation = tools.validateLock(root);
    expect(validation.ok).toBe(false);
    expect(validation.missing).toEqual(['Datastore = kampfkarren/datastore@1.0.0']);
    expect(validation.withoutChecksum).toEqual([]);
  });

  test('plans an install and requires confirmation before running one', () => {
    const tools = new WallyTools();
    // `--locked` only reaches the command line when the installed Wally has it;
    // 0.3.2 does not, and silently dropping it would rewrite the lockfile.
    jest.spyOn(tools, 'supportsLocked').mockReturnValue(true);
    expect(tools.installPlan(root)).toMatchObject({
      command: 'wally install --locked',
      lockPresent: true,
      lockedSupported: true,
      confirmationRequired: true,
    });

    jest.spyOn(tools, 'supportsLocked').mockReturnValue(false);
    expect(tools.installPlan(root)).toMatchObject({
      command: 'wally install',
      lockedSupported: false,
      warning: expect.stringContaining('does not support --locked'),
    });
    expect(tools.installApply(root, true, true).error).toMatch(/does not support/);

    expect(tools.installApply(root, false).error).toMatch(/Confirmation required/);
    expect(tools.updateApply(root, [], false).error).toMatch(/Confirmation required/);
    expect(() => tools.search(root, '--output')).toThrow(/option-shaped/);
  });

  test('flags installed package directories the Rojo project does not mount', () => {
    fs.writeFileSync(path.join(root, 'default.project.json'), JSON.stringify({
      name: 'Minimal',
      tree: { $className: 'DataModel', ReplicatedStorage: { Packages: { $path: 'Packages' } } },
    }));
    fs.mkdirSync(path.join(root, 'Packages'));
    fs.mkdirSync(path.join(root, 'ServerPackages'));

    expect(new WallyTools().verifyRojoMapping(root)).toMatchObject({
      packageDirectories: ['Packages', 'ServerPackages'],
      mapped: ['Packages'],
      unmapped: ['ServerPackages'],
      ok: false,
    });
  });

  test('does not count ServerPackages as Packages by substring', () => {
    // "Packages" is a substring of "ServerPackages"; matching the stringified
    // tree reported an unmounted Packages directory as mapped.
    fs.writeFileSync(path.join(root, 'default.project.json'), JSON.stringify({
      name: 'Minimal',
      tree: { $className: 'DataModel', ServerStorage: { Deps: { $path: 'ServerPackages' } } },
    }));
    fs.mkdirSync(path.join(root, 'Packages'));
    fs.mkdirSync(path.join(root, 'ServerPackages'));

    expect(new WallyTools().verifyRojoMapping(root)).toMatchObject({
      mapped: ['ServerPackages'],
      unmapped: ['Packages'],
      ok: false,
    });
  });

  test('missing lockfile fails validation instead of reporting an empty graph', () => {
    fs.rmSync(path.join(root, 'wally.lock'));
    const validation = new WallyTools().validateLock(root);
    expect(validation.ok).toBe(false);
    expect(validation.present).toBe(false);
    expect(validation.error).toMatch(/wally\.lock is missing/);
  });
});
