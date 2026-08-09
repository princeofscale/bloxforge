#!/usr/bin/env node
// Runs the Luau this server generates under Lune, against a real DataModel.
//
// Generated Luau is where the read tools actually compute their answers, and
// none of it is reachable from Jest. Calling the builders here and running
// their output keeps the test and the thing under test the same artefact: it
// cannot drift from the builder by copying it.
//
// Only builders whose Luau Lune can execute are listed. Lune reads properties
// from rbx-dom, which has no value for a property that was never assigned and
// has no default, so `game.PlaceId` (world snapshot) and `Script.Enabled`
// (sanitize scan) cannot run here. That is a limitation of the host, not a
// defect in those builders.

import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const builders = path.join(repoRoot, 'packages/core/dist/builders');

const load = async (file) => {
  try {
    return await import(path.join(builders, file));
  } catch {
    console.error(`${file} not built. Run \`npm run build -w packages/core\` first.`);
    process.exit(1);
  }
};

const { buildSpatialLayoutLuau } = await load('scene-layout.js');
const { buildNodeBatchLuau } = await load('world-model.js');
const { buildSceneSearchLuau } = await load('scene-search.js');
const { buildWorldFingerprintLuau } = await load('world-fingerprint.js');
const { buildFitScanLuau } = await load('asset-fit.js');
const { buildDesignLintLuau } = await load('design-builders.js');

// Names are what the Luau side asserts on; keep them in step.
const generated = {
  'spatial-layout': buildSpatialLayoutLuau('game.Workspace', 16, 10),
  'node-batch': buildNodeBatchLuau(
    ['game.Workspace.Ground', 'game.Workspace.Nope'],
    ['Anchored'],
    true,
  ),
  'scene-search': buildSceneSearchLuau('ground', 'game.Workspace', 10),
  'world-fingerprint': buildWorldFingerprintLuau('game.Workspace'),
  'fit-scan': buildFitScanLuau('game.Workspace.Nope'),
  // design_lint's contrast rule is arithmetic over composited colours, which is
  // exactly the kind of thing that looks right in a diff and is wrong on a
  // screen. Jest can only assert the emitted text contains a rule name.
  'design-lint': buildDesignLintLuau({ rootPath: 'StarterGui.Menu' }),
};

const dir = await mkdtemp(path.join(tmpdir(), 'bloxforge-luau-'));
try {
  for (const [name, code] of Object.entries(generated)) {
    await writeFile(path.join(dir, `${name}.luau`), code, 'utf8');
  }
  const result = spawnSync(
    process.execPath,
    [
      path.join(repoRoot, 'scripts/run-lune.mjs'),
      'run',
      path.join(repoRoot, 'tests/generated-luau-runtime.luau'),
      dir,
    ],
    { stdio: 'inherit', cwd: repoRoot },
  );
  process.exit(result.status ?? 1);
} finally {
  await rm(dir, { recursive: true, force: true });
}
