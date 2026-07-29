#!/usr/bin/env node

import { readFileSync } from 'node:fs';

const packageFiles = [
  'package.json',
  'packages/core/package.json',
  'packages/robloxstudio-mcp/package.json',
  'packages/robloxstudio-mcp-inspector/package.json',
  'studio-plugin/package.json',
  'evals/package.json',
];

for (const file of packageFiles) {
  const pkg = JSON.parse(readFileSync(file, 'utf8'));
  if (pkg.engines?.node !== '>=20') {
    throw new Error(`${file} must declare engines.node as >=20`);
  }
}

if (!readFileSync('README.md', 'utf8').includes('Requires Node.js 20 or newer.')) {
  throw new Error('README.md must document the Node.js 20+ runtime requirement');
}

console.log('Package metadata and README agree on Node.js 20+ support.');
