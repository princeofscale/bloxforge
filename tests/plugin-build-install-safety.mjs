#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = process.cwd();
const fakeHome = mkdtempSync(join(tmpdir(), 'bloxforge-build-home-'));
const env = {
  ...process.env,
  HOME: fakeHome,
  USERPROFILE: fakeHome,
  LOCALAPPDATA: join(fakeHome, 'AppData', 'Local'),
};
delete env.MCP_PLUGINS_DIR;

try {
  const output = execFileSync(process.execPath, ['scripts/build-plugin.mjs'], {
    cwd: root,
    env,
    encoding: 'utf8',
  });
  assert.match(output, /Skipped install: set MCP_PLUGINS_DIR/);
  assert.equal(existsSync(join(fakeHome, 'Documents', 'Roblox', 'Plugins')), false);
  assert.equal(existsSync(join(fakeHome, 'AppData', 'Local', 'Roblox', 'Plugins')), false);
  console.error('plugin-build-install-safety: build did not modify a default Studio plugin directory.');
} finally {
  rmSync(fakeHome, { recursive: true, force: true });
}
