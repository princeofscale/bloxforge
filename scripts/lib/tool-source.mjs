// Shared source parsing for the effect-conformance checks.
//
// Both `check-network-effects.mjs` and `check-endpoint-effects.mjs` need the
// same three answers out of the TypeScript source: what a method's body is,
// which facade method each tool dispatches to, and what each tool declares.
// They read source rather than `packages/core/dist` on purpose — they run
// inside `protocol:check`, the first step of `release:check`, which is before
// anything is built. Reading dist would compare against whatever was built
// last, the stale-build trap `docs:generate` already documents.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Method bodies in a file, as `Map<name, body[]>`. A name can repeat across
 * classes, so every body is kept; callers that need to tell them apart use
 * {@link classMethodBodies}.
 */
export function methodBodies(src) {
  const out = new Map();
  const re = /^\s{2}(?:private\s+|protected\s+|public\s+)?(?:async\s+)?([A-Za-z_]\w*)\s*\(/gm;
  let m;
  while ((m = re.exec(src))) {
    const body = bodyAt(src, m.index + m[0].length - 1);
    if (body === null) continue;
    if (!out.has(m[1])) out.set(m[1], []);
    out.get(m[1]).push(body);
  }
  return out;
}

/**
 * The `{ ... }` block that follows the parameter list opening at `openParen`,
 * or null if there is none.
 *
 * Two things between the `(` and the body have to be stepped over, and each of
 * them silently truncated a method to nothing when it was missed:
 *
 * - the parameter list, which can hold `{ ... }` object types. Jumping to the
 *   next `{` lands inside one and cuts the body short — that hid `design_review`
 *   from an earlier draft of the network check.
 * - the return type annotation, for the same reason.
 *   `private async _captureFingerprint(...): Promise<{ fp: Fingerprint; ... }>`
 *   handed back the object type as the whole method body, so the
 *   `/api/execute-luau` call inside it was invisible and `get_changes_since`
 *   passed the endpoint audit by not being examined at all.
 */
function bodyAt(src, openParen) {
  let depth = 0;
  let i = openParen;
  for (; i < src.length; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')') { depth--; if (depth === 0) { i++; break; } }
  }
  i = skipReturnType(src, i);
  while (i < src.length && /\s/.test(src[i])) i++;
  // The body has to open right here. Searching forward for the next `{` instead
  // would give an interface member — `runGeneratedLuau(...): Promise<{...}>;`,
  // of which this codebase has ten — the next unrelated block as its body.
  const start = i;
  if (src[start] !== '{') return null;
  depth = 0;
  for (let j = start; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(start, j + 1); }
  }
  return null;
}

const OPENERS = { '<': '>', '{': '}', '(': ')', '[': ']' };

/** Index of the first character past a `: Type` annotation starting at `from`. */
function skipReturnType(src, from) {
  let i = from;
  while (i < src.length && /\s/.test(src[i])) i++;
  if (src[i] !== ':') return from;
  i++;
  // `{` is an object type where a type is expected and the method body where a
  // complete type has just been read: `(): Promise<{ a: 1 }> {` holds both.
  let expectType = true;
  while (i < src.length) {
    while (i < src.length && /\s/.test(src[i])) i++;
    const c = src[i];
    if (c === undefined) break;
    if (c === '{' && !expectType) break;
    if (OPENERS[c]) {
      i = skipBalanced(src, i);
      expectType = false;
    } else if (/[\w$'".]/.test(c)) {
      while (i < src.length && /[\w$'".]/.test(src[i])) i++;
      expectType = false;
    } else if (c === '|' || c === '&' || c === ',' || c === '?' || c === ':' || c === '=') {
      i++;
      expectType = true;
    } else {
      break;
    }
  }
  return i;
}

function skipBalanced(src, open) {
  const close = OPENERS[src[open]];
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === src[open]) depth++;
    else if (src[i] === close) { depth--; if (depth === 0) return i + 1; }
  }
  return src.length;
}

/**
 * Classes in a file: `Map<className, { methods: Map<name, body>, fields: Map<name, typeName> }>`.
 *
 * Field types come from three shapes that all appear in this codebase:
 * `private x: Foo`, `private x = new Foo(`, and a constructor parameter
 * property `private readonly x: Foo`. Without them `this.sceneReadTools.get()`
 * cannot be told from `this.scriptTools.get()`, and a name-keyed call graph
 * merges the two — which is how a first draft concluded that `get_file_tree`
 * reaches `/api/set-script-source`.
 */
export function classMethodBodies(src) {
  const out = new Map();
  const classRe = /^export\s+(?:abstract\s+)?class\s+([A-Za-z_]\w*)/gm;
  let c;
  while ((c = classRe.exec(src))) {
    const open = src.indexOf('{', c.index);
    if (open < 0) continue;
    let depth = 0;
    let end = src.length;
    for (let j = open; j < src.length; j++) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}') { depth--; if (depth === 0) { end = j + 1; break; } }
    }
    const body = src.slice(open, end);
    const methods = new Map();
    for (const [name, bodies] of methodBodies(body)) methods.set(name, bodies.join('\n'));
    const fields = new Map();
    for (const f of body.matchAll(/^\s+(?:private|protected|public|readonly)[\w\s]*?\s([A-Za-z_]\w*)\s*(?::\s*([A-Za-z_]\w*)|=\s*new\s+([A-Za-z_]\w*))/gm)) {
      fields.set(f[1], f[2] ?? f[3]);
    }
    out.set(c[1], { methods, fields });
  }
  return out;
}

const DISPATCH_FILES = [
  'packages/core/src/http-server.ts',
  'packages/core/src/tools/rojo-registry.ts',
  'packages/core/src/tools/toolchain-registry.ts',
  'packages/core/src/tools/setup-registry.ts',
  'packages/core/src/tools/discovery-tools.ts',
];

/**
 * `Map<toolName, facadeMethod>` from the dispatch table both transports share
 * and from the registries that use `asTools(runtime).method(...)`.
 */
export function loadDispatch(root) {
  const dispatch = new Map();
  for (const file of DISPATCH_FILES) {
    let src;
    try { src = readFileSync(resolve(root, file), 'utf8'); } catch { continue; }
    for (const m of src.matchAll(/^\s*([a-z][a-z0-9_]*)\s*:\s*\((?:tools|runtime)[^)]*\)\s*=>\s*(?:asTools\(runtime\)|tools)\.([A-Za-z_]\w*)\s*\(/gm)) {
      // `handler:` is the registry's own field name, not a tool: the shape of a
      // `defineTool({ ..., handler: (runtime, args) => asTools(runtime).x() })`
      // entry is identical to a dispatch-table row. Recorded as a tool it
      // becomes a phantom named "handler" whose effects can never be parsed,
      // which reads as a failure in every check built on this map.
      if (m[1] === 'handler') continue;
      dispatch.set(m[1], m[2]);
    }
    for (const m of src.matchAll(/name:\s*'([a-z][a-z0-9_]*)'[\s\S]{0,2000}?asTools\(runtime\)\.([A-Za-z_]\w*)\s*\(/g)) {
      if (!dispatch.has(m[1])) dispatch.set(m[1], m[2]);
    }
  }
  return dispatch;
}

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

/** `Map<toolName, effects[]>` as declared in source. */
export function loadEffects(root) {
  return loadArrayField(root, 'effects');
}

/** `Map<toolName, bridgeEndpoints[]>` for the tools that declare the field. */
export function loadBridgeEndpoints(root) {
  return loadArrayField(root, 'bridgeEndpoints');
}

function loadArrayField(root, field) {
  const out = new Map();
  for (const file of DEFINITION_FILES) {
    let src;
    try { src = readFileSync(resolve(root, file), 'utf8'); } catch { continue; }
    // No character window between `name:` and the field — just a refusal to
    // cross into the next tool. A fixed window silently dropped design_review
    // the moment a comment was added above its effects, and a check that
    // quietly stops checking is worse than no check.
    for (const m of src.matchAll(
      new RegExp(`name:\\s*'([a-z][a-z0-9_]*)',((?:(?!\\bname:\\s*')[\\s\\S])*?)${field}:\\s*\\[([^\\]]*)\\]`, 'g'),
    )) {
      out.set(m[1], [...m[3].matchAll(/'([^']+)'/g)].map((e) => e[1]));
    }
  }
  return out;
}
