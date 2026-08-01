import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { RojoCommandRunner, clearRojoCommandCache } from '../rojo/command-runner.js';
import { RokitTools } from '../toolchain/rokit-tools.js';
import { WallyTools } from '../toolchain/wally-tools.js';
import { clearToolCommandCache, resolveToolCommand } from '../toolchain/resolver.js';
import { hasCommand, run } from '../quality-tools.js';

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

  test('a pinned project never silently runs a working global Rojo', async () => {
    // Asserting on the resolved metadata is not enough: `executable: 'rojo'`
    // reports source 'rokit' and still lets execFile find a global Rojo on PATH.
    // This runs it, which is the only assertion that catches that.
    const fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), 'bloxforge-global-rojo-'));
    const global = path.join(fakeBin, process.platform === 'win32' ? 'rojo.cmd' : 'rojo');
    fs.writeFileSync(global, process.platform === 'win32' ? '@echo Rojo 7.5.0\r\n' : '#!/bin/sh\necho "Rojo 7.5.0"\n', { mode: 0o755 });
    process.env.PATH = `${fakeBin}${path.delimiter}${process.env.PATH ?? ''}`;
    clearRojoCommandCache();

    const command = new RojoCommandRunner().resolve(root);
    expect(command.source).toBe('rokit');
    expect(command.executable).toBe(shim());
    expect(command.installHint).toBeDefined();

    const version = await new RojoCommandRunner().version(root);
    expect(version.available).toBe(false);
    expect(version.version).toBeUndefined();
    expect(version.error).toMatch(/declares rojo but no installed shim/);
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
    // Both states name the shim; what changes is whether it is installed, so
    // `installHint` is the signal rather than the executable path.
    const before = new RojoCommandRunner().resolve(root);
    expect(before.installHint).toBeDefined();

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

  test('reports installRequired for a shim of the wrong version, not only a missing one', () => {
    fs.mkdirSync(path.dirname(shim()), { recursive: true });
    fs.writeFileSync(
      shim(),
      process.platform === 'win32' ? '@echo Rojo 7.6.0\r\n' : '#!/bin/sh\necho "Rojo 7.6.0"\n',
      { mode: 0o755 },
    );

    const status = new RokitTools().status(root);
    expect(status.tools[0].shimInstalled).toBe(true);
    // `installRequired` used to mean only "the shim file is missing", so an
    // installed shim that cannot satisfy the manifest reported nothing to do.
    expect(status.installRequired).toBe(true);
    expect(status.healthy).toBe(false);
    expect(status.action).toBe('install');
    // A shell shim is not executable on Windows, so the probe fails there
    // instead of reporting 7.6.0 — both are states an install fixes.
    expect(status.reasons.join(' ')).toMatch(/manifest pins 7\.7\.0|did not report a version/);
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

  test('fails validation when the lock pins a version the manifest does not allow', () => {
    // Only names were compared, so a manifest asking for 2.0.0 against a lock
    // pinning 1.4.4 validated as ok.
    fs.writeFileSync(path.join(root, 'wally.toml'), `
[package]
name = "biff/minimal"
version = "0.1.0"
registry = "https://github.com/UpliftGames/wally-index"
realm = "shared"

[dependencies]
Roact = "roblox/roact@2.0.0"
Symbol = "roblox/symbol@^2.0.0"
`);
    const validation = new WallyTools().validateLock(root);
    expect(validation.ok).toBe(false);
    expect(validation.missing).toEqual([]);
    expect(validation.mismatched).toEqual([
      { alias: 'Roact', spec: 'roblox/roact@2.0.0', locked: '1.4.4' },
    ]);
    // `^2.0.0` is satisfied by the locked 2.0.1, so Symbol is not reported.
  });

  test('keeps both versions when a lockfile carries two of one package', () => {
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

[[package]]
name = "roblox/symbol"
version = "1.0.0"
checksum = "ccc"
dependencies = []
`);
    const graph = new WallyTools().dependencyGraph(root);
    // A name-keyed map kept only the last symbol and pointed the edge at it.
    expect(graph.nodes.map((node) => node.id)).toEqual([
      'roblox/roact@1.4.4',
      'roblox/symbol@2.0.1',
      'roblox/symbol@1.0.0',
    ]);
    expect(graph.edges).toEqual([
      { from: 'roblox/roact@1.4.4', alias: 'Symbol', to: 'roblox/symbol@2.0.1', resolved: true },
    ]);
  });

  test('missing lockfile fails validation instead of reporting an empty graph', () => {
    fs.rmSync(path.join(root, 'wally.lock'));
    const validation = new WallyTools().validateLock(root);
    expect(validation.ok).toBe(false);
    expect(validation.present).toBe(false);
    expect(validation.error).toMatch(/wally\.lock is missing/);
    // Same `alias = spec` shape the present-lock branch reports, so one parser
    // handles both instead of two.
    expect(validation.missing).toEqual(expect.arrayContaining([expect.stringContaining(' = ')]));
  });

  test('an edge whose only candidate misses the requirement is unresolved', () => {
    // The trailing single-candidate fallback resolved it anyway, so `unresolved`
    // stayed empty and validateLock could pass a lock whose transitive edge
    // points at a version the parent rejects.
    fs.writeFileSync(path.join(root, 'wally.lock'), `
registry = "https://github.com/UpliftGames/wally-index"

[[package]]
name = "roblox/roact"
version = "1.4.4"
checksum = "aaa"
dependencies = [["Symbol", "roblox/symbol@^3.0.0"]]

[[package]]
name = "roblox/symbol"
version = "2.0.1"
checksum = "bbb"
dependencies = []
`);
    const graph = new WallyTools().dependencyGraph(root);
    expect(graph.edges).toEqual([
      { from: 'roblox/roact@1.4.4', alias: 'Symbol', to: 'roblox/symbol@^3.0.0', resolved: false },
    ]);
    expect(graph.unresolved).toEqual(['roblox/symbol@^3.0.0']);
  });

  test('a locked prerelease is unverifiable, and a bare ~1 spans the major', () => {
    // Cargo excludes prereleases from a plain requirement, and `~1` means
    // >=1.0.0 <2.0.0 — not >=1.0.0 <1.1.0. Stripping the suffix and comparing
    // numbers said 2.0.0-rc.1 satisfied ^2.0.0.
    fs.writeFileSync(path.join(root, 'wally.lock'), `
registry = "https://github.com/UpliftGames/wally-index"

[[package]]
name = "roblox/roact"
version = "2.0.0-rc.1"
checksum = "aaa"
dependencies = []

[[package]]
name = "roblox/symbol"
version = "1.4.0"
checksum = "bbb"
dependencies = []
`);
    fs.writeFileSync(path.join(root, 'wally.toml'), `
[package]
name = "biff/minimal"
version = "0.1.0"
registry = "https://github.com/UpliftGames/wally-index"
realm = "shared"

[dependencies]
Roact = "roblox/roact@^2.0.0"
Symbol = "roblox/symbol@~1"
`);
    const validation = new WallyTools().validateLock(root);
    expect(validation.mismatched).toEqual([]);
    expect(validation.unverifiable).toEqual([
      { alias: 'Roact', spec: 'roblox/roact@^2.0.0', locked: '2.0.0-rc.1' },
    ]);
    expect(validation.ok).toBe(false);
  });
});

describe('shared toolchain resolver', () => {
  let root: string;
  let rokitRoot: string;
  const saved = { ...process.env };

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'bloxforge-resolver-'));
    rokitRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bloxforge-resolver-home-'));
    process.env.BLOXFORGE_PROJECT_ROOT = root;
    process.env.ROKIT_ROOT = rokitRoot;
    delete process.env.BLOXFORGE_ROJO_BIN;
    fs.writeFileSync(
      path.join(root, 'rokit.toml'),
      '[tools]\nrojo = "rojo-rbx/rojo@7.7.0"\nwally = "UpliftGames/wally@0.3.2"\nselene = "Kampfkarren/selene@0.28.0"\n',
    );
    clearToolCommandCache();
  });

  afterEach(() => {
    process.env = { ...saved };
    clearToolCommandCache();
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(rokitRoot, { recursive: true, force: true });
  });

  const shimFor = (tool: string) =>
    path.join(rokitRoot, 'bin', process.platform === 'win32' ? `${tool}.exe` : tool);

  test('resolves every pinned tool through its shim, not just Rojo', () => {
    // Wally, Selene, StyLua and Lune were invoked by bare name, so they were
    // found on PATH only and stayed "not installed" until a server restart.
    for (const tool of ['rojo', 'wally', 'selene']) {
      fs.mkdirSync(path.dirname(shimFor(tool)), { recursive: true });
      fs.writeFileSync(shimFor(tool), '');
      expect(resolveToolCommand(tool, root)).toMatchObject({
        source: 'rokit',
        executable: shimFor(tool),
        manifest: fs.realpathSync(path.join(root, 'rokit.toml')),
      });
    }
  });

  test('a pinned-but-missing tool is unavailable even with a global copy on PATH', () => {
    const fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), 'bloxforge-global-wally-'));
    const global = path.join(fakeBin, process.platform === 'win32' ? 'wally.cmd' : 'wally');
    fs.writeFileSync(global, process.platform === 'win32' ? '@echo wally 0.3.1\r\n' : '#!/bin/sh\necho "wally 0.3.1"\n', { mode: 0o755 });
    process.env.PATH = `${fakeBin}${path.delimiter}${process.env.PATH ?? ''}`;
    clearToolCommandCache();

    expect(resolveToolCommand('wally', root).installHint).toMatch(/no installed shim/);
    expect(hasCommand('wally', root)).toBe(false);
    expect(run('wally', ['install'], { cwd: root })).toMatchObject({
      available: false,
      ok: false,
      error: expect.stringMatching(/no installed shim/),
    });
    fs.rmSync(fakeBin, { recursive: true, force: true });
  });

  test('a tool the manifest does not pin still resolves from PATH', () => {
    expect(resolveToolCommand('stylua', root)).toMatchObject({ source: 'path', executable: 'stylua' });
  });

  test('the first manifest that pins a tool wins even when its shim is missing', () => {
    // Falling through to an installed Aftman shim would run an aftman-pinned
    // version against a rokit-pinned project, and would disagree with
    // RokitTools.detect, which stops at the first manifest it finds.
    const aftmanRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bloxforge-aftman-home-'));
    process.env.AFTMAN_ROOT = aftmanRoot;
    const aftmanShim = path.join(aftmanRoot, 'bin', process.platform === 'win32' ? 'rojo.exe' : 'rojo');
    fs.mkdirSync(path.dirname(aftmanShim), { recursive: true });
    fs.writeFileSync(aftmanShim, '');
    fs.writeFileSync(path.join(root, 'aftman.toml'), '[tools]\nrojo = "rojo-rbx/rojo@7.4.0"\n');
    clearToolCommandCache();

    expect(resolveToolCommand('rojo', root)).toMatchObject({
      source: 'rokit',
      executable: shimFor('rojo'),
      installHint: expect.stringMatching(/no installed shim/),
    });
    fs.rmSync(aftmanRoot, { recursive: true, force: true });
  });

  test('an unreadable project root falls back instead of throwing', () => {
    // existsSync + realpathSync is not atomic, and quality-tools calls the
    // resolver outside a try: an ENOENT here escaped as an unhandled tool error.
    const gone = path.join(root, 'deleted-between-the-two-calls');
    expect(() => resolveToolCommand('stylua', gone)).not.toThrow();
    expect(resolveToolCommand('stylua', gone).source).toBe('path');
  });
});
