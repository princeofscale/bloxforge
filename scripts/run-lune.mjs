import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const VERSION = '0.10.5';
const LINUX_X64_ASSET = `lune-${VERSION}-linux-x86_64.zip`;
const LINUX_X64_SHA256 = '1fb5dee6a1afa1d300092805c6e660fe06144d29dd68c45cf6956f040667f791';

function run(command, args, options = {}) {
  return spawnSync(command, args, { stdio: 'inherit', ...options });
}

function hasPinnedSystemLune() {
  const probe = spawnSync('lune', ['--version'], { encoding: 'utf8' });
  return probe.status === 0 && `${probe.stdout}${probe.stderr}`.includes(VERSION);
}

async function provisionLinuxX64() {
  if (process.platform !== 'linux' || process.arch !== 'x64') {
    throw new Error(`Lune ${VERSION} is not on PATH and automatic provisioning currently supports linux-x64 only.`);
  }

  // Under the user's home, not the system temp directory. A cache hit below
  // skips the checksum, and /tmp is writable by every local account: anyone
  // could pre-create this path and have the release gate execute their binary.
  const cacheRoot = process.env.BLOXFORGE_TOOL_CACHE?.trim()
    || path.join(homedir(), '.cache', 'bloxforge-tools');
  const installDir = path.join(cacheRoot, `lune-${VERSION}-linux-x64`);
  const binary = path.join(installDir, 'lune');
  if (existsSync(binary)) return binary;

  await mkdir(installDir, { recursive: true });
  const archive = path.join(installDir, LINUX_X64_ASSET);
  const url = `https://github.com/lune-org/lune/releases/download/v${VERSION}/${LINUX_X64_ASSET}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not download pinned Lune (${response.status} ${response.statusText}).`);
  await writeFile(archive, Buffer.from(await response.arrayBuffer()));

  const digest = createHash('sha256').update(await readFile(archive)).digest('hex');
  if (digest !== LINUX_X64_SHA256) {
    throw new Error(`Pinned Lune checksum mismatch: expected ${LINUX_X64_SHA256}, got ${digest}.`);
  }

  const unzip = run('unzip', ['-q', '-o', archive, '-d', installDir]);
  if (unzip.status !== 0) throw new Error('Could not extract pinned Lune; install the unzip utility and retry.');
  await chmod(binary, 0o755);
  return binary;
}

try {
  const binary = hasPinnedSystemLune() ? 'lune' : await provisionLinuxX64();
  const result = run(binary, process.argv.slice(2));
  process.exitCode = result.status ?? 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
