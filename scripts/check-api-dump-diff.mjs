#!/usr/bin/env node
// Compare two Roblox API dumps and fail on a change that can break a caller.
//
// Roadmap 04, item 3 — the CI half. Roblox ships every week; the changes that
// matter are not the new classes but the quiet ones: a property whose type
// moved, a member that gained a security tag, a class that went away. Each of
// those breaks code that still type-checks.
//
//   node scripts/check-api-dump-diff.mjs <before.json> <after.json> [--json]
//
// Exit 0 compatible, 1 incompatible, 2 could not run. The last is separate on
// purpose: "the dump would not parse" and "the API is fine" must not share an
// exit code.

import { readFileSync } from 'node:fs';
import { CapabilityRegistry, diffRegistries } from '../packages/core/dist/engine/capability-registry.js';

function fail(message) {
  process.stderr.write(`api-dump-diff: ${message}\n`);
  process.exit(2);
}

function load(path) {
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (error) {
    fail(`cannot read ${path}: ${error.message}`);
  }
  try {
    // The origin is `fixture` here rather than `studio`: this script compares
    // two files, and neither of them is the Studio in front of anybody.
    return new CapabilityRegistry(JSON.parse(raw), { source: 'fixture' });
  } catch (error) {
    fail(`${path} is not a usable API dump: ${error.message}`);
  }
}

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const paths = args.filter((a) => !a.startsWith('--'));
if (paths.length !== 2) fail('usage: check-api-dump-diff.mjs <before.json> <after.json> [--json]');

const diff = diffRegistries(load(paths[0]), load(paths[1]));

if (asJson) {
  process.stdout.write(`${JSON.stringify(diff, null, 2)}\n`);
} else {
  const say = (label, rows) => {
    if (rows.length > 0) process.stdout.write(`${label} (${rows.length}):\n  ${rows.slice(0, 40).join('\n  ')}\n`);
  };
  say('Removed classes', diff.removedClasses);
  say('Removed members', diff.removedMembers);
  say('Changed types', diff.changedTypes.map((c) => `${c.member}: ${c.from} -> ${c.to}`));
  say('Newly secured', diff.newlySecured.map((c) => `${c.member}: ${c.from} -> ${c.to}`));
  say('Newly deprecated', diff.newlyDeprecated);
  process.stdout.write(
    diff.compatible
      ? `Compatible. ${diff.addedClasses.length} class(es) and ${diff.addedMembers.length} member(s) added; nothing that existed stopped existing.\n`
      : 'Incompatible: something a caller could already be using changed or went away.\n',
  );
}

process.exit(diff.compatible ? 0 : 1);
