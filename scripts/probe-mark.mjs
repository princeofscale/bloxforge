#!/usr/bin/env node
// Stamps a turn boundary into a probe journal.
//
//   node scripts/probe-mark.mjs <journal.jsonl> turn-end
//
// The server has no notion of a turn and neither does a stdio proxy without
// provider traces, so the one fact that separates "callable in the same turn"
// from "callable in the next one" has to come from the operator driving the
// host. Run this between the message that triggered the toolset load and the
// next one you type.
import { appendFileSync } from 'node:fs';

const [, , journalPath, label = 'turn-end'] = process.argv;
if (!journalPath) {
  console.error('usage: probe-mark.mjs <journal.jsonl> [label]');
  process.exit(2);
}
appendFileSync(journalPath, `${JSON.stringify({ t: Date.now(), kind: 'mark', generation: -1, label })}\n`);
console.error(`marked ${label} in ${journalPath}`);
