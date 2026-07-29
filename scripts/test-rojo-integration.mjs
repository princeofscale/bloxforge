import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

try {
  const version = run(['--version']);
  if (!version.includes(expected)) throw new Error(`Expected Rojo ${expected}, got ${version.trim()}`);

  mkdirSync(path.join(root, 'src', 'ServerScriptService'), { recursive: true });
  mkdirSync(path.join(root, 'src', 'ReplicatedStorage', 'Library'), { recursive: true });
  writeFileSync(path.join(root, 'src', 'ServerScriptService', 'Main.server.lua'), 'print("server")\n');
  writeFileSync(path.join(root, 'src', 'ReplicatedStorage', 'Library', 'init.lua'), 'return {}\n');
  writeFileSync(path.join(root, 'src', 'ReplicatedStorage', 'Library', 'init.meta.json'), '{"ignoreUnknownInstances":true}\n');
  writeFileSync(path.join(root, 'fixture.project.json'), `{
    // Stable Rojo supports comments and trailing commas.
    "name": "IntegrationFixture",
    "tree": {
      "$className": "DataModel",
      "ServerScriptService": { "$path": "src/ServerScriptService" },
      "ReplicatedStorage": { "$path": "src/ReplicatedStorage" },
    },
  }\n`);

  run(['build', 'fixture.project.json', '--output', 'fixture.rbxl']);
  run(['sourcemap', 'fixture.project.json', '--output', 'sourcemap.json']);
  const sourcemap = readFileSync(path.join(root, 'sourcemap.json'), 'utf8');
  for (const expectedPath of ['Main.server.lua', 'Library/init.lua']) {
    if (!sourcemap.includes(expectedPath)) throw new Error(`Sourcemap omitted ${expectedPath}`);
  }
  writeFileSync(path.join(root, 'src', 'ServerScriptService', 'Main.server.lua'), 'print("local divergence")\n');
  const syncback = run([
    'syncback',
    'fixture.project.json',
    '--input',
    'fixture.rbxl',
    '--dry-run',
    '--list',
    '--non-interactive',
  ]);
  if (!syncback.includes('Main.server.lua')) throw new Error('syncback dry-run did not list the divergent source');
  console.log(`rojo-integration: Rojo ${expected} build, JSONC, init.lua, meta, sourcemap, and syncback dry-run checks passed`);
} finally {
  rmSync(root, { recursive: true, force: true });
}
