import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  discoverRojoProjects,
  selectRojoProject,
} from '../rojo/project-discovery.js';
import {
  classifyRojoSource,
  resolveProjectPath,
  resolveProjectRoot,
  unsupportedInstanceNameReason,
} from '../rojo/source-mapper.js';
import {
  instancePathSegments,
  resolveInstanceSource,
  resolveSourceInstance,
} from '../rojo/sourcemap.js';

describe('Rojo project adapter', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'bloxforge-rojo-project-'));
    process.env.BLOXFORGE_PROJECT_ROOT = root;
  });

  afterEach(() => {
    delete process.env.BLOXFORGE_PROJECT_ROOT;
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('discovers arbitrary nested project names and parses JSONC', () => {
    const nested = path.join(root, 'games', 'arena');
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(path.join(nested, 'arena.project.json'), `{
      // Rojo 7.6+ accepts comments and trailing commas.
      "name": "Arena",
      "servePort": 34873,
      "tree": { "$className": "DataModel", },
    }`);

    expect(discoverRojoProjects(root)).toEqual([
      expect.objectContaining({
        name: 'Arena',
        projectFile: fs.realpathSync(path.join(nested, 'arena.project.json')),
        servePort: 34873,
      }),
    ]);
  });

  test('discovers and selects real .project.jsonc files', () => {
    const file = path.join(root, 'arena.project.jsonc');
    fs.writeFileSync(file, `{
      // Rojo 7.7 accepts .project.jsonc for every JSON-shaped project file.
      "name": "Arena",
      "tree": { "$className": "DataModel" },
    }`);

    expect(discoverRojoProjects(root)).toEqual([
      expect.objectContaining({ name: 'Arena', projectFile: fs.realpathSync(file) }),
    ]);
    expect(selectRojoProject(root, 'arena.project.jsonc').name).toBe('Arena');
  });

  test('derives the project name the way Rojo does when "name" is omitted', () => {
    const nested = path.join(root, 'MyGame');
    fs.mkdirSync(nested);
    fs.writeFileSync(path.join(nested, 'default.project.json'), '{"tree":{"$className":"DataModel"}}');
    fs.writeFileSync(path.join(root, 'shared.project.json'), '{"tree":{}}');

    expect(selectRojoProject(root, 'MyGame/default.project.json').name).toBe('MyGame');
    expect(selectRojoProject(root, 'shared.project.json').name).toBe('shared');
  });

  test('requires explicit selection when multiple projects exist', () => {
    fs.writeFileSync(path.join(root, 'a.project.json'), '{"name":"A","tree":{}}');
    fs.writeFileSync(path.join(root, 'b.project.json'), '{"name":"B","tree":{}}');

    expect(() => selectRojoProject(root)).toThrow(/Multiple Rojo project files/);
    expect(selectRojoProject(root, 'b.project.json').name).toBe('B');
  });

  test.each([
    ['Main.server.lua', 'Script'],
    ['Controller.client.lua', 'LocalScript'],
    ['Util.lua', 'ModuleScript'],
    ['init.server.lua', 'Script'],
    ['init.client.lua', 'LocalScript'],
    ['init.lua', 'ModuleScript'],
    ['Main.server.luau', 'Script'],
    ['Controller.client.luau', 'LocalScript'],
    ['Util.luau', 'ModuleScript'],
    ['init.server.luau', 'Script'],
    ['init.client.luau', 'LocalScript'],
    ['init.luau', 'ModuleScript'],
    ['Widget.plugin.lua', 'PluginScript'],
    ['Widget.plugin.luau', 'PluginScript'],
    ['init.plugin.luau', 'PluginScript'],
    ['Thing.meta.json', 'meta'],
    ['Thing.meta.jsonc', 'meta'],
    ['Thing.model.json', 'model'],
    ['Thing.model.jsonc', 'model'],
    ['Thing.rbxm', 'model'],
    ['Thing.rbxmx', 'model'],
    ['game.project.jsonc', 'project'],
    ['data.json', 'value'],
    ['data.jsonc', 'value'],
    ['data.toml', 'value'],
    ['data.txt', 'value'],
    ['data.csv', 'value'],
    ['data.yml', 'value'],
    ['data.yaml', 'value'],
  ])('classifies official Rojo mapping %s', (fileName, kind) => {
    expect(classifyRojoSource(fileName)?.kind).toBe(kind);
  });

  test('reports unrepresentable instance names instead of encoding them', () => {
    // Rojo refuses these rather than inventing a name it cannot decode back.
    expect(unsupportedInstanceNameReason('CON')).toMatch(/reserved by Windows/);
    expect(unsupportedInstanceNameReason('bad:name')).toMatch(/":"/);
    expect(unsupportedInstanceNameReason('bad/name')).toMatch(/"\/"/);
    expect(unsupportedInstanceNameReason('..')).toMatch(/dot or space/);
    expect(unsupportedInstanceNameReason('trailing ')).toMatch(/dot or space/);
    expect(unsupportedInstanceNameReason('')).toMatch(/empty/);
    expect(unsupportedInstanceNameReason('Привет')).toBeUndefined();
    expect(unsupportedInstanceNameReason('Perfectly Fine')).toBeUndefined();
  });

  test('rejects traversal and symlink escapes from the project root', () => {
    expect(() => resolveProjectPath(root, '../escape.lua', false)).toThrow(/project root/);
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'bloxforge-rojo-outside-'));
    try {
      try {
        fs.symlinkSync(outside, path.join(root, 'linked'), 'junction');
      } catch (error) {
        // Windows needs Developer Mode or elevation to create links; CI covers
        // this assertion on Linux and macOS.
        if ((error as NodeJS.ErrnoException).code === 'EPERM') return;
        throw error;
      }
      expect(() => resolveProjectPath(root, 'linked/escape.lua', false)).toThrow(/project root/);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  test('resolves relative search roots from BLOXFORGE_PROJECT_ROOT', () => {
    fs.mkdirSync(path.join(root, 'nested'));
    expect(resolveProjectRoot('nested')).toBe(fs.realpathSync(path.join(root, 'nested')));
  });
});

describe('sourcemap instance resolution', () => {
  let root: string;

  // Rojo names the sourcemap root after the project, and it emits a nested
  // Instance under whatever name the developer gave it — including "game".
  const sourcemap = {
    name: 'BloxForgeGame',
    className: 'DataModel',
    children: [{
      name: 'ReplicatedStorage',
      className: 'ReplicatedStorage',
      children: [
        { name: 'Shared', className: 'ModuleScript', filePaths: ['src/shared/init.luau'] },
        {
          name: 'game',
          className: 'Folder',
          children: [{ name: 'Config', className: 'ModuleScript', filePaths: ['src/game/Config.luau'] }],
        },
      ],
    }],
  };

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'bloxforge-rojo-sourcemap-'));
    process.env.BLOXFORGE_PROJECT_ROOT = root;
    fs.writeFileSync(path.join(root, 'sourcemap.json'), JSON.stringify(sourcemap));
    fs.mkdirSync(path.join(root, 'src', 'shared'), { recursive: true });
    fs.mkdirSync(path.join(root, 'src', 'game'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src', 'shared', 'init.luau'), 'return {}');
    fs.writeFileSync(path.join(root, 'src', 'game', 'Config.luau'), 'return {}');
  });

  afterEach(() => {
    delete process.env.BLOXFORGE_PROJECT_ROOT;
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('does not prefix user paths with the project name', () => {
    // The root node is "BloxForgeGame", so including it made every lookup of a
    // real game path miss.
    expect(resolveInstanceSource(root, 'game.ReplicatedStorage.Shared')).toMatchObject({
      resolved: true,
      instancePathSegments: ['ReplicatedStorage', 'Shared'],
      sourcePaths: ['src/shared/init.luau'],
    });
    expect(resolveInstanceSource(root, ['game', 'ReplicatedStorage', 'Shared'])).toMatchObject({ resolved: true });
  });

  test('keeps an Instance legitimately named "game"', () => {
    // The string form used to drop every "game" segment, so this resolved to the
    // wrong Instance (or to nothing) while the array form worked.
    expect(resolveInstanceSource(root, 'game.ReplicatedStorage.game.Config')).toMatchObject({
      resolved: true,
      instancePathSegments: ['ReplicatedStorage', 'game', 'Config'],
      sourcePaths: ['src/game/Config.luau'],
    });
    expect(instancePathSegments('game.ReplicatedStorage.game.Config'))
      .toEqual(instancePathSegments(['game', 'ReplicatedStorage', 'game', 'Config']));
  });

  test('maps a source file back to a path that starts at the DataModel', () => {
    expect(resolveSourceInstance(root, 'src/game/Config.luau')).toMatchObject({
      resolved: true,
      instancePath: 'game.ReplicatedStorage.game.Config',
    });
  });
});
