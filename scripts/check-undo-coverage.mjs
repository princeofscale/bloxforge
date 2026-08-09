#!/usr/bin/env node
// Every endpoint declared a mutation must either open a ChangeHistoryService
// recording or be listed below as a deliberate exception. The classification is
// declared, never inferred: a new mutating endpoint that records nothing fails
// this check instead of silently shipping an un-undoable edit.
//
// execute-luau is the interesting case. It carries both writes (recipes,
// terrain, lighting, mutation plans) and reads (world snapshot, fingerprint,
// syntax check), so its recording is keyed on a caller-declared `undoLabel`
// rather than on the endpoint. See MetadataHandlers.executeLuau.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { functionBody } from './lib/tool-source.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// endpoint -> why it legitimately opens no recording.
const NO_RECORDING = {
  '/api/undo': 'drives the undo stack itself',
  '/api/redo': 'drives the undo stack itself',
  // ponytail: async jobs stay unrecorded. A ChangeHistoryService recording held
  // open across a spawned job's yields would block the user's own edits and can
  // be left dangling when the job is cancelled. Upgrade path: have the job
  // record around each resumed slice, or route mutating work to execute-luau.
  '/api/execute-luau-async': 'a recording cannot safely span an asynchronous job',
  '/api/cancel-job': 'job control, not a DataModel edit',
  '/api/eval-runtime': 'runs on a runtime peer, which has no edit history',
  '/api/start-playtest': 'session control, not a DataModel edit',
  '/api/stop-playtest': 'session control, not a DataModel edit',
  '/api/multiplayer-test-start': 'session control, not a DataModel edit',
  '/api/multiplayer-test-add-players': 'session control, not a DataModel edit',
  '/api/multiplayer-test-leave-client': 'session control, not a DataModel edit',
  '/api/multiplayer-test-end': 'session control, not a DataModel edit',
  '/api/character-navigation': 'moves a character during playtest',
  '/api/simulate-mouse-input': 'runtime input, not a DataModel edit',
  '/api/simulate-keyboard-input': 'runtime input, not a DataModel edit',
  '/api/breakpoints': 'debugger state, not a DataModel edit',
};

const endpoints = JSON.parse(readFileSync(`${root}/packages/core/src/protocol-endpoints.json`, 'utf8'));
const routes = readFileSync(`${root}/studio-plugin/src/modules/PluginRoutes.ts`, 'utf8');

const handlerOf = new Map();
for (const m of routes.matchAll(/"([^"]+)":\s*(\w+)\.(\w+)/g)) handlerOf.set(m[1], { mod: m[2], fn: m[3] });

// One hop into same-module helpers: smartDuplicate delegates its recording to
// performSmartDuplicate, and a body-only check would misread that as a gap.
function records(source, body, depth) {
  if (body === undefined) return false;
  if (body.includes('beginRecording')) return true;
  if (depth === 0) return false;
  for (const call of body.matchAll(/\b([a-z]\w+)\s*\(/g)) {
    if (records(source, functionBody(source, call[1]), depth - 1)) return true;
  }
  return false;
}

const problems = [];

// An excuse outlives the endpoint it excused. Nothing below walks NO_RECORDING,
// so an entry whose endpoint has been renamed or reclassified sits there reading
// like deliberate policy, and the next endpoint to take that path inherits it.
const mutation = new Set(endpoints.mutation);
for (const endpoint of Object.keys(NO_RECORDING)) {
  if (!mutation.has(endpoint)) {
    problems.push(`${endpoint}: in NO_RECORDING but not declared a mutation — remove the stale exception.`);
  }
}

for (const endpoint of endpoints.mutation) {
  const handler = handlerOf.get(endpoint);
  if (!handler) {
    problems.push(`${endpoint}: declared a mutation but PluginRoutes has no handler for it`);
    continue;
  }
  let source;
  try {
    source = readFileSync(`${root}/studio-plugin/src/modules/handlers/${handler.mod}.ts`, 'utf8');
  } catch {
    problems.push(`${endpoint}: handler module ${handler.mod} not found`);
    continue;
  }
  const recorded = records(source, functionBody(source, handler.fn), 2);
  const excused = Object.hasOwn(NO_RECORDING, endpoint);
  if (!recorded && !excused) {
    problems.push(
      `${endpoint} (${handler.mod}.${handler.fn}): mutates without a ChangeHistoryService recording. ` +
      'Wrap it in beginRecording/finishRecording, or add it to NO_RECORDING with the reason.',
    );
  }
  if (recorded && excused) {
    problems.push(`${endpoint}: listed in NO_RECORDING but does record — remove the exception.`);
  }
}

if (problems.length > 0) {
  for (const problem of problems) console.error(`  ✗ ${problem}`);
  console.error(`\nundo-coverage: ${problems.length} problem(s).`);
  process.exit(1);
}

const recorded = endpoints.mutation.length - Object.keys(NO_RECORDING).length;
console.log(`undo-coverage: ${recorded}/${endpoints.mutation.length} mutation endpoints record an undo waypoint; ` +
  `${Object.keys(NO_RECORDING).length} declared exceptions.`);
