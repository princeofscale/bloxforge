#!/usr/bin/env node
// Scores a list_changed probe journal against the roadmap's acceptance criteria.
//
//   node scripts/probe-report.mjs <journal.jsonl> [--host "Claude Code 2.1.4"]
//
// The decision this feeds is narrow and worth stating: dynamic tool loading is
// only kept for a host that lets the model call a newly advertised tool inside
// the turn it was already in, at least 29 times in 30. Anything less gets the
// static profile. A host that refreshes its UI promptly and still cannot do
// that scores zero here, which is the whole point — "the registry updated" and
// "the model saw it" are different measurements, and only the second one buys
// anything.
import { readFileSync } from 'node:fs';

const [, , journalPath, ...rest] = process.argv;
if (!journalPath) {
  console.error('usage: probe-report.mjs <journal.jsonl> [--host "<name and version>"]');
  process.exit(2);
}
const hostIndex = rest.indexOf('--host');
const host = hostIndex >= 0 ? rest[hostIndex + 1] : '(unrecorded)';

const events = readFileSync(journalPath, 'utf8')
  .split('\n')
  .filter((line) => line.trim() !== '')
  .map((line, i) => {
    try {
      return JSON.parse(line);
    } catch {
      throw new Error(`${journalPath}:${i + 1} is not JSON — a truncated journal scores nothing, it does not score zero`);
    }
  });

if (events.length === 0) {
  console.error(`${journalPath} is empty. Was BLOXFORGE_LIST_CHANGED_PROBE set for the server the host actually spawned?`);
  process.exit(1);
}

// One repetition = one list_changed and everything until the next one.
const repetitions = [];
let current = null;
for (const e of events) {
  if (e.kind === 'list_changed') {
    if (current) repetitions.push(current);
    current = { changedAt: e.t, generation: e.generation, refreshedAt: null, events: [] };
    continue;
  }
  if (!current) continue;
  if (e.kind === 'list_served' && current.refreshedAt === null) current.refreshedAt = e.t;
  current.events.push(e);
}
if (current) repetitions.push(current);

if (repetitions.length === 0) {
  console.error('no list_changed in the journal — the scenario never loaded a toolset, so nothing was measured');
  process.exit(1);
}

const REFRESH_BUDGET_MS = 2000;
const share = (n) => (repetitions.length === 0 ? 0 : n / repetitions.length);
const pct = (v) => `${(v * 100).toFixed(1)}%`;

let refreshedInBudget = 0;
let neverRefreshed = 0;
let canarySameTurn = 0;
let canaryNextTurn = 0;
let canaryNever = 0;
let staleErrors = 0;
let canaryCalls = 0;
const latencies = [];

for (const rep of repetitions) {
  if (rep.refreshedAt === null) neverRefreshed++;
  else {
    const dt = rep.refreshedAt - rep.changedAt;
    latencies.push(dt);
    if (dt <= REFRESH_BUDGET_MS) refreshedInBudget++;
  }

  // The operator stamps `turn-end` between the message that triggered the load
  // and the next user message. A newly advertised tool called before that stamp
  // was called inside the same turn; after it, only in the next one.
  const turnEnd = rep.events.find((e) => e.kind === 'mark' && e.label === 'turn-end');
  const canary = rep.events.filter((e) => e.kind === 'tool_call' && e.newlyAdvertised);
  canaryCalls += canary.length;
  staleErrors += canary.filter((e) => e.ok === false).length;

  const first = canary.find((e) => e.ok !== false);
  if (!first) canaryNever++;
  else if (!turnEnd || first.t < turnEnd.t) canarySameTurn++;
  else canaryNextTurn++;
}

latencies.sort((a, b) => a - b);
const median = latencies.length ? latencies[Math.floor(latencies.length / 2)] : null;

const sameTurn = share(canarySameTurn);
const GATE = 29 / 30;
const verdict = repetitions.length < 30
  ? 'INCONCLUSIVE'
  : sameTurn >= GATE ? 'DYNAMIC' : 'STATIC';

console.log(`host: ${host}`);
console.log(`repetitions: ${repetitions.length}${repetitions.length < 30 ? '  (the criterion is 29/30 — fewer than 30 cannot reach it)' : ''}`);
console.log(`  refreshed within ${REFRESH_BUDGET_MS}ms   ${pct(share(refreshedInBudget))}  (median ${median === null ? 'n/a' : `${median}ms`}, never refreshed ${neverRefreshed})`);
console.log(`  canary callable same turn    ${pct(sameTurn)}  ${canarySameTurn}/${repetitions.length}`);
console.log(`  canary callable next turn    ${pct(share(canaryNextTurn))}`);
console.log(`  canary never callable        ${pct(share(canaryNever))}`);
console.log(`  stale-call error rate        ${canaryCalls === 0 ? 'n/a' : pct(staleErrors / canaryCalls)}  (${staleErrors}/${canaryCalls} calls to a newly advertised tool errored)`);
console.log('');
console.log(`verdict: ${verdict}`);
if (verdict === 'INCONCLUSIVE') {
  console.log('  Run 30 repetitions on a pinned host build before labelling it.');
} else if (verdict === 'STATIC') {
  console.log('  Below 29/30 same-turn. Serve this host a static profile and do not advertise listChanged.');
} else {
  console.log('  At or above 29/30 same-turn. Dynamic loading is earned for this host build, and only this one.');
}
console.log('');
console.log('Not measured here: provider request counts and raw/cached input tokens, which need a host-side');
console.log('trace this journal cannot see. Record them from the host and report them alongside.');
