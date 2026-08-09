#!/usr/bin/env node
// A tool that drives a mutating bridge endpoint must declare a Studio write.
//
// `protocol-endpoints.json` already classifies every plugin endpoint as `read`
// or `mutation`, and the plugin enforces that classification: the inspector
// build is only ever handed the read set. Nothing checked the other side of it.
// A tool could call `/api/set-property` while declaring `effects: ['studio.read']`,
// which resolves to the `read.scene` capability — so a client granted nothing
// but scene reads would still be able to change the user's place. That is
// invariant 1's named failure, under-declaration, in the direction the
// capability gate cannot see.
//
// This is the sibling of `check-network-effects.mjs`: same source parsing, same
// tool -> facade method dispatch, different primitive. Where that one asks
// "does this reach a socket", this one asks "which bridge endpoints does this
// reach", and compares the answer to the manifest's own classification.
//
// The call graph is class-aware. Keying methods by bare name merges
// `SceneReadTools.getFileTree` with `ScriptTools.setScriptSource` wherever two
// classes share a helper name, and a first draft of this check concluded that
// `get_file_tree` reaches `/api/set-script-source` — 44 false positives, which
// is a check nobody would keep.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classMethodBodies, loadBridgeEndpoints, loadDispatch, loadEffects } from './lib/tool-source.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(root, 'packages/core/src');

const ENDPOINT = /'(\/api\/[a-z0-9-]+)'/g;

// Effects that grant the capability to change the place. `studio.write` is the
// general one; `studio.execute` and `playtest.control` are narrower grants that
// also legitimately drive mutation endpoints (`/api/execute-luau`,
// `/api/start-playtest`).
const WRITE_EFFECTS = ['studio.write', 'studio.execute', 'playtest.control'];

// tool -> why it reaches a mutation endpoint without declaring a write effect.
// An entry here is a claim that the call cannot change the user's place.
const ALLOWED_MUTATION = {
  // Cancels a job this same tool started. It ends work rather than doing any,
  // and the capability that started the job is the one that mattered.
  cancel_job: 'only cancels a job the caller already started',
};

function sourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__') out.push(...sourceFiles(full));
    } else if (entry.name.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

const files = sourceFiles(SRC);

/** `Class.method` -> body, plus `Class` -> field name -> field class. */
const bodies = new Map();
const fieldsByClass = new Map();
for (const file of files) {
  for (const [cls, { methods, fields }] of classMethodBodies(readFileSync(file, 'utf8'))) {
    for (const [name, body] of methods) bodies.set(`${cls}.${name}`, body);
    fieldsByClass.set(cls, fields);
  }
}
if (bodies.size === 0) {
  console.error('endpoint-effects: parsed no class methods — the source shape changed.');
  process.exit(1);
}

/** Endpoints named directly in each method body. */
const reach = new Map();
for (const [key, body] of bodies) {
  const found = new Set([...body.matchAll(ENDPOINT)].map((m) => m[1]));
  if (found.size > 0) reach.set(key, found);
}

// Propagate through calls to a fixed point. `this.x(...)` stays in the class;
// `this.field.x(...)` resolves `field` to its declared class first, and an
// unresolvable field is left alone rather than guessed at — a wrong edge is
// how the name-keyed draft produced its false positives.
for (let changed = true; changed;) {
  changed = false;
  for (const [key, body] of bodies) {
    const cls = key.slice(0, key.lastIndexOf('.'));
    const acc = reach.get(key) ?? new Set();
    const before = acc.size;
    for (const call of body.matchAll(/this\.([A-Za-z_]\w*)(?:\.([A-Za-z_]\w*))?\s*\(/g)) {
      const target = call[2]
        ? (() => {
            const type = fieldsByClass.get(cls)?.get(call[1]);
            return type ? `${type}.${call[2]}` : null;
          })()
        : `${cls}.${call[1]}`;
      if (!target) continue;
      for (const endpoint of reach.get(target) ?? []) acc.add(endpoint);
    }
    if (acc.size > before) { reach.set(key, acc); changed = true; }
  }
}

const manifest = JSON.parse(readFileSync(join(SRC, 'protocol-endpoints.json'), 'utf8'));
const MUTATION = new Set(manifest.mutation);
const READ = new Set(manifest.read);

const dispatch = loadDispatch(root);
const effectsByTool = loadEffects(root);
const declaredEndpoints = loadBridgeEndpoints(root);
if (effectsByTool.size === 0) {
  console.error('endpoint-effects: parsed no tool definitions — the source shape changed.');
  process.exit(1);
}

const failures = [];

// An endpoint string that is in no class of the manifest is either a typo or a
// plugin route nobody classified. Both are silent: the request goes out and the
// plugin answers 404, or worse, answers it outside the read/mutation policy.
const classified = new Set([...MUTATION, ...READ]);
const seen = new Set();
for (const endpoints of reach.values()) for (const e of endpoints) seen.add(e);
for (const endpoint of seen) {
  if (!classified.has(endpoint)) {
    failures.push(`${endpoint} is called but appears in neither the read nor the mutation list of protocol-endpoints.json`);
  }
}

let checked = 0;
for (const [tool, method] of dispatch) {
  const endpoints = reach.get(`RobloxStudioTools.${method}`);
  if (!endpoints) continue;
  const effects = effectsByTool.get(tool);
  // Fail closed on a tool whose effects could not be read. Skipping it would
  // report a clean run while the one tool that mattered went unexamined.
  if (!effects) {
    failures.push(`${tool} -> ${method}() drives bridge endpoints, but its effects could not be parsed`);
    continue;
  }
  checked++;
  const nonRead = [...endpoints].filter((e) => !READ.has(e)).sort();
  const declared = declaredEndpoints.get(tool);

  // A tool whose effects already grant a Studio write is excluded from the
  // inspector by those effects alone, so it owes no endpoint declaration. One
  // that does not has to say which non-read endpoint it drives, because nothing
  // else in the definition distinguishes "reads the place" from "reads the
  // place by running Luau in it".
  if (nonRead.length > 0 && !WRITE_EFFECTS.some((e) => effects.includes(e)) && !ALLOWED_MUTATION[tool]) {
    if (!declared) {
      failures.push(
        `${tool} -> ${method}() calls ${nonRead.join(', ')} but declares [${effects.join(', ')}] ` +
        `and no bridgeEndpoints — add bridgeEndpoints: [${nonRead.map((e) => `'${e}'`).join(', ')}]`,
      );
    }
  }
  if (declared && declared.slice().sort().join(',') !== nonRead.join(',')) {
    failures.push(
      `${tool} declares bridgeEndpoints [${declared.join(', ')}] but ${method}() reaches ` +
      `[${nonRead.join(', ') || 'none outside the read set'}]`,
    );
  }
  const reading = [...endpoints].filter((e) => READ.has(e));
  if (reading.length > 0 && !effects.includes('studio.read')) {
    failures.push(
      `${tool} -> ${method}() calls ${reading.sort().join(', ')} but declares [${effects.join(', ')}] — no studio.read`,
    );
  }
}

if (failures.length > 0) {
  console.error('endpoint-effects: a tool that drives a mutating endpoint must declare a write.\n');
  console.error("  effects: ['studio.read', 'studio.write']\n");
  for (const f of failures.sort()) console.error(`  ✗ ${f}`);
  console.error(
    `\n${failures.length} problem(s) across ${checked} checked bridge-driving tools.\n` +
    'Under-declaring hides the tool from the capability gate: a tool that declares only\n' +
    '`studio.read` is reachable by a client granted nothing but `read.scene`.',
  );
  process.exit(1);
}

console.log(`endpoint-effects: ${checked} bridge-driving tools agree with protocol-endpoints.json.`);
