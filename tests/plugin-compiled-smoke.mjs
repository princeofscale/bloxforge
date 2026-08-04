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
    label: 'HTTP polling remains the active compatibility transport',
    test: (src) =>
      src.includes('pollForRequests(idx)') &&
      !src.includes('CreateWebStreamClient') &&
      !src.includes('startRequestStream'),
  },
  {
    file: 'Communication.luau',
    label: 'response serialization and delivery failures remain observable',
    test: (src) =>
      src.includes('Plugin response serialization failed') &&
      src.includes('Failed to deliver response') &&
      src.includes('pluginSessionId = pluginSessionId'),
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
    label: 'stale authentication recovers and disconnect is authenticated',
    test: (src) =>
      src.includes('result.StatusCode == 401') &&
      src.includes('conn.sessionToken = nil') &&
      src.includes('headers.Authorization') &&
      src.includes('/disconnect'),
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
    file: 'PluginRoutes.luau',
    label: 'bounded managed-script reads are routed without arbitrary Luau execution',
    test: (src) => src.includes('/api/read-managed-scripts') && src.includes('readManagedScripts'),
  },
  {
    file: 'Communication.luau',
    label: 'inspector rejects endpoints outside its read-only allowlist',
    test: (src) =>
      src.includes('inspectorAllowedEndpoints') &&
      src.includes('BloxForge Inspector is read-only and rejected endpoint'),
  },
  {
    file: 'handlers/ScriptHandlers.luau',
    label: 'managed-script reads retain pagination, hash, and source-byte limits',
    test: (src) =>
      src.includes('continuationToken') &&
      src.includes('sourceHash') &&
      src.includes('maxSourceBytes') &&
      src.includes('managedScriptSnapshots') &&
      src.includes('MAX_MANAGED_SCRIPTS'),
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
  {
    // getInstanceByPath calls path.gsub, which throws on a non-string entry.
    // Thrown from inside the delete loop it would escape before finishRecording,
    // leaving the change-history recording open and the batch half-applied.
    file: 'handlers/InstanceHandlers.luau',
    label: 'mass delete validates paths before opening a recording, and resolves inside pcall',
    test: (src) => {
      const fn = src.slice(src.indexOf('function massDeleteObjects'));
      const body = fn.slice(0, fn.indexOf('\nend\n') + 5);
      const validateAt = body.indexOf('must be a non-empty instance path string');
      const recordAt = body.indexOf('beginRecording');
      return validateAt > -1 && recordAt > -1 && validateAt < recordAt
        && body.includes('pcall(function()') && /getInstanceByPath/.test(body);
    },
  },
  {
    // delete_object wrapped Destroy() in a ChangeHistoryService recording, but
    // Destroy() tears the instance down irreversibly — so `undo` reported success
    // while the object stayed gone. Unparenting is what Studio's own Delete does
    // and it restores cleanly. Verified live: unparent undoes, Destroy does not.
    file: 'handlers/InstanceHandlers.luau',
    label: 'deletes unparent (undoable) instead of Destroy()',
    test: (src) =>
      src.includes('function removeInstance') &&
      /function removeInstance\([^)]*\)\s*\n\s*\w+\.Parent = nil/.test(src) &&
      !/\bfunction deleteObject\b[\s\S]{0,400}?:Destroy\(\)/.test(src),
  },
  {
    // smart_duplicate assigned variation values raw inside a discarded pcall, so
    // the documented [255, 0, 0] / {x,y,z} forms never converted and the tool
    // reported "succeeded: 2, failed: 0" with nothing applied.
    file: 'handlers/InstanceHandlers.luau',
    label: 'smart_duplicate converts property variations and reports the ones that fail',
    test: (src) =>
      src.includes('applyProperties(clone, variation)') &&
      src.includes('variationErrors') &&
      src.includes('row.propertyErrors = variationErrors'),
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
