#!/usr/bin/env node
// Generates the Luau that get_spatial_layout emits and runs it under Lune
// against a real DataModel. Keeps the generated code and the thing under test
// the same artefact: the test cannot drift from the builder by copying it.

import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const { buildSpatialLayoutLuau } = await import(
  path.join(repoRoot, 'packages/core/dist/builders/scene-layout.js')
).catch(() => {
  console.error('scene-layout builder not built. Run `npm run build -w packages/core` first.');
  process.exit(1);
});

const dir = await mkdtemp(path.join(tmpdir(), 'bloxforge-layout-'));
const codePath = path.join(dir, 'generated.luau');
try {
  await writeFile(codePath, buildSpatialLayoutLuau('game.Workspace', 16, 10), 'utf8');
  const result = spawnSync(
    process.execPath,
    [path.join(repoRoot, 'scripts/run-lune.mjs'), 'run', path.join(repoRoot, 'tests/scene-layout-runtime.luau'), codePath],
    { stdio: 'inherit', cwd: repoRoot },
  );
  process.exit(result.status ?? 1);
} finally {
  await rm(dir, { recursive: true, force: true });
}
