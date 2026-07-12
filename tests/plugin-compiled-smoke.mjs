#!/usr/bin/env node
// Smoke-checks the COMPILED plugin Luau (studio-plugin/out/) after `rbxtsc`.
//
// The plugin compiles TS -> Luau via roblox-ts; the output is gitignored build
// artefact, so a compile that silently drops or mis-emits code is only caught
// at runtime inside Studio. This script asserts a small set of invariants on
// the compiled output so regressions surface in CI / locally right after build,
// without needing a Roblox Studio runtime (or Lune) to execute the Luau.
//
// Run: node tests/plugin-compiled-smoke.mjs   (after `npm run compile:plugin`)
// Exits non-zero on any failed assertion.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const OUT_DIR = join(process.cwd(), 'studio-plugin', 'out', 'modules');
const ASSERTIONS = [
  {
    file: 'LuauExec.luau',
    label: 'fresh_require helper is emitted',
    test: (src) => src.includes('_G.fresh_require') && src.includes('fresh_require'),
  },
  {
    file: 'LuauExec.luau',
    label: 'WRAPPER_LINE_OFFSET is computed dynamically (no hand-maintained literal)',
    test: (src) =>
      src.includes('computeWrapperLineOffset') &&
      src.includes('WRAPPER_LINE_OFFSET = computeWrapperLineOffset()') &&
      !/\blocal WRAPPER_LINE_OFFSET = \d+\b/.test(src),
  },
  {
    file: 'LuauExec.luau',
    label: 'renderWrapper template is present (single source of the wrapper text)',
    test: (src) => src.includes('function renderWrapper'),
  },
  {
    file: 'LuauExec.luau',
    label: 'fresh_require clone is parented to Workspace and Destroy()ed',
    test: (src) =>
      src.includes('__MCP_fresh_require_clone') &&
      src.includes(':Destroy()'),
  },
  {
    file: 'LuauExec.luau',
    label: 'invalid UTF-8 output is rejected before bridge serialization',
    test: (src) => src.includes('utf8.len') && src.includes('invalid UTF-8 omitted'),
  },
  {
    file: 'Communication.luau',
    label: 'recovery re-ready on failing->ok transition (wasFailing)',
    test: (src) => src.includes('wasFailing') && src.includes('knownInstance'),
  },
  {
    file: 'Communication.luau',
    label: 'WebSocket request stream with polling fallback is emitted',
    test: (src) =>
      src.includes('CreateWebStreamClient(Enum.WebStreamClientType.WebSocket') &&
      src.includes('startRequestStream') &&
      src.includes('if not conn.streamOpen then'),
  },
  {
    file: 'handlers/CaptureHandlers.luau',
    label: 'temporary camera framing restores CameraType and CFrame',
    test: (src) => src.includes('CFrame.lookAt') && src.includes('priorType') && src.includes('priorCFrame'),
  },
];

let failures = 0;
for (const a of ASSERTIONS) {
  const path = join(OUT_DIR, a.file);
  if (!existsSync(path)) {
    console.error(`  ✗ ${a.file}: file missing (did you run compile:plugin?) — ${a.label}`);
    failures++;
    continue;
  }
  const src = readFileSync(path, 'utf8');
  const ok = a.test(src);
  console.error(`${ok ? '  ✓' : '  ✗'} ${a.file}: ${a.label}`);
  if (!ok) failures++;
}

if (failures > 0) {
  console.error(`\nplugin-compiled-smoke: ${failures} assertion(s) failed.`);
  process.exit(1);
}
console.error('\nplugin-compiled-smoke: all assertions passed.');
