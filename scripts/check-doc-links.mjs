#!/usr/bin/env node
// Resolve every relative Markdown link in the tracked docs against the working
// tree. CONTRIBUTING.md pointed at a todo.md that had never existed and nothing
// caught it, because docs:check only compared the generated tool reference.
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';

const LINK = /\[[^\]]*\]\(([^)\s]+)\)/g;
const EXTERNAL = /^(https?:|mailto:|#)/;

const files = execFileSync('git', ['ls-files', '*.md'], { encoding: 'utf8' })
  .split('\n')
  .filter(Boolean);

const broken = [];
for (const file of files) {
  const source = await readFile(file, 'utf8');
  for (const [, link] of source.matchAll(LINK)) {
    if (EXTERNAL.test(link)) continue;
    // Strip the fragment: anchors are not validated, only the target file.
    const target = decodeURIComponent(link.split('#')[0]);
    if (!target) continue;
    if (!existsSync(resolve(dirname(file), target))) broken.push({ file, link });
  }
}

if (broken.length > 0) {
  for (const { file, link } of broken) console.error(`${file}: broken link -> ${link}`);
  console.error(`\n${broken.length} broken link(s) in ${files.length} Markdown files.`);
  process.exit(1);
}

console.log(`Doc links OK (${files.length} Markdown files).`);
