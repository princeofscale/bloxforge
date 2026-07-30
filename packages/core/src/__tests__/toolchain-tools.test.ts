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

  test('plans a locked install and requires confirmation before running one', () => {
    const tools = new WallyTools();
    expect(tools.installPlan(root)).toMatchObject({
      command: 'wally install --locked',
      lockPresent: true,
      confirmationRequired: true,
    });
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

  test('missing lockfile fails validation instead of reporting an empty graph', () => {
    fs.rmSync(path.join(root, 'wally.lock'));
    const validation = new WallyTools().validateLock(root);
    expect(validation.ok).toBe(false);
    expect(validation.present).toBe(false);
    expect(validation.error).toMatch(/wally\.lock is missing/);
  });
});
