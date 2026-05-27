#!/usr/bin/env node
// Runs each integration test as its own Node subprocess and summarizes
// results. Sequential (not parallel) to avoid playtest-state interference
// between tests — each one starts + stops its own playtest.

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const TESTS = [
  'eval-bridge-error-preservation.mjs',
  'execute-luau-error-preservation.mjs',
  'proxy-mode-peer-fanout.mjs',
  'execute-luau-output-capture.mjs',
];

function runOne(file) {
  return new Promise((res) => {
    const proc = spawn('node', [resolve(__dirname, file)], { stdio: 'inherit' });
    proc.on('exit', (code) => res({ file, code: code ?? 1 }));
  });
}

const results = [];
for (const file of TESTS) {
  const r = await runOne(file);
  results.push(r);
}

console.log('\n========== SUMMARY ==========');
for (const r of results) {
  console.log(`  ${r.code === 0 ? '✅ PASS' : '❌ FAIL'}  ${r.file}`);
}
const failed = results.filter((r) => r.code !== 0).length;
console.log(`\n${results.length - failed}/${results.length} passed.`);
process.exit(failed === 0 ? 0 : 1);
