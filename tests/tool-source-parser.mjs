#!/usr/bin/env node
// The parser three conformance checks are built on, against the shapes that
// have actually defeated it.
//
// Every case here is a regression, not a hypothetical: each one once made a
// check pass by handing it a truncated body, and a check that stops examining
// its subject reports success in exactly the same words as one that examined it
// and found nothing wrong. That is the failure this file exists to catch.

import assert from 'node:assert/strict';

import { classMethodBodies, functionBody, methodBodies } from '../scripts/lib/tool-source.mjs';

const only = (map, name) => {
  const bodies = map.get(name);
  assert.ok(bodies, `${name} was not parsed at all`);
  assert.equal(bodies.length, 1, `${name} parsed ${bodies.length} times`);
  return bodies[0];
};

// A return type annotation is not the body. `_captureFingerprint` returned
// `Promise<{ fp: Fingerprint; ... }>`, whose object type was handed back as the
// whole method — so get_changes_since passed the endpoint audit unexamined.
{
  const src = [
    'class C {',
    '  private async withReturnType(path: string): Promise<{ fp: Fp; count: number }> {',
    "    await this.runtime.callSingle('/api/execute-luau', { code });",
    '  }',
    '}',
  ].join('\n');
  assert.match(only(methodBodies(src), 'withReturnType'), /execute-luau/);
}

// An object type in the parameter list is not the body either.
{
  const src = [
    'class C {',
    '  withObjectParam(opts: { a?: number; b?: string }): void {',
    "    this.runtime.call('/api/get-file-tree');",
    '  }',
    '}',
  ].join('\n');
  assert.match(only(methodBodies(src), 'withObjectParam'), /get-file-tree/);
}

// An interface member has no body. Searching forward for the next `{` gives it
// the following unrelated block, which is how three facade methods were
// reported as reaching the network on their own.
{
  const src = [
    'interface I {',
    '  declaredOnly(code: string): Promise<{ ok: boolean }>;',
    '}',
    'class C {',
    '  unrelated(): void {',
    "    this.runtime.call('/api/execute-luau');",
    '  }',
    '}',
  ].join('\n');
  assert.equal(methodBodies(src).get('declaredOnly'), undefined, 'interface member must have no body');
  assert.match(only(methodBodies(src), 'unrelated'), /execute-luau/);
}

// Field types keep same-named methods on different classes apart. Keying by
// bare name merged them and produced the claim that get_file_tree reaches
// /api/set-script-source.
{
  const src = [
    'export class Reader {',
    '  get(): void {',
    "    this.runtime.call('/api/get-file-tree');",
    '  }',
    '}',
    'export class Writer {',
    '  private readonly dep: Reader;',
    '  get(): void {',
    "    this.runtime.call('/api/set-script-source');",
    '  }',
    '}',
  ].join('\n');
  const classes = classMethodBodies(src);
  assert.match(classes.get('Reader').methods.get('get'), /get-file-tree/);
  assert.match(classes.get('Writer').methods.get('get'), /set-script-source/);
  assert.equal(classes.get('Writer').fields.get('dep'), 'Reader');
}

// functionBody carries the same guarantees to the plugin's module functions,
// which is what check-undo-coverage reads. Its own copy jumped to the next `{`
// and would report this handler as recording nothing.
{
  const src = [
    'function handler(requestData: Record<string, unknown>): { ok: boolean } {',
    '  ChangeHistoryService:beginRecording();',
    '  return { ok: true };',
    '}',
  ].join('\n');
  assert.match(functionBody(src, 'handler'), /beginRecording/);
  assert.equal(functionBody(src, 'missing'), undefined);
}

// A declaration without a body must not borrow the next one's.
{
  const src = ['declare function ambient(a: string): void;', 'function other(): void {', '  used();', '}'].join('\n');
  assert.equal(functionBody(src, 'ambient'), undefined);
  assert.match(functionBody(src, 'other'), /used\(\)/);
}

// A repeated name is refused rather than guessed at. QueryHandlers.ts declares
// searchRecursive three times, each nested in a different handler, so taking the
// first match returns a body belonging to a different function entirely.
{
  const src = [
    'function outerA(): void {',
    '\tfunction shared(): void {',
    '\t\tfirst();',
    '\t}',
    '}',
    'function outerB(): void {',
    '\tfunction shared(): void {',
    '\t\tsecond();',
    '\t}',
    '}',
  ].join('\n');
  assert.equal(functionBody(src, 'shared'), undefined, 'an ambiguous name must not resolve to the first match');
  assert.match(functionBody(src, 'outerA'), /first\(\)/);
}

// A unique top-level declaration wins over nested ones, because that is what a
// module-level call resolves to.
{
  const src = [
    'function wrapper(): void {',
    '\tfunction helper(): void {',
    '\t\tnested();',
    '\t}',
    '}',
    'export function helper(): void {',
    '  topLevel();',
    '}',
  ].join('\n');
  assert.match(functionBody(src, 'helper'), /topLevel\(\)/);
}

// `if (...) {` at member indentation is not a method named "if".
{
  const src = ['class C {', '  if (x) {', '    y();', '  }', '  real(): void {', '    z();', '  }', '}'].join('\n');
  const parsed = methodBodies(src);
  assert.equal(parsed.get('if'), undefined, 'control flow must not be recorded as a method');
  assert.match(only(parsed, 'real'), /z\(\)/);
}

console.error(
  'tool-source-parser: return types, object params, interface members, control flow, ' +
  'repeated names and module functions all resolve as declared.',
);
