import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const expected = process.env.BLOXFORGE_EXPECTED_ROJO_VERSION || '7.7.0';
const root = mkdtempSync(path.join(os.tmpdir(), 'bloxforge-rojo-integration-'));

function run(args) {
  return execFileSync('rojo', args, {
    cwd: root,
    encoding: 'utf8',
    timeout: 30000,
    maxBuffer: 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function write(relative, content) {
  const file = path.join(root, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
}

try {
  const version = run(['--version']);
  if (!version.includes(expected)) throw new Error(`Expected Rojo ${expected}, got ${version.trim()}`);

  // Every file form BloxForge's classifier claims Rojo 7.7 supports. If real
  // Rojo disagrees, these assertions fail here instead of the mistake silently
  // reaching a syncback rollback that skips the same files.
  write('src/ServerScriptService/Main.server.lua', 'print("server")\n');
  write('src/ServerScriptService/Modern.server.luau', 'print("server luau")\n');
  write('src/StarterPlayer/StarterPlayerScripts/Controller.client.luau', 'print("client luau")\n');
  write('src/ReplicatedStorage/Library/init.lua', 'return {}\n');
  write('src/ReplicatedStorage/Library/init.meta.json', '{"ignoreUnknownInstances":true}\n');
  write('src/ReplicatedStorage/Modern/init.luau', 'return {}\n');
  write('src/ReplicatedStorage/Modern/init.meta.jsonc', '{\n  // JSONC metadata\n  "ignoreUnknownInstances": true,\n}\n');
  write('src/ReplicatedStorage/Config.luau', 'return { enabled = true }\n');
  write('src/ReplicatedStorage/Settings.jsonc', '{\n  // JSONC value\n  "enabled": true,\n}\n');
  write('src/ReplicatedStorage/Tuning.yml', 'enabled: true\n');
  write('src/ReplicatedStorage/Limits.yaml', 'maximum: 10\n');
  write('src/ReplicatedStorage/Marker.model.jsonc', '{\n  // JSONC model\n  "className": "Folder",\n}\n');

  // Rojo made "name" optional in 7.4.1 and added .project.jsonc in 7.7.
  write('fixture.project.jsonc', `{
    // Stable Rojo supports comments and trailing commas.
    "tree": {
      "$className": "DataModel",
      "ServerScriptService": { "$path": "src/ServerScriptService" },
      "ReplicatedStorage": { "$path": "src/ReplicatedStorage" },
      "StarterPlayer": {
        "$className": "StarterPlayer",
        "StarterPlayerScripts": { "$path": "src/StarterPlayer/StarterPlayerScripts" },
      },
    },
  }\n`);

  run(['build', 'fixture.project.jsonc', '--output', 'fixture.rbxl']);
  if (!existsSync(path.join(root, 'fixture.rbxl'))) throw new Error('rojo build produced no output');

  run(['sourcemap', 'fixture.project.jsonc', '--output', 'sourcemap.json']);
  const sourcemap = readFileSync(path.join(root, 'sourcemap.json'), 'utf8');
  for (const expectedPath of [
    'Main.server.lua',
    'Modern.server.luau',
    'Controller.client.luau',
    'Library/init.lua',
    'Modern/init.luau',
    'Config.luau',
    'Settings.jsonc',
    'Tuning.yml',
    'Limits.yaml',
    'Marker.model.jsonc',
  ]) {
    if (!sourcemap.includes(expectedPath.split('/').pop())) {
      throw new Error(`Sourcemap omitted ${expectedPath}; Rojo ${expected} does not map it the way BloxForge assumes`);
    }
  }

  // A .luau divergence must appear in the syncback plan — that is exactly the
  // file class the old classifier left out of the rollback snapshot.
  writeFileSync(path.join(root, 'src', 'ServerScriptService', 'Modern.server.luau'), 'print("local divergence")\n');
  const syncback = run([
    'syncback',
    'fixture.project.jsonc',
    '--input',
    'fixture.rbxl',
    '--dry-run',
    '--list',
    '--non-interactive',
  ]);
  if (!syncback.includes('Modern.server.luau')) {
    throw new Error('syncback dry-run did not list the divergent .luau source');
  }

  console.log(
    `rojo-integration: Rojo ${expected} verified .project.jsonc, optional project name, `
    + '.luau/.server.luau/.client.luau, init.luau, .meta.jsonc, .model.jsonc, .jsonc, YAML, '
    + 'sourcemap, and a .luau syncback dry-run',
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}
