import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const npmCli = process.env.npm_execpath;
let npmCache;

function run(command, args, cwd = rootDir) {
  console.log(`> [${cwd}] ${command} ${args.join(' ')}`);
  try {
    return execFileSync(command, args, {
      cwd,
      stdio: 'pipe',
      encoding: 'utf8',
      env: npmCache ? { ...process.env, NPM_CONFIG_CACHE: npmCache } : process.env,
    });
  } catch (error) {
    console.error(`Command failed: ${command} ${args.join(' ')}`);
    console.error(`STDOUT:\n${error.stdout ?? ''}`);
    console.error(`STDERR:\n${error.stderr ?? ''}`);
    throw error;
  }
}

function runNpm(args, cwd = rootDir) {
  if (!npmCli) throw new Error('npm executable path unavailable; run this check with npm run verify-package');
  return run(process.execPath, [npmCli, ...args], cwd);
}

function pack(workspace, destination) {
  const before = new Set(fs.readdirSync(destination));
  runNpm(['pack', workspace, '--pack-destination', destination]);
  const created = fs.readdirSync(destination)
    .filter((filename) => filename.endsWith('.tgz') && !before.has(filename));
  if (created.length !== 1) throw new Error(`Expected one tarball for ${workspace}, found ${created.length}`);
  return path.join(destination, created[0]);
}

function verifyRuntimeContents(tarball, expectedPlugin, forbiddenPlugin) {
  const entries = run('tar', ['-tzf', tarball]).trim().split(/\r?\n/);
  const required = [
    `package/studio-plugin/${expectedPlugin}`,
    'package/assets/Baseplate.rbxl',
  ];
  for (const entry of required) {
    if (!entries.includes(entry)) throw new Error(`${path.basename(tarball)} is missing ${entry}`);
  }

  const forbidden = [
    `package/studio-plugin/${forbiddenPlugin}`,
    'package/studio-plugin/src/',
    'package/studio-plugin/include/',
    'package/studio-plugin/node_modules/',
  ];
  for (const prefix of forbidden) {
    if (entries.some((entry) => entry === prefix || entry.startsWith(prefix))) {
      throw new Error(`${path.basename(tarball)} unexpectedly contains ${prefix}`);
    }
  }
}

async function verify() {
  console.log('--- Verifying BloxForge Packages ---');
  runNpm(['run', 'build']);

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloxforge-verify-'));
  npmCache = path.join(tempDir, 'npm-cache');
  console.log(`Temporary workspace: ${tempDir}`);

  try {
    const coreTarball = pack('./packages/core', tempDir);
    const fullTarball = pack('./packages/robloxstudio-mcp', tempDir);
    const inspectorTarball = pack('./packages/robloxstudio-mcp-inspector', tempDir);
    const tarballs = [coreTarball, fullTarball, inspectorTarball];

    verifyRuntimeContents(fullTarball, 'MCPPlugin.rbxmx', 'MCPInspectorPlugin.rbxmx');
    verifyRuntimeContents(inspectorTarball, 'MCPInspectorPlugin.rbxmx', 'MCPPlugin.rbxmx');

    runNpm(['init', '-y'], tempDir);
    runNpm(['install', ...tarballs, '--no-save'], tempDir);

    run(process.execPath, [
      '--input-type=module',
      '--eval',
      "import { BloxForgeServer } from '@princeofscale/bloxforge-core'; if (!BloxForgeServer) throw new Error('Core import failed')",
    ], tempDir);
    runNpm(['exec', '--no', '--', 'bloxforge', '--help'], tempDir);
    runNpm(['exec', '--no', '--', 'bloxforge-inspector', '--help'], tempDir);

    console.log('Verification successful: packages are installable and both CLIs start.');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

verify().catch((error) => {
  console.error('Verification failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
