#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
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
  execFileSync(process.execPath, ['scripts/build-plugin.mjs', '--variant', 'inspector'], {
    cwd: root,
    env,
    encoding: 'utf8',
  });
  const mainPath = join(root, 'studio-plugin', 'MCPPlugin.rbxmx');
  const inspectorPath = join(root, 'studio-plugin', 'MCPInspectorPlugin.rbxmx');
  const inspector = readFileSync(inspectorPath, 'utf8');
  for (const omitted of [
    '<string name="Name">PluginRoutes</string>',
    '<string name="Name">EvalBridges</string>',
    '<string name="Name">BreakpointHandlers</string>',
    '<string name="Name">EvalRuntimeHandlers</string>',
    '<string name="Name">InputHandlers</string>',
    '<string name="Name">InstanceHandlers</string>',
    '/api/delete-object',
  ]) {
    assert.equal(inspector.includes(omitted), false, `inspector asset must omit ${omitted}`);
  }
  assert.match(inspector, /InspectorRoutes/);
  assert.match(inspector, /\/api\/file-tree/);
  assert.ok(statSync(inspectorPath).size < statSync(mainPath).size, 'inspector asset must be smaller than main');
  console.error('plugin-build-install-safety: build did not modify a default Studio plugin directory.');
} finally {
  rmSync(fakeHome, { recursive: true, force: true });
}
