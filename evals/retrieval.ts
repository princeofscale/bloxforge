#!/usr/bin/env node
// Scores tool_catalog_search against the frozen corpus. No model, no Studio, no
// provider budget — which is the point. The roadmap routes every later claim
// about tokens or quality through this corpus, and a benchmark that costs money
// to run is a benchmark that gets run once, at the moment it flatters you.
//
// ponytail: this stops at shortlist retrieval. It does not measure whether a
// model holding the shortlist picks the right tool, fills its arguments, or
// finishes the task — and it cannot, because ranking is all it looks at. The
// ceiling is real but not arbitrary: a tool that never reaches the shortlist
// cannot be chosen by any model, however good, so a failure here caps
// everything above it. Upgrade path: the model-driven harness in `run.ts`,
// which measures those things and costs a provider key, Studio and money.
//
//   npx tsx evals/retrieval.ts              # report
//   npx tsx evals/retrieval.ts --check      # also gate on the committed baseline
//   npx tsx evals/retrieval.ts --update     # rewrite the baseline
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { bootstrapCI, goldRank, scoreRankings, sequenceEditDistance } from './retrieval-metrics.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const require = createRequire(`${root}/`);

interface CatalogEntry { name: string; domain: string; mode: string; whenToUse: string }

const { buildCatalog, searchCatalog } = require('./packages/core/dist/tools/tool-catalog.js');
const { TOOL_DEFINITIONS } = require('./packages/core/dist/tools/definitions.js');
const catalog: CatalogEntry[] = buildCatalog(TOOL_DEFINITIONS);

/** The shortlist an agent actually receives: tool_catalog_search's own default. */
const SHORTLIST = 8;

const rank = (query: string, limit = SHORTLIST): string[] =>
  searchCatalog(catalog, { query, limit }).map((e: CatalogEntry) => e.name);

const read = (f: string) => JSON.parse(readFileSync(`${here}/corpus/${f}`, 'utf8'));
const positives = read('positives.json').cases as { tool: string; query: string }[];
const confusers = read('confusers.generated.json').cases as
  { id: string; query: string; gold: string[]; mustNotRankFirst: string[] }[];
const noTool = read('no-tool.json').cases as { id: string; query: string }[];
const multiStep = read('multi-step.json').cases as { id: string; query: string; goldSequence: string[] }[];
const adversarial = read('adversarial.json').cases as
  { id: string; query: string; goldTools?: string[]; mustNotRankFirst?: string[]; absentTool?: string }[];

// --- positives: is the right tool in the shortlist at all
const positiveResults = positives.map((c) => ({ ranking: rank(c.query, 20), gold: [c.tool] }));
const positiveScore = scoreRankings(positiveResults);
const inShortlist = positiveResults.map((r) => {
  const g = goldRank(r.ranking, r.gold);
  return g > 0 && g <= SHORTLIST ? 1 : 0;
});
const shortlistCI = bootstrapCI(inShortlist);

// --- confusers: does a near neighbour steal first place
const confuserHits = confusers.map((c) => {
  const ranking = rank(c.query, 20);
  return ranking[0] !== undefined && c.mustNotRankFirst.includes(ranking[0]) ? 1 : 0;
});
const confuserCI = bootstrapCI(confuserHits);

// --- no-tool: a retriever that always answers cannot say "none of these".
//
// What is measured here is exactly presence: did the ranking return anything at
// all for a query that has no tool answer. Not confidence — `searchCatalog`
// exposes no score to a caller, so nothing here can read one, and calling this
// "a confident match" would be the same overclaim the corpus exists to catch.
// It becomes a real measurement the day the ranking can abstain or return a
// margin to score against.
const noToolOffered = noTool.map((c) => {
  const matches = searchCatalog(catalog, { query: c.query, limit: 1 }) as CatalogEntry[];
  return matches.length > 0 ? 1 : 0;
});
const noToolCI = bootstrapCI(noToolOffered);

// --- multi-step: the shortlist has to contain every step, or the trajectory is
// unreachable no matter how good the model is.
const stepCoverage = multiStep.map((c) => {
  const ranking = rank(c.query, 20);
  const found = c.goldSequence.filter((t) => ranking.slice(0, SHORTLIST).includes(t)).length;
  return found / c.goldSequence.length;
});
const orderDistance = multiStep.map((c) => {
  const ranking = rank(c.query, 20).filter((t) => c.goldSequence.includes(t));
  return sequenceEditDistance(ranking, c.goldSequence);
});

// --- adversarial, reported in two parts that measure different things.
//
// The `absentTool` cases never read the query or the ranking: they assert the
// catalog does not contain a tool the user named. That is worth checking — it
// is what lets the layer above say "no such tool" instead of substituting a
// neighbour — but no retrieval change can ever move it, so folding it into one
// pass rate would pad that rate with cases the gate cannot fail on. Eight of
// the thirty were doing exactly that.
const staleCatalog = adversarial.filter((c) => c.absentTool);
const retrievalAdversarial = adversarial.filter((c) => !c.absentTool);

const staleCatalogHits = staleCatalog.map((c) => (catalog.some((e) => e.name === c.absentTool) ? 0 : 1));

const adversarialHits = retrievalAdversarial.map((c) => {
  const ranking = rank(c.query, 20);
  if (c.mustNotRankFirst && ranking[0] && c.mustNotRankFirst.includes(ranking[0])) return 0;
  if (c.goldTools) return c.goldTools.some((t) => ranking.slice(0, SHORTLIST).includes(t)) ? 1 : 0;
  return 1;
});

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const report = {
  shortlist: SHORTLIST,
  positives: {
    cases: positives.length,
    recallAt1: +positiveScore.recallAtK[1].toFixed(4),
    recallAt3: +positiveScore.recallAtK[3].toFixed(4),
    recallAt5: +positiveScore.recallAtK[5].toFixed(4),
    recallAt8: +positiveScore.recallAtK[8].toFixed(4),
    mrr: +positiveScore.mrr.toFixed(4),
    shortlistCI: { low: +shortlistCI.low.toFixed(4), high: +shortlistCI.high.toFixed(4) },
  },
  confusers: {
    cases: confusers.length,
    stolenFirstPlace: +confuserCI.mean.toFixed(4),
    ci: { low: +confuserCI.low.toFixed(4), high: +confuserCI.high.toFixed(4) },
  },
  noTool: { cases: noTool.length, offeredAMatch: +noToolCI.mean.toFixed(4) },
  staleCatalog: {
    cases: staleCatalog.length,
    namedToolAbsent: +(staleCatalogHits.reduce((a: number, b: number) => a + b, 0) / staleCatalogHits.length).toFixed(4),
  },
  multiStep: {
    cases: multiStep.length,
    meanStepCoverage: +(stepCoverage.reduce((a, b) => a + b, 0) / stepCoverage.length).toFixed(4),
    meanOrderDistance: +(orderDistance.reduce((a, b) => a + b, 0) / orderDistance.length).toFixed(4),
  },
  adversarial: {
    cases: retrievalAdversarial.length,
    passed: +(adversarialHits.reduce((a: number, b: number) => a + b, 0) / adversarialHits.length).toFixed(4),
  },
};

console.error(`retrieval @${SHORTLIST} over 784 frozen cases`);
console.error(`  positives      recall@1 ${pct(report.positives.recallAt1)}  @3 ${pct(report.positives.recallAt3)}  @8 ${pct(report.positives.recallAt8)}  [95% CI ${pct(shortlistCI.low)}–${pct(shortlistCI.high)}]  MRR ${report.positives.mrr}`);
console.error(`  confusers      near neighbour takes first place in ${pct(report.confusers.stolenFirstPlace)}  [95% CI ${pct(confuserCI.low)}–${pct(confuserCI.high)}]`);
console.error(`  no-tool        a match is offered for ${pct(report.noTool.offeredAMatch)} of queries that have no tool answer (presence, not confidence — nothing here reads a score)`);
console.error(`  multi-step     ${pct(report.multiStep.meanStepCoverage)} of gold steps reachable from one shortlist; mean order distance ${report.multiStep.meanOrderDistance}`);
console.error(`  adversarial    ${pct(report.adversarial.passed)} pass over ${report.adversarial.cases} retrieval cases`);
console.error(`  stale-catalog  ${pct(report.staleCatalog.namedToolAbsent)} of ${report.staleCatalog.cases} named-but-absent tools are absent (static; no retrieval change can move it)`);

const baselinePath = `${here}/corpus/baseline.json`;

// Exactly one recognised option, and nothing else. `--update --check` read as
// "update", silently, so a run meant to gate rewrote the thing it was gating
// against; a typo like `--chek` read as "report only" and exited 0.
const flags = process.argv.slice(2);
const KNOWN = ['--update', '--check'];
const unknown = flags.filter((f) => !KNOWN.includes(f));
if (unknown.length > 0) {
  console.error(`retrieval: unrecognised option(s) ${unknown.join(', ')}. Use one of ${KNOWN.join(', ')}, or none.`);
  process.exit(2);
}
if (flags.includes('--update') && flags.includes('--check')) {
  console.error('retrieval: --update and --check are mutually exclusive — one rewrites the baseline the other gates on.');
  process.exit(2);
}

if (flags.includes('--update')) {
  writeFileSync(baselinePath, `${JSON.stringify(report, null, 1)}\n`);
  console.error(`\nbaseline written to ${baselinePath}`);
  process.exit(0);
}

if (flags.includes('--check')) {
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
  // Only regressions fail. An improvement that moves the numbers is committed
  // with --update, deliberately, so the baseline is always something someone
  // chose rather than something that drifted.
  const gates: [string, number, number, 'higher' | 'lower'][] = [
    ['positives.recallAt8', report.positives.recallAt8, baseline.positives?.recallAt8, 'higher'],
    ['positives.mrr', report.positives.mrr, baseline.positives?.mrr, 'higher'],
    ['confusers.stolenFirstPlace', report.confusers.stolenFirstPlace, baseline.confusers?.stolenFirstPlace, 'lower'],
    ['multiStep.meanStepCoverage', report.multiStep.meanStepCoverage, baseline.multiStep?.meanStepCoverage, 'higher'],
    ['adversarial.passed', report.adversarial.passed, baseline.adversarial?.passed, 'higher'],
    // The README calls 90% here a finding; leaving it out of the gate would let
    // it climb to 100% while release:check stayed green, which is naming a
    // defect and then declining to watch it.
    ['noTool.offeredAMatch', report.noTool.offeredAMatch, baseline.noTool?.offeredAMatch, 'lower'],
  ];

  // A baseline missing a field compares as `now < undefined - 0.01`, which is
  // false — so a truncated or hand-edited baseline reports "no regression" for
  // every metric it no longer contains. Fail closed on the shape first.
  const malformed = gates.filter(([, , was]) => !Number.isFinite(was));
  if (malformed.length > 0) {
    for (const [name] of malformed) console.error(`  ✗ baseline has no finite value for ${name}`);
    console.error(`\nretrieval: ${baselinePath} is not a usable baseline. Regenerate it with --update.`);
    process.exit(1);
  }

  const TOLERANCE = 0.01;
  const failures = gates.filter(([, now, was, dir]) =>
    dir === 'higher' ? now < was - TOLERANCE : now > was + TOLERANCE);
  if (failures.length > 0) {
    for (const [name, now, was] of failures) {
      console.error(`  ✗ ${name}: ${now} vs baseline ${was}`);
    }
    console.error('\nretrieval: regressed against the committed baseline. Fix it, or re-baseline with --update and say why.');
    process.exit(1);
  }
  console.error('\nretrieval: no regression against the committed baseline.');
}
