#!/usr/bin/env node

import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

const run = (cmd) => {
  console.log(`> ${cmd}`);
  execSync(cmd, { stdio: 'inherit', cwd: rootDir });
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * `npm view` failures are not all the same failure.
 *
 * Swallowing every error into `undefined` meant a network timeout, a 429, an
 * auth error and a registry outage all read as "this version is not published",
 * so a rerun during an outage tried to publish an immutable version again and
 * died. Only a real 404 means absent.
 */
const viewVersion = (name, wanted) => {
  try {
    const out = execSync(`npm view ${name}@${wanted} version`, {
      cwd: rootDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    return { state: out === wanted ? 'present' : 'absent', version: out };
  } catch (error) {
    const text = `${error.stderr ?? ''}${error.stdout ?? ''}`;
    if (/E404|404 Not Found|is not in this registry/i.test(text)) return { state: 'absent' };
    return { state: 'unknown', detail: text.trim().split('\n').slice(-3).join(' ') };
  }
};

/**
 * Retries until `settled` accepts the state. Which states are transient depends
 * on what the caller is asking, and conflating the two broke the v4.0.3 release:
 *
 *  - *Before* publishing, `absent` is a definitive answer — go ahead — so only
 *    `unknown` is worth retrying.
 *  - *After* publishing, `absent` is the expected first answer. A just-published
 *    version takes seconds to become visible to `npm view`, so the wait is for
 *    `present`. With the old predicate the post-publish check returned on its
 *    very first 404 and failed a release whose publish had in fact succeeded.
 */
const SETTLED_UNLESS_UNKNOWN = (state) => state !== 'unknown';
const viewVersionWithRetry = async (name, wanted, attempts = 4, settled = SETTLED_UNLESS_UNKNOWN) => {
  let last = { state: 'unknown' };
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await sleep(2000 * attempt);
    last = viewVersion(name, wanted);
    if (settled(last.state)) return last;
  }
  return last;
};

/**
 * npm versions are immutable, so a rerun after a partial failure used to die on
 * the package that already published instead of finishing the one that did not.
 * Publishing is therefore per package and skipped when the registry already has
 * that exact version.
 */
const publishIfMissing = async (workspace, name) => {
  const before = await viewVersionWithRetry(name, version);
  if (before.state === 'unknown') {
    throw new Error(
      `Cannot tell whether ${name}@${version} is already published; the registry did not answer. `
      + `Refusing to publish blind, because npm versions are immutable. Last error: ${before.detail}`,
    );
  }
  if (before.state === 'present') {
    console.log(`\n${name}@${version} is already on the registry; skipping.`);
    return 'skipped';
  }
  console.log(`\nPublishing ${name}@${version} with dist-tag ${npmTag}...`);
  run(`npm publish -w ${workspace} --tag ${npmTag}`);
  // Confirm rather than trust the exit code: a partial upload must not read as
  // success on the next rerun either. Retry first — a new version can take a
  // few seconds to become visible to `npm view` (registry replication, and
  // publish-time scanning), and failing a release that actually succeeded is
  // the more expensive mistake.
  const after = await viewVersionWithRetry(name, version, 6, (state) => state === 'present');
  if (after.state !== 'present') {
    throw new Error(
      `${name}@${version} did not appear on the registry within 30s of publishing (${after.state}`
      + `${after.detail ? `: ${after.detail}` : ''}). npm publish itself reported success, so the version `
      + 'may well be there — re-run this workflow: an already-published version is skipped, and the '
      + 'remaining packages continue.',
    );
  }
  return 'published';
};

// Read version from root package.json
const rootPkg = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8'));
const version = rootPkg.version;
const npmTag = version.includes('-') ? 'next' : 'latest';

// Sync version across all packages
const packageDirs = [
  'packages/core',
  'packages/robloxstudio-mcp',
  'packages/robloxstudio-mcp-inspector',
];

console.log(`Syncing version ${version} across all packages...`);
for (const dir of packageDirs) {
  const pkgPath = join(rootDir, dir, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  if (pkg.version !== version) {
    console.log(`  ${pkg.name}: ${pkg.version} -> ${version}`);
    pkg.version = version;
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
  } else {
    console.log(`  ${pkg.name}: ${version} (already synced)`);
  }
}

// Sync version in README.md
const readmePath = join(rootDir, 'README.md');
const readme = readFileSync(readmePath, 'utf8');
const updatedReadme = readme.replace(
  /<!-- VERSION_LINE -->\n\*\*v[\d.]+\*\*/,
  `<!-- VERSION_LINE -->\n**v${version}**`
);
if (updatedReadme !== readme) {
  writeFileSync(readmePath, updatedReadme, 'utf8');
  console.log(`  README.md: updated version line to v${version}`);
} else {
  console.log(`  README.md: v${version} (already synced)`);
}

console.log('\nBuilding all packages...');
run('npm run build:all');

const results = [];
for (const [workspace, name] of [
  ['packages/robloxstudio-mcp', '@princeofscale/bloxforge'],
  ['packages/robloxstudio-mcp-inspector', '@princeofscale/bloxforge-inspector'],
]) {
  results.push([name, await publishIfMissing(workspace, name)]);
}

for (const [name, outcome] of results) console.log(`  ${name}@${version}: ${outcome}`);
console.log('\nAll packages are on the registry at the released version.');
