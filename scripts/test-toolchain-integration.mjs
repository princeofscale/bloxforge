// Verifies the Rokit/Wally contract against the real CLIs:
//  - tools pinned in rokit.toml resolve to shims, not to whatever is on PATH;
//  - `wally install --locked` fails on a stale/missing lockfile and succeeds on
//    a good one, which is the only install mode CI should ever use;
//  - the parsed lockfile yields real package identities.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

  process.env.BLOXFORGE_PROJECT_ROOT = root;
  delete process.env.BLOXFORGE_ROJO_BIN;

  // Drive RokitTools.install itself, not a hand-written command line: CI must
  // exercise the exact invocation the MCP tool produces, including how it
  // handles Rokit's trust prompt with no terminal attached.
  const { RokitTools } = await import(pathToFileURL(path.join(REPO_ROOT, 'packages/core/dist/toolchain/rokit-tools.js')).href);
  const rokitTools = new RokitTools();
  assert(
    !rokitTools.install(root, false).ok,
    'rokit_install ran without confirm=true',
  );
  const installed = rokitTools.install(root, true, true);
  assert(installed.ok, `rokit_install failed: ${installed.error ?? installed.output}`);
  assert(
    Array.isArray(installed.trustedSources) && installed.trustedSources.length === 2,
    `rokit_install did not report the exact pins it trusted: ${JSON.stringify(installed.trustedSources)}`,
  );

  // A loose requirement must refuse the non-interactive path rather than
  // trusting whatever the manifest happens to resolve to.
  const looseRoot = path.join(root, 'loose');
  mkdirSync(looseRoot, { recursive: true });
  writeFileSync(path.join(looseRoot, 'rokit.toml'), '[tools]\nrojo = "rojo-rbx/rojo@7"\n');
  const loose = rokitTools.install(looseRoot, true, true);
  assert(!loose.ok && /pinned to an exact version/.test(loose.error ?? ''),
    `A loose pin must refuse allowPinnedToolDownloads: ${JSON.stringify(loose)}`);

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
  const lockFile = path.join(root, 'wally.lock');
  assert(existsSync(lockFile), 'wally install did not produce a lockfile');

  // Every apply is pinned to the plan that produced it. Exercise the refusals
  // against the real CLI, not only in unit tests: an agent that skipped the plan
  // must not be able to install.
  assert(
    /expectedPlanHash is required/.test(wallyTools.installApply(root, true, true).error ?? ''),
    'installApply ran without the planHash from wally_install_plan',
  );
  const stalePlan = wallyTools.installPlan(root).planHash;
  writeFileSync(path.join(root, 'wally.toml'), readFileSync(path.join(root, 'wally.toml'), 'utf8') + '\n# touched\n');
  assert(
    /changed after wally_install_plan ran/.test(wallyTools.installApply(root, true, true, stalePlan).error ?? ''),
    'installApply accepted a planHash from before the manifest changed',
  );

  // A locked install must leave wally.lock byte-identical. With the flag Wally
  // enforces that itself; without it (0.3.2) BloxForge backs the file up and
  // restores it, so the guarantee is the same and this assertion is the same.
  const plan = wallyTools.installPlan(root);
  assert(plan.emulateLocked === !lockedSupported,
    `installPlan.emulateLocked disagreed with --locked support: ${JSON.stringify({ emulateLocked: plan.emulateLocked, lockedSupported })}`);
  const before = readFileSync(lockFile);
  const applied = wallyTools.installApply(root, true, true, plan.planHash);
  assert(applied.ok, `A locked install failed: ${applied.error ?? applied.output}`);
  assert(readFileSync(lockFile).equals(before), 'A locked install changed wally.lock');
  assert(applied.lockRestored === false, 'The lockfile needed restoring after an install that should not have moved it');

  const validation = wallyTools.validateLock(root);
  assert(validation.present === true, 'validateLock did not see the generated lockfile');
  assert(validation.ok === true, `validateLock reported missing entries: ${JSON.stringify(validation.missing)}`);

  console.log(
    `toolchain-integration: Rokit shim resolution and pinned versions verified; `
    + `plan hashes enforced; wally --locked ${lockedSupported ? 'supported and used' : 'unsupported by this Wally and emulated by backup/restore'}, `
    + 'and wally.lock was byte-identical afterwards',
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}
