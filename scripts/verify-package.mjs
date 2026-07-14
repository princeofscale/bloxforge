import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

function run(command, args, cwd = rootDir) {
  console.log(`> [${cwd}] ${command} ${args.join(' ')}`);
  try {
    return execFileSync(command, args, { cwd, stdio: 'pipe', encoding: 'utf8' });
  } catch (error) {
    console.error(`Command failed: ${command} ${args.join(' ')}`);
    console.error(`STDOUT:\n${error.stdout ?? ''}`);
    console.error(`STDERR:\n${error.stderr ?? ''}`);
    throw error;
  }
}

function pack(workspace, destination) {
  const before = new Set(fs.readdirSync(destination));
  run(npm, ['pack', workspace, '--pack-destination', destination]);
  const created = fs.readdirSync(destination)
    .filter((filename) => filename.endsWith('.tgz') && !before.has(filename));
  if (created.length !== 1) throw new Error(`Expected one tarball for ${workspace}, found ${created.length}`);
  return path.join(destination, created[0]);
}

async function verify() {
  console.log('--- Verifying BloxForge Packages ---');
  run(npm, ['run', 'build']);

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloxforge-verify-'));
  console.log(`Temporary workspace: ${tempDir}`);

  try {
    const tarballs = [
      pack('./packages/core', tempDir),
      pack('./packages/robloxstudio-mcp', tempDir),
      pack('./packages/robloxstudio-mcp-inspector', tempDir),
    ];

    run(npm, ['init', '-y'], tempDir);
    run(npm, ['install', ...tarballs, '--no-save'], tempDir);

    run(process.execPath, [
      '--input-type=module',
      '--eval',
      "import { BloxForgeServer } from '@princeofscale/bloxforge-core'; if (!BloxForgeServer) throw new Error('Core import failed')",
    ], tempDir);
    run(npx, ['--no-install', 'bloxforge', '--help'], tempDir);
    run(npx, ['--no-install', 'bloxforge-inspector', '--help'], tempDir);

    console.log('Verification successful: packages are installable and both CLIs start.');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

verify().catch((error) => {
  console.error('Verification failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
