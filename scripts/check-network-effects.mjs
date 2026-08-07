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

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// The modules in packages/core that actually open a socket, by the identifier a
// tool method uses to reach them. Add here when a new network client appears.
const NETWORK_CLIENTS = /\b(imageClient|marketplace|cookieClient|openCloudClient|getRobloxDoc|fetchRobloxDoc)\b/;

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

/** `async name(...) { ... }` bodies, by brace matching past the signature. */
function methodBodies(src) {
  const out = new Map();
  const re = /^\s{2}(?:private\s+)?async\s+([A-Za-z_]\w*)\s*\(/gm;
  let m;
  while ((m = re.exec(src))) {
    // Close the parameter list first: a signature can hold `{ ... }` object
    // types, and jumping to the next `{` would land inside one and cut the
    // body short — which silently hid design_review from an earlier draft.
    let depth = 0;
    let i = m.index + m[0].length - 1;
    for (; i < src.length; i++) {
      if (src[i] === '(') depth++;
      else if (src[i] === ')') { depth--; if (depth === 0) break; }
    }
    const start = src.indexOf('{', i);
    if (start < 0) continue;
    depth = 0;
    let j = start;
    for (; j < src.length; j++) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}') { depth--; if (depth === 0) break; }
    }
    const body = src.slice(start, j + 1);
    // A method can appear in both facades; either mentioning the network counts.
    if (!out.has(m[1]) || NETWORK_CLIENTS.test(body)) out.set(m[1], body);
  }
  return out;
}

const networkMethods = new Set();
for (const file of FACADES) {
  for (const [name, body] of methodBodies(readFileSync(resolve(root, file), 'utf8'))) {
    if (NETWORK_CLIENTS.test(body)) networkMethods.add(name);
  }
}

// toolName -> facade method, from the dispatch table both transports share and
// from the registries that use `asTools(runtime).method(...)`.
const dispatch = new Map();
for (const file of [
  'packages/core/src/http-server.ts',
  'packages/core/src/tools/rojo-registry.ts',
  'packages/core/src/tools/toolchain-registry.ts',
  'packages/core/src/tools/setup-registry.ts',
  'packages/core/src/tools/discovery-tools.ts',
]) {
  let src;
  try { src = readFileSync(resolve(root, file), 'utf8'); } catch { continue; }
  for (const m of src.matchAll(/^\s*([a-z][a-z0-9_]*)\s*:\s*\((?:tools|runtime)[^)]*\)\s*=>\s*(?:asTools\(runtime\)|tools)\.([A-Za-z_]\w*)\s*\(/gm)) {
    dispatch.set(m[1], m[2]);
  }
  for (const m of src.matchAll(/name:\s*'([a-z][a-z0-9_]*)'[\s\S]{0,2000}?asTools\(runtime\)\.([A-Za-z_]\w*)\s*\(/g)) {
    if (!dispatch.has(m[1])) dispatch.set(m[1], m[2]);
  }
}

// Effects are read from source, not from `packages/core/dist`: this runs inside
// `protocol:check`, which is the first step of `release:check` and therefore
// runs before any build. Reading dist here would compare against whatever was
// built last — the same stale-build trap `docs:generate` already documents.
const DEFINITION_FILES = [
  'packages/core/src/tools/definitions/assets.ts',
  'packages/core/src/tools/definitions/browsing.ts',
  'packages/core/src/tools/definitions/builds.ts',
  'packages/core/src/tools/definitions/generated.ts',
  'packages/core/src/tools/definitions/meta.ts',
  'packages/core/src/tools/definitions/mutation.ts',
  'packages/core/src/tools/definitions/runtime.ts',
  'packages/core/src/tools/definitions/scene.ts',
  'packages/core/src/tools/definitions/scripting.ts',
  'packages/core/src/tools/rojo-registry.ts',
  'packages/core/src/tools/toolchain-registry.ts',
  'packages/core/src/tools/setup-registry.ts',
  'packages/core/src/tools/discovery-tools.ts',
];

const TOOL_DEFINITIONS = [];
for (const file of DEFINITION_FILES) {
  let src;
  try { src = readFileSync(resolve(root, file), 'utf8'); } catch { continue; }
  // No character window between `name:` and `effects:` — just a refusal to
  // cross into the next tool. A fixed window silently dropped design_review the
  // moment a comment was added above its effects, and a check that quietly
  // stops checking is worse than no check.
  for (const m of src.matchAll(
    /name:\s*'([a-z][a-z0-9_]*)',((?:(?!\bname:\s*')[\s\S])*?)effects:\s*\[([^\]]*)\]/g,
  )) {
    TOOL_DEFINITIONS.push({
      name: m[1],
      effects: [...m[3].matchAll(/'([^']+)'/g)].map((e) => e[1]),
    });
  }
}
if (TOOL_DEFINITIONS.length === 0) {
  console.error('network-effects: parsed no tool definitions — the source shape changed.');
  process.exit(1);
}

const effectsByTool = new Map(TOOL_DEFINITIONS.map((t) => [t.name, t.effects]));

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

if (failures.length > 0) {
  console.error('network-effects: a tool that reaches the network must declare it.\n');
  console.error("  effects: ['studio.read', 'network.external']\n");
  for (const f of failures) console.error(`  ✗ ${f}`);
  console.error(
    `\n${failures.length} of ${checked} network-reaching tools under-declare their effects.\n` +
    'Under-declaring hides the tool from the capability gate: `network.external` maps to\n' +
    'the `assets.external` capability, which is what a local-only user withholds.',
  );
  process.exit(1);
}

console.log(`network-effects: ${checked} network-reaching tools declare network.external.`);
