#!/usr/bin/env node
// A tool whose handler reaches a network client must declare `network.external`.
//
// Invariant 1 says effects are declared, never inferred — and the failure it
// warns about is under-declaration. Two tools were under-declared exactly that
// way: `design_review` screenshots the user's place and uploads it to
// Pollinations for a critique, and `get_roblox_docs` fetches from Roblox's
// documentation host. Both declared only `studio.read`, which resolves to the
// `read.scene` capability — so a client granted nothing but the narrowest read
// could still send a picture of the user's place to a third party.
//
// The check is textual on purpose: it maps each tool to the facade method its
// handler calls, and fails if that method body mentions a network client while
// the tool's effects do not say so. Declared exceptions go in ALLOWED below.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { methodBodies, loadDispatch, loadEffects } from './lib/tool-source.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// The modules in packages/core that actually open a socket, by the identifier a
// tool method uses to reach them. Add here when a new network client appears.
//
// `fetch` is on the list because three methods — importExternalAsset,
// importRbxm and the universeIdForPlace helper — call it directly rather than
// through a client module. All three declared `network.external` already, so
// nothing was mis-declared, but they were not being *checked*: the audit
// reported "12 network-reaching tools" while two of the tools that most
// obviously reach the network went unexamined. A check that under-counts its
// own coverage is the failure this file exists to prevent.
const NETWORK_CLIENTS = /\b(imageClient|marketplace|cookieClient|openCloudClient|getRobloxDoc|fetchRobloxDoc|fetch)\s*[.(]/;

// tool -> why it names a network client but legitimately declares no network
// effect. Keep this short; an entry here is a claim that no socket is opened.
const ALLOWED = {
  // Reads connection bookkeeping for managed Studio instances. The identifier
  // match is `openCloudClient.hasApiKey()`, a local capability probe.
  manage_instance: 'only probes whether an Open Cloud key is configured',
};

const FACADES = [
  'packages/core/src/tools/index.ts',
  'packages/core/src/tools/asset-tools.ts',
];

const allMethods = new Map();
for (const file of FACADES) {
  for (const [name, bodies] of methodBodies(readFileSync(resolve(root, file), 'utf8'))) {
    // A method can appear in both facades; either mentioning the network counts.
    const body = bodies.join('\n');
    if (!allMethods.has(name) || NETWORK_CLIENTS.test(body)) allMethods.set(name, body);
  }
}

const networkMethods = new Set(
  [...allMethods].filter(([, body]) => NETWORK_CLIENTS.test(body)).map(([name]) => name),
);

// One text match per method proves nothing about a method that delegates: a
// handler whose body is `return this.uploadAsset(...)` mentions no client at
// all. Propagate through `this.x()` to a fixed point, which is what
// importExternalAsset -> uploadAsset already looks like. Conservative in the
// safe direction: an extra method marked network-reaching costs a declared
// effect, a missed one costs the capability gate.
for (let changed = true; changed; ) {
  changed = false;
  for (const [name, body] of allMethods) {
    if (networkMethods.has(name)) continue;
    for (const call of body.matchAll(/this\.([A-Za-z_]\w*)\s*\(/g)) {
      if (networkMethods.has(call[1])) { networkMethods.add(name); changed = true; break; }
    }
  }
}

// toolName -> facade method, from the dispatch table both transports share and
// from the registries that use `asTools(runtime).method(...)`.
const dispatch = loadDispatch(root);

// Effects are read from source, not from `packages/core/dist`: this runs inside
// `protocol:check`, which is the first step of `release:check` and therefore
// runs before any build. Reading dist here would compare against whatever was
// built last — the same stale-build trap `docs:generate` already documents.
const effectsByTool = loadEffects(root);
if (effectsByTool.size === 0) {
  console.error('network-effects: parsed no tool definitions — the source shape changed.');
  process.exit(1);
}

const failures = [];
let checked = 0;
for (const [toolName, method] of dispatch) {
  if (!networkMethods.has(method)) continue;
  const effects = effectsByTool.get(toolName);
  // Fail closed on a tool we could not read effects for. Skipping it would
  // report a clean run while the one tool that mattered went unexamined.
  if (!effects) {
    failures.push(`${toolName} -> ${method}() reaches a network client, but its effects could not be parsed`);
    continue;
  }
  checked++;
  if (ALLOWED[toolName]) continue;
  if (!effects.includes('network.external')) {
    failures.push(`${toolName} -> ${method}() reaches a network client but declares [${effects.join(', ')}]`);
  }
}

// The loop above can only judge a tool it found. Five tools in rojo-registry.ts
// are generated by `.map()` with a template-literal name — `rojo_serve_${op}` —
// so neither the dispatch regex nor the effects regex sees them at all, and a
// tool the check never enumerates cannot fail it. Their effects happen to be
// local, so nothing is wrong today; the hole is that a templated tool reaching
// the network would be invisible for the same reason.
//
// Rather than teach two regexes to evaluate template literals, close it from
// the other end: every method that reaches the network must be the target of
// some tool's dispatch entry. A templated tool calling out would leave its
// method unclaimed here.
const HELPERS = {
  universeIdForPlace: 'private helper; its callers are the tools that declare the effect',
  // image_generate and image_generate_and_upload both declare network.external.
  // It only became visible to this check once the signature parser learned to
  // step over a return type annotation: `Promise<{ file: string; ... }>` had
  // been handed back as the entire method body.
  _generateImageToFile: 'private helper; its callers are the tools that declare the effect',
};
const claimed = new Set(dispatch.values());
for (const method of networkMethods) {
  if (claimed.has(method) || HELPERS[method]) continue;
  failures.push(
    `${method}() reaches a network client but no tool dispatches to it — a definition this ` +
    'check cannot enumerate (a template-literal name, a new registry) would look exactly like this',
  );
}

if (failures.length > 0) {
  console.error('network-effects: a tool that reaches the network must declare it.\n');
  console.error("  effects: ['studio.read', 'network.external']\n");
  for (const f of failures) console.error(`  ✗ ${f}`);
  console.error(
    `\n${failures.length} problem(s) across ${checked} checked network-reaching tools.\n` +
    'Under-declaring hides the tool from the capability gate: `network.external` maps to\n' +
    'the `assets.external` capability, which is what a local-only user withholds.',
  );
  process.exit(1);
}

console.log(`network-effects: ${checked} network-reaching tools declare network.external.`);
