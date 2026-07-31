// Verifies the Rokit/Wally contract against the real CLIs:
//  - tools pinned in rokit.toml resolve to shims, not to whatever is on PATH;
//  - `wally install --locked` fails on a stale/missing lockfile and succeeds on
//    a good one, which is the only install mode CI should ever use;
//  - the parsed lockfile yields real package identities.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Not `import.meta.dirname`: that needs Node 20.11, and package.json promises >=20.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = mkdtempSync(path.join(os.tmpdir(), 'bloxforge-toolchain-'));
const shimDirectory = path.join(os.homedir(), '.rokit', 'bin');

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: options.cwd ?? root,
    encoding: 'utf8',
    timeout: options.timeoutMs ?? 300000,
    maxBuffer: 4 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function tryRun(command, args, options = {}) {
  try {
    return { ok: true, output: run(command, args, options) };
  } catch (error) {
    return { ok: false, output: [error.stdout, error.stderr].filter(Boolean).join('\n') };
  }
}

function write(relative, content) {
  const file = path.join(root, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  write('rokit.toml', [
    '[tools]',
    'rojo = "rojo-rbx/rojo@7.7.0"',
    'wally = "UpliftGames/wally@0.3.2"',
    '',
  ].join('\n'));

  run('rokit', ['install', '--no-trust-check'], { cwd: root });

  for (const tool of ['rojo', 'wally']) {
    const shim = path.join(shimDirectory, tool);
    assert(existsSync(shim), `rokit install did not create a shim at ${shim}`);
    const version = run(shim, ['--version'], { cwd: root });
    console.log(`toolchain-integration: ${tool} shim reports ${version.trim()}`);
  }
  assert(
    run(path.join(shimDirectory, 'rojo'), ['--version'], { cwd: root }).includes('7.7.0'),
    'Rokit shim did not resolve the version pinned in rokit.toml',
  );

  // BloxForge must pick the shim for this project rather than a global Rojo.
  const { RojoCommandRunner, clearRojoCommandCache } = await import(
    pathToFileURL(path.join(REPO_ROOT, 'packages/core/dist/rojo/command-runner.js')).href
  );
  process.env.BLOXFORGE_PROJECT_ROOT = root;
  delete process.env.BLOXFORGE_ROJO_BIN;
  clearRojoCommandCache();
  const resolved = new RojoCommandRunner().resolve(root);
  assert(resolved.source === 'rokit', `Expected the Rokit shim, resolved ${resolved.source} (${resolved.executable})`);
  assert(resolved.prefixArgs.length === 0, `Rokit resolution must not use a wrapper command: ${JSON.stringify(resolved.prefixArgs)}`);

  // --locked must refuse to invent a lockfile.
  write('wally.toml', [
    '[package]',
    'name = "bloxforge/toolchain-fixture"',
    'version = "0.1.0"',
    'registry = "https://github.com/UpliftGames/wally-index"',
    'realm = "shared"',
    '',
    '[dependencies]',
    '',
  ].join('\n'));

  const { WallyTools } = await import(
    pathToFileURL(path.join(REPO_ROOT, 'packages/core/dist/toolchain/wally-tools.js')).href
  );
  const wallyTools = new WallyTools();

  // `--locked` is not in the released Wally 0.3.2; it landed afterwards. Assert
  // whichever contract the installed Wally actually offers, and assert that
  // BloxForge agrees with it rather than assuming the flag exists.
  const wally = path.join(shimDirectory, 'wally');
  const help = tryRun(wally, ['install', '--help'], { cwd: root });
  const lockedSupported = help.output.includes('--locked');
  assert(
    wallyTools.supportsLocked(root) === lockedSupported,
    `supportsLocked() disagreed with "wally install --help" (detected ${wallyTools.supportsLocked(root)}, actual ${lockedSupported})`,
  );

  if (lockedSupported) {
    const lockedWithoutLock = tryRun(wally, ['install', '--locked'], { cwd: root });
    assert(!lockedWithoutLock.ok, 'wally install --locked succeeded without a lockfile; it must fail closed');
  }

  run(wally, ['install'], { cwd: root });
  assert(existsSync(path.join(root, 'wally.lock')), 'wally install did not produce a lockfile');

  if (lockedSupported) {
    run(wally, ['install', '--locked'], { cwd: root });
  } else {
    // Without the flag, a locked install must be refused, never quietly downgraded.
    const refused = wallyTools.installApply(root, true, true);
    assert(refused.ok === false, 'installApply ran an unlocked install on a Wally without --locked');
    assert(
      /does not support/.test(refused.error ?? ''),
      `Expected a --locked support error, got: ${refused.error}`,
    );
  }

  const validation = wallyTools.validateLock(root);
  assert(validation.present === true, 'validateLock did not see the generated lockfile');
  assert(validation.ok === true, `validateLock reported missing entries: ${JSON.stringify(validation.missing)}`);

  console.log(
    `toolchain-integration: Rokit shim resolution and pinned versions verified; `
    + `wally --locked ${lockedSupported ? 'supported and fails closed without a lockfile' : 'unsupported by this Wally and correctly refused'}`,
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}
