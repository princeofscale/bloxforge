import type { ToolCategory, ToolDefinition, ToolEffect } from './tools/definitions.js';
import { effectsForTool } from './tools/tool-effects.js';

export type Capability =
  | 'read.scene'
  | 'write.properties'
  | 'write.instances'
  | 'execute.luau'
  | 'assets.external'
  | 'playtest.control'
  | 'local.files.read'
  | 'local.files.write'
  | 'local.process.execute';

const PROPERTY_TOOLS = /^(set_property|set_properties|mass_set_property|set_attribute|bulk_set_attributes|add_tag|remove_tag|delete_attribute)$/;
const EXECUTE_TOOLS = /^(execute_luau|execute_luau_async|eval_.*runtime|apply_mutation_plan|run_gameplay_assertions|run_playtest_episode)$/;
const ASSET_TOOLS = /(asset|wally|publish|import_rbxm|export_rbxm)/;
const PLAYTEST_TOOLS = /(playtest|multiplayer|simulate_(mouse|keyboard)|character_navigation)/;

export function requiredCapability(toolName: string, category: ToolCategory): Capability {
  if (EXECUTE_TOOLS.test(toolName)) return 'execute.luau';
  if (ASSET_TOOLS.test(toolName)) return 'assets.external';
  if (PLAYTEST_TOOLS.test(toolName)) return 'playtest.control';
  if (PROPERTY_TOOLS.test(toolName)) return 'write.properties';
  return category === 'write' ? 'write.instances' : 'read.scene';
}

function capabilityForEffect(
  effect: ToolEffect,
  toolName: string,
  category: ToolCategory,
): Capability {
  switch (effect) {
    case 'studio.read': return 'read.scene';
    case 'studio.write': return requiredCapability(toolName, category);
    case 'studio.execute': return 'execute.luau';
    case 'local.files.read': return 'local.files.read';
    case 'local.files.write': return 'local.files.write';
    case 'local.process.execute': return 'local.process.execute';
    case 'network.external':
    case 'assets.upload':
      return 'assets.external';
    case 'playtest.control':
      return 'playtest.control';
  }
}

export function requiredCapabilities(tool: ToolDefinition): readonly Capability[] {
  const effects = tool.effects ?? effectsForTool(tool.name, tool.category);
  return [...new Set(effects.map((effect) => capabilityForEffect(effect, tool.name, tool.category)))];
}

export function parseCapabilities(value: string | undefined): Set<Capability> | undefined {
  if (!value?.trim()) return undefined;
  return new Set(value.split(',').map((entry) => entry.trim()).filter(Boolean) as Capability[]);
}

export function parseClientCapabilities(value: string | undefined): Map<string, Set<Capability>> {
  if (!value?.trim()) return new Map();
  const parsed = JSON.parse(value) as Record<string, Capability[]>;
  return new Map(Object.entries(parsed).map(([token, capabilities]) => [token, new Set(capabilities)]));
}
