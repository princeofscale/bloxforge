#!/usr/bin/env node

/**
 * Stages only the runtime assets required by each published package.
 * Run from a publishable package directory via its "prepack" script.
 */

import { cpSync, copyFileSync, existsSync, mkdirSync } from 'fs';
import { basename, join } from 'path';

const packageDir = process.cwd();
const rootDir = join(packageDir, '..', '..');
const pluginAssets = {
  'robloxstudio-mcp': 'MCPPlugin.rbxmx',
  'robloxstudio-mcp-inspector': 'MCPInspectorPlugin.rbxmx',
};
const pluginAsset = pluginAssets[basename(packageDir)];

if (!pluginAsset) {
  throw new Error(`Unsupported publishable package directory: ${packageDir}`);
}

const pluginSource = join(rootDir, 'studio-plugin', pluginAsset);
const pluginDestDir = join(packageDir, 'studio-plugin');
const pluginDest = join(pluginDestDir, pluginAsset);
if (!existsSync(pluginSource)) {
  throw new Error(`${pluginAsset} not found. Run npm run build:plugins before packing.`);
}
if (existsSync(pluginDestDir)) {
  throw new Error(`Stale prepack directory exists: ${pluginDestDir}. Run the postpack cleanup and retry.`);
}
mkdirSync(pluginDestDir);
copyFileSync(pluginSource, pluginDest);
console.log(`Staged studio-plugin/${pluginAsset}`);

const assetsSource = join(rootDir, 'packages', 'core', 'assets');
const assetsDest = join(packageDir, 'assets');
if (!existsSync(assetsSource)) {
  throw new Error(`Runtime assets not found: ${assetsSource}`);
}
if (existsSync(assetsDest)) {
  throw new Error(`Stale prepack directory exists: ${assetsDest}. Run the postpack cleanup and retry.`);
}
cpSync(assetsSource, assetsDest, { recursive: true });
console.log('Staged runtime assets');
