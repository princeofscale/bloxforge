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

const capture = (cmd) => {
  try {
    return execSync(cmd, { cwd: rootDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch {
    return undefined;
  }
};

/**
 * npm versions are immutable, so a rerun after a partial failure used to die on
 * the package that already published instead of finishing the one that did not.
 * Publishing is therefore per package and skipped when the registry already has
 * that exact version.
 */
const publishIfMissing = (workspace, name) => {
  const published = capture(`npm view ${name}@${version} version`);
  if (published === version) {
    console.log(`
${name}@${version} is already on the registry; skipping.`);
    return 'skipped';
  }
  console.log(`
Publishing ${name}@${version} with dist-tag ${npmTag}...`);
  run(`npm publish -w ${workspace} --tag ${npmTag}`);
  // Confirm rather than trust the exit code: a partial upload must not read as
  // success on the next rerun either.
  if (capture(`npm view ${name}@${version} version`) !== version) {
    throw new Error(`${name}@${version} did not appear on the registry after publishing`);
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

const results = [
  ['packages/robloxstudio-mcp', '@princeofscale/bloxforge'],
  ['packages/robloxstudio-mcp-inspector', '@princeofscale/bloxforge-inspector'],
].map(([workspace, name]) => [name, publishIfMissing(workspace, name)]);

for (const [name, outcome] of results) console.log(`  ${name}@${version}: ${outcome}`);
console.log('\nAll packages are on the registry at the released version.');
