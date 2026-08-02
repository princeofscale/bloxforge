#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const root = process.cwd();
const fixtureRoot = mkdtempSync(join(tmpdir(), 'bloxforge-protocol-policy-'));
const fixturePaths = [
  'scripts/generate-protocol-policy.mjs',
  'packages/core/src/protocol-endpoints.json',
  'packages/core/src/protocol-endpoints.generated.ts',
  'studio-plugin/src/modules/generated/ProtocolPolicy.ts',
];

try {
  for (const relativePath of fixturePaths) {
    const fixturePath = join(fixtureRoot, relativePath);
    mkdirSync(dirname(fixturePath), { recursive: true });
    copyFileSync(join(root, relativePath), fixturePath);
  }

  for (const relativePath of fixturePaths.slice(2)) {
    const fixturePath = join(fixtureRoot, relativePath);
    const crlfContent = readFileSync(fixturePath, 'utf8').replace(/\n/g, '\r\n');
    writeFileSync(fixturePath, crlfContent, 'utf8');
  }

  execFileSync(process.execPath, ['scripts/generate-protocol-policy.mjs', '--check'], {
    cwd: fixtureRoot,
    stdio: 'pipe',
  });

  const stalePath = join(fixtureRoot, 'packages/core/src/protocol-endpoints.generated.ts');
  writeFileSync(stalePath, `${readFileSync(stalePath, 'utf8')}// stale\r\n`, 'utf8');
  const staleCheck = spawnSync(
    process.execPath,
    ['scripts/generate-protocol-policy.mjs', '--check'],
    { cwd: fixtureRoot, encoding: 'utf8' },
  );
  assert.notEqual(staleCheck.status, 0, 'stale generated content must fail the check');
  assert.match(staleCheck.stderr, /Generated protocol policy is stale/);

  console.error('protocol-policy-generator: CRLF checkout accepted; stale content rejected.');
} finally {
  rmSync(fixtureRoot, { recursive: true, force: true });
}
