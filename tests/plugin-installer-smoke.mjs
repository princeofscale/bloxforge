#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = process.cwd();
const pluginsDir = mkdtempSync(join(tmpdir(), 'bloxforge installer smoke '));
const main = join(root, 'packages', 'robloxstudio-mcp', 'dist', 'index.js');
const inspector = join(root, 'packages', 'robloxstudio-mcp-inspector', 'dist', 'index.js');

function install(cli) {
  const result = spawnSync(process.execPath, [cli, '--install-plugin'], {
    cwd: root,
    env: { ...process.env, MCP_PLUGINS_DIR: pluginsDir },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
}

try {
  install(main);
  assert.equal(existsSync(join(pluginsDir, 'MCPPlugin.rbxmx')), true);

  install(inspector);
  assert.equal(existsSync(join(pluginsDir, 'MCPPlugin.rbxmx')), false);
  assert.equal(existsSync(join(pluginsDir, 'MCPInspectorPlugin.rbxmx')), true);

  install(main);
  assert.equal(existsSync(join(pluginsDir, 'MCPInspectorPlugin.rbxmx')), false);
  assert.equal(existsSync(join(pluginsDir, 'MCPPlugin.rbxmx')), true);
  console.error('plugin-installer-smoke: both CLIs install atomically and replace variant conflicts.');
} finally {
  rmSync(pluginsDir, { recursive: true, force: true });
}
