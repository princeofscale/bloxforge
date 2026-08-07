#!/usr/bin/env node
// Argument errors must name the schema parameter, not describe it.
//
// `mass_get_property` answered "Paths array and property name are required",
// leaving an agent to work out that those are `paths` and `propertyName` — a
// wasted round trip on every miss. Twenty-two messages across five files said
// it that way. This keeps the next one from drifting back: a message of the
// form "<something> is/are required for <tool>" must open with an identifier
// that the tool actually declares.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const TOOLS_DIR = 'packages/core/src/tools';
const files = readdirSync(TOOLS_DIR)
  .filter((f) => f.endsWith('.ts'))
  .map((f) => join(TOOLS_DIR, f));

// "throw new Error('<subject> is|are required for <tool>')" — the shape used
// across the tool handlers. Template literals are matched too.
const PATTERN = /new Error\([`']([^`']*?)\s+(?:is|are)\s+required\s+for\s+([a-z_0-9$${}.]+)[`']/g;

// A named parameter is a lowerCamel/snake identifier, optionally a short list
// ("instancePath and propertyName", "min, max, and material") with parenthetical
// qualifiers ("paths (non-empty array)").
const IDENTIFIER = /^[a-z][A-Za-z0-9_]*$/;

const failures = [];
let checked = 0;

// A raw NUL byte in a source file makes `grep` classify the whole file as
// binary and print "Binary file ... matches" instead of the lines — and under a
// wrapper that swallows that notice, every search in the file comes back empty.
// `sync-tools.ts` used raw NULs as plan-hash field separators and read as
// unsearchable for it, which turned a present guard into an apparently missing
// one. Write the escape (`\0`); it produces the same byte at runtime.
// ponytail: this walks packages/core/src/tools only, because that is where it
// happened. Widen to every tracked text file if one turns up outside.
const nulFiles = [];

for (const file of files) {
  const src = readFileSync(file, 'utf8');
  if (src.includes('\0')) nulFiles.push(file);
  for (const match of src.matchAll(PATTERN)) {
    const [, subject, tool] = match;
    checked++;
    const words = subject
      .replace(/\([^)]*\)/g, '')          // drop "(non-empty array)" qualifiers
      .split(/\s*(?:,|\band\b|\bor\b)\s*/) // split lists
      .map((w) => w.trim())
      .filter(Boolean);
    if (words.length === 0 || !words.every((w) => IDENTIFIER.test(w))) {
      const line = src.slice(0, match.index).split('\n').length;
      failures.push(`${file}:${line}  ${tool}: "${subject} is required" does not name the parameter`);
    }
  }
}

if (nulFiles.length > 0) {
  console.error('argument-errors: source files must not contain a raw NUL byte — grep reads them as binary');
  console.error('  and returns nothing for every search, silently. Write it as the escape "\\0" instead.\n');
  for (const f of nulFiles) console.error(`  ✗ ${f}`);
  process.exit(1);
}

if (failures.length > 0) {
  console.error('argument-errors: messages must name the schema parameter, e.g.');
  console.error("  throw new Error('instancePath and propertyName are required for set_property')\n");
  for (const f of failures) console.error(`  ✗ ${f}`);
  console.error(`\n${failures.length} of ${checked} argument errors describe the parameter instead of naming it.`);
  process.exit(1);
}

console.log(`argument-errors: ${checked} argument errors name their parameters.`);
