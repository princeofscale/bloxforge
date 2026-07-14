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
    label: 'wrapper helpers initialize before WRAPPER_LINE_OFFSET is computed',
    test: (src) =>
      src.indexOf('function renderWrapper') < src.indexOf('WRAPPER_LINE_OFFSET = computeWrapperLineOffset()'),
  },
  {
    file: 'LuauExec.luau',
    label: 'execute_luau wrapper has balanced IIFE parentheses',
    test: (src) => src.includes('return `return (function()') && !src.includes('return `return ((function()'),
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
      src.includes('CreateWebStreamClient') &&
      src.includes('startRequestStream') &&
      src.includes('if not conn.streamOpen then'),
  },
  {
    file: 'Communication.luau',
    label: 'response serialization and delivery failures remain observable',
    test: (src) =>
      src.includes('Plugin response serialization failed') &&
      src.includes('Failed to deliver response') &&
      src.includes('Failed to send stream response'),
  },
  {
    file: 'Communication.luau',
    label: 'request delivery is acknowledged and completed request ids are cached',
    test: (src) =>
      src.includes('handleRequestOnce') &&
      src.includes('activeRequests') &&
      src.includes('completedRequests') &&
      src.includes('/ack'),
  },
  {
    file: 'Communication.luau',
    label: 'plugin session token is propagated after ready bootstrap',
    test: (src) =>
      src.includes('sessionToken') &&
      src.includes('Authorization') &&
      src.includes('pluginSessionId'),
  },
  {
    file: 'Communication.luau',
    label: 'protocol v3 delivery fences propagate through ack and response frames',
    test: (src) =>
      src.includes('serverEpoch') &&
      src.includes('deliveryAttempt') &&
      src.includes('leaseToken'),
  },
  {
    file: 'RuntimeLogBuffer.luau',
    label: 'malformed UTF-8 log bytes are escaped and oversized results are dropped',
    test: (src) =>
      src.includes('escapeInvalidUtf8') &&
      src.includes('string.format("\\\\x%02X"') &&
      src.includes('if bytes > MAX_BYTES then'),
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
