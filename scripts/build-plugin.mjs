#!/usr/bin/env node

import { readFileSync, readdirSync, writeFileSync, copyFileSync, existsSync, mkdirSync, unlinkSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, basename, relative, sep } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const { version: VERSION } = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8'));
const pluginDir = join(rootDir, 'studio-plugin');
const outDir = join(pluginDir, 'out');
const serverDir = join(outDir, 'server');
const modulesDir = join(outDir, 'modules');
const includeDir = join(pluginDir, 'include');
const nodeModulesRbxtsDir = join(pluginDir, 'node_modules', '@rbxts');

// Three icon variants per build, swapped by the plugin at runtime to reflect
// connection state. Both plugin variants share the same verified status assets.
const VARIANTS = {
  main: {
    scriptName: 'MCPPlugin',
    outputName: 'MCPPlugin.rbxmx',
    toolbarName: 'BloxForge',
    buttonTitle: 'BloxForge',
    buttonTooltip: 'Connect BloxForge to your AI agent',
    buttonIconDisconnected: '75876056391496',  // red
    buttonIconConnecting: '71302583919560',    // yellow
    buttonIconConnected: '130958234173611',    // green
  },
  inspector: {
    scriptName: 'MCPInspectorPlugin',
    outputName: 'MCPInspectorPlugin.rbxmx',
    toolbarName: 'BloxForge Inspector',
    buttonTitle: 'BloxForge Inspector',
    buttonTooltip: 'Connect BloxForge Inspector (read-only) to your AI agent',
    buttonIconDisconnected: '75876056391496',  // red
    buttonIconConnecting: '71302583919560',    // yellow
    buttonIconConnected: '130958234173611',    // green
  },
};

const variantArgIdx = process.argv.indexOf('--variant');
const variantName = variantArgIdx !== -1 ? process.argv[variantArgIdx + 1] : 'main';
const variant = VARIANTS[variantName];
if (!variant) {
  console.error(`Unknown variant "${variantName}". Available: ${Object.keys(VARIANTS).join(', ')}`);
  process.exit(1);
}
for (const [name, config] of Object.entries(VARIANTS)) {
  const statusIcons = [
    config.buttonIconDisconnected,
    config.buttonIconConnecting,
    config.buttonIconConnected,
  ];
  if (new Set(statusIcons).size !== statusIcons.length) {
    throw new Error(`${name} must define a distinct toolbar icon for every connection state.`);
  }
}

const outputPath = join(pluginDir, variant.outputName);
const otherVariant = variantName === 'main' ? VARIANTS.inspector : VARIANTS.main;

function escapeCdata(source) {
  return source.replace(/\]\]>/g, ']]]]><![CDATA[>');
}

function injectVersion(source) {
  return source
    .replace(/__VERSION__/g, VERSION)
    .replace(/__PLUGIN_VARIANT__/g, variantName)
    .replace(/__TOOLBAR_NAME__/g, variant.toolbarName)
    .replace(/__BUTTON_TITLE__/g, variant.buttonTitle)
    .replace(/__BUTTON_TOOLTIP__/g, variant.buttonTooltip)
    .replace(/__BUTTON_ICON_DISCONNECTED__/g, variant.buttonIconDisconnected)
    .replace(/__BUTTON_ICON_CONNECTING__/g, variant.buttonIconConnecting)
    .replace(/__BUTTON_ICON_CONNECTED__/g, variant.buttonIconConnected);
}

const serverInitPath = join(serverDir, 'init.server.luau');
if (!existsSync(serverInitPath)) {
  console.error(`Server script not found at ${serverInitPath}`);
  console.error('Run "cd studio-plugin && npm run build" first to compile TypeScript.');
  process.exit(1);
}

const MAIN_ONLY_MODULES = new Set([
  'PluginRoutes.luau',
  'EvalBridges.luau',
  'handlers/BreakpointHandlers.luau',
  'handlers/EvalRuntimeHandlers.luau',
  'handlers/InputHandlers.luau',
  'handlers/InstanceHandlers.luau',
]);
const INSPECTOR_ONLY_MODULES = new Set([
  'InspectorRoutes.luau',
  'InspectorEvalBridges.luau',
  'handlers/InspectorBreakpointHandlers.luau',
]);

function moduleKey(filePath) {
  return relative(modulesDir, filePath).split(sep).join('/');
}

function shouldPackageModule(filePath) {
  const key = moduleKey(filePath);
  return variantName === 'inspector'
    ? !MAIN_ONLY_MODULES.has(key)
    : !INSPECTOR_ONLY_MODULES.has(key);
}

function transformCompiledSource(filePath, source) {
  if (variantName !== 'inspector') return source;
  const key = filePath === serverInitPath ? 'server/init.server.luau' : moduleKey(filePath);
  if (key === 'Communication.luau') {
    return source
      .replaceAll('"PluginRoutes"', '"InspectorRoutes"')
      .replaceAll('"EvalBridges"', '"InspectorEvalBridges"');
  }
  if (key === 'server/init.server.luau') {
    return source
      .replaceAll('"EvalBridges"', '"InspectorEvalBridges"')
      .replaceAll('"BreakpointHandlers"', '"InspectorBreakpointHandlers"');
  }
  return source;
}

const mainSource = injectVersion(transformCompiledSource(
  serverInitPath,
  readFileSync(serverInitPath, 'utf8'),
));

let refId = 1;

function findInitFile(dir) {
  for (const name of ['init.luau', 'init.lua']) {
    const p = join(dir, name);
    if (existsSync(p)) return p;
  }
  return undefined;
}

const INIT_FILENAMES = new Set(['init.luau', 'init.lua', 'init.server.luau', 'init.server.lua']);

function isLuaFile(name) {
  return name.endsWith('.luau') || name.endsWith('.lua');
}

function dirHasLuaContent(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile() && isLuaFile(entry.name) && shouldPackageModule(join(dir, entry.name))) return true;
    if (entry.isDirectory() && dirHasLuaContent(join(dir, entry.name))) return true;
  }
  return false;
}

function buildModuleItems(dir, depth = 0) {
  if (!existsSync(dir)) return '';

  let items = '';
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      if (!dirHasLuaContent(fullPath)) continue;

      const initFile = findInitFile(fullPath);
      refId++;
      const currentRef = refId;

      if (initFile) {
        const moduleSource = injectVersion(readFileSync(initFile, 'utf8'));
        const childItems = buildModuleItems(fullPath, depth + 1);
        items += `
      ${'  '.repeat(depth)}<Item class="ModuleScript" referent="${currentRef}">
      ${'  '.repeat(depth)}  <Properties>
      ${'  '.repeat(depth)}    <string name="Name">${entry.name}</string>
      ${'  '.repeat(depth)}    <string name="Source"><![CDATA[${escapeCdata(moduleSource)}]]></string>
      ${'  '.repeat(depth)}  </Properties>${childItems}
      ${'  '.repeat(depth)}</Item>`;
      } else {
        const childItems = buildModuleItems(fullPath, depth + 1);
        items += `
      ${'  '.repeat(depth)}<Item class="Folder" referent="${currentRef}">
      ${'  '.repeat(depth)}  <Properties>
      ${'  '.repeat(depth)}    <string name="Name">${entry.name}</string>
      ${'  '.repeat(depth)}  </Properties>${childItems}
      ${'  '.repeat(depth)}</Item>`;
      }
    } else if (isLuaFile(entry.name) && !INIT_FILENAMES.has(entry.name)) {
      if (!shouldPackageModule(fullPath)) continue;
      const ext = entry.name.endsWith('.luau') ? '.luau' : '.lua';
      const moduleName = basename(entry.name, ext);
      const moduleSource = injectVersion(transformCompiledSource(fullPath, readFileSync(fullPath, 'utf8')));
      refId++;
      items += `
      ${'  '.repeat(depth)}<Item class="ModuleScript" referent="${refId}">
      ${'  '.repeat(depth)}  <Properties>
      ${'  '.repeat(depth)}    <string name="Name">${moduleName}</string>
      ${'  '.repeat(depth)}    <string name="Source"><![CDATA[${escapeCdata(moduleSource)}]]></string>
      ${'  '.repeat(depth)}  </Properties>
      ${'  '.repeat(depth)}</Item>`;
    }
  }

  return items;
}

const moduleItems = buildModuleItems(modulesDir);

const includeItems = buildModuleItems(includeDir);

const rbxtsItems = buildModuleItems(nodeModulesRbxtsDir);

function countModules(dir) {
  if (!existsSync(dir)) return 0;
  let count = 0;
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      count += countModules(join(dir, entry.name));
      if (findInitFile(join(dir, entry.name))) count++;
    } else if (isLuaFile(entry.name) && !INIT_FILENAMES.has(entry.name) && shouldPackageModule(join(dir, entry.name))) {
      count++;
    }
  }
  return count;
}

const rbxmx = `<?xml version="1.0" encoding="utf-8"?>
<roblox version="4">
  <Item class="Script" referent="0">
    <Properties>
      <string name="Name">${variant.scriptName}</string>
      <token name="RunContext">0</token>
      <string name="Source"><![CDATA[${escapeCdata(mainSource)}]]></string>
    </Properties>
    <Item class="Folder" referent="1">
      <Properties>
        <string name="Name">modules</string>
      </Properties>${moduleItems}
    </Item>${includeItems ? `
    <Item class="Folder" referent="${++refId}">
      <Properties>
        <string name="Name">include</string>
      </Properties>${includeItems}
    </Item>` : ''}${rbxtsItems ? `
    <Item class="Folder" referent="${++refId}">
      <Properties>
        <string name="Name">node_modules</string>
      </Properties>
      <Item class="Folder" referent="${++refId}">
        <Properties>
          <string name="Name">@rbxts</string>
        </Properties>${rbxtsItems}
      </Item>
    </Item>` : ''}
  </Item>
</roblox>
`;

writeFileSync(outputPath, rbxmx, 'utf8');
const moduleCount = countModules(modulesDir);
const includeCount = countModules(includeDir);
const rbxtsCount = countModules(nodeModulesRbxtsDir);
console.log(`Built studio-plugin/${variant.outputName} (${moduleCount} modules${includeCount > 0 ? `, ${includeCount} runtime includes` : ''}${rbxtsCount > 0 ? `, ${rbxtsCount} @rbxts packages` : ''})`);

// Builds are side-effect free by default. Installation is explicit through
// MCP_PLUGINS_DIR so CI and local release builds cannot mutate a user's Studio.
const pluginsDir = process.env.MCP_PLUGINS_DIR?.trim();
if (pluginsDir) {
  mkdirSync(pluginsDir, { recursive: true });
  const otherInstallPath = join(pluginsDir, otherVariant.outputName);
  if (existsSync(otherInstallPath)) {
    unlinkSync(otherInstallPath);
    console.log(`Removed conflicting ${otherVariant.outputName} from ${pluginsDir}`);
  }
  const installPath = join(pluginsDir, variant.outputName);
  copyFileSync(outputPath, installPath);
  console.log(`Installed to ${installPath}`);
} else {
  console.log(`Skipped install: set MCP_PLUGINS_DIR to install ${variant.outputName}.`);
}
