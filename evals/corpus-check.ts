#!/usr/bin/env node
// Integrity gate for the frozen corpus.
//
// "Frozen" is the whole value: a benchmark that quietly changes between two
// runs turns every comparison into a comparison of two different benchmarks.
// So this checks four things, and each one has a way the corpus could rot that
// nothing else would catch:
//
//  1. Composition — 228/456/50/50/30. A bucket that shrank is a coverage claim
//     that stopped being true without anything failing.
//  2. Coverage — exactly one positive per tool, no tool missing, no case naming
//     a tool that no longer exists. Adding a tool without a case is the normal
//     way corpus coverage decays.
//  3. Derivation — the generated confusers match what build-confusers.ts
//     produces from the current catalog and positives.
//  4. Circularity — no positive query is a paraphrase of its own tool's
//     description. This is the one that decides whether the numbers mean
//     anything: a corpus written out of the tool list measures the retriever
//     against itself and scores well for it.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { vocabularyOverlap } from './retrieval-metrics.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const require = createRequire(`${root}/`);

interface CatalogEntry { name: string; domain: string; mode: string; whenToUse: string }

const { buildCatalog } = require('./packages/core/dist/tools/tool-catalog.js');
const { TOOL_DEFINITIONS } = require('./packages/core/dist/tools/definitions.js');
const catalog: CatalogEntry[] = buildCatalog(TOOL_DEFINITIONS);
const known = new Set(catalog.map((e) => e.name));
const byName = new Map(catalog.map((e) => [e.name, e]));

const read = (f: string) => JSON.parse(readFileSync(`${here}/corpus/${f}`, 'utf8'));
const positives = read('positives.json');
const confusers = read('confusers.generated.json');
const noTool = read('no-tool.json');
const multiStep = read('multi-step.json');
const adversarial = read('adversarial.json');

/**
 * A positive query may not share more than this share of its content words with
 * the text the retriever indexes for that tool.
 *
 * Not zero, and the reason is not laziness. Real users say "install the
 * packages" for a tool whose description says "install"; driving overlap to
 * zero would mean writing queries no one would type, which measures a different
 * and less interesting thing. The ceiling catches outright paraphrase — a query
 * lifted from `whenToUse` — while leaving the natural vocabulary alone. The
 * corpus currently sits at a mean of about 0.22.
 */
const MAX_OVERLAP = 0.75;

const EXPECTED = { positive: 228, confuser: 456, no_tool: 50, multi_step: 50, adversarial: 30 };

const problems: string[] = [];

// 1. Composition.
const counts = {
  positive: positives.cases.length,
  confuser: confusers.cases.length,
  no_tool: noTool.cases.length,
  multi_step: multiStep.cases.length,
  adversarial: adversarial.cases.length,
};
for (const [bucket, want] of Object.entries(EXPECTED)) {
  const got = counts[bucket as keyof typeof counts];
  if (got !== want) problems.push(`${bucket}: ${got} cases, expected ${want}`);
}

// 2. Coverage. Exactly one positive per tool, and every tool named anywhere
//    must exist — a case pointing at a deleted tool grades nothing forever.
const seen = new Map<string, number>();
for (const c of positives.cases) seen.set(c.tool, (seen.get(c.tool) ?? 0) + 1);
for (const name of known) if (!seen.has(name)) problems.push(`no positive case for tool ${name}`);
for (const [name, n] of seen) {
  if (!known.has(name)) problems.push(`positive case names unknown tool ${name}`);
  if (n > 1) problems.push(`tool ${name} has ${n} positive cases, expected 1`);
}
const namedTools = [
  ...confusers.cases.flatMap((c: { gold: string[]; mustNotRankFirst: string[] }) => [...c.gold, ...c.mustNotRankFirst]),
  ...multiStep.cases.flatMap((c: { goldSequence: string[] }) => c.goldSequence),
  ...adversarial.cases.flatMap((c: { goldTools?: string[]; mustNotRankFirst?: string[] }) => [
    ...(c.goldTools ?? []), ...(c.mustNotRankFirst ?? []),
  ]),
];
for (const name of new Set(namedTools)) {
  if (!known.has(name)) problems.push(`a case names unknown tool ${name}`);
}
// An `absentTool` that has since been implemented stops being adversarial and
// starts being wrong — it would assert a real tool is missing.
for (const c of adversarial.cases as { id: string; absentTool?: string }[]) {
  if (c.absentTool && known.has(c.absentTool)) {
    problems.push(`${c.id}: absentTool ${c.absentTool} now exists — the case asserts the opposite of the truth`);
  }
}

// 3. Derivation.
execFileSync('npx', ['tsx', `${here}/corpus/build-confusers.ts`], { cwd: root, stdio: 'pipe' });
const regenerated = readFileSync(`${here}/corpus/confusers.generated.json`, 'utf8');
if (regenerated !== `${JSON.stringify(confusers, null, 1)}\n`) {
  problems.push('confusers.generated.json does not match what build-confusers.ts produces — regenerate and commit it');
}

// 4. Circularity.
let overlapSum = 0;
for (const c of positives.cases as { tool: string; query: string }[]) {
  const e = byName.get(c.tool);
  if (!e) continue;
  const overlap = vocabularyOverlap(c.query, `${e.name.replace(/_/g, ' ')} ${e.whenToUse}`);
  overlapSum += overlap;
  if (overlap > MAX_OVERLAP) {
    problems.push(`${c.tool}: query reuses ${(overlap * 100) | 0}% of the tool's own words (ceiling ${MAX_OVERLAP * 100}%) — rewrite it in task language`);
  }
}

const total = Object.values(counts).reduce((a, b) => a + b, 0);
if (problems.length > 0) {
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.error(`\ncorpus-check: ${problems.length} problem(s).`);
  process.exit(1);
}
console.error(
  `corpus-check: ${total} cases (${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ')}); ` +
  `one positive per tool across ${known.size} tools; mean query/description overlap ${(overlapSum / positives.cases.length).toFixed(3)}.`,
);
