import { BROWSING_TOOL_DEFINITIONS } from './definitions/browsing.js';
import { MUTATION_TOOL_DEFINITIONS } from './definitions/mutation.js';
import { SCRIPTING_TOOL_DEFINITIONS } from './definitions/scripting.js';
import { RUNTIME_TOOL_DEFINITIONS } from './definitions/runtime.js';
import { BUILD_TOOL_DEFINITIONS } from './definitions/builds.js';
import { ASSET_TOOL_DEFINITIONS } from './definitions/assets.js';
import { SCENE_TOOL_DEFINITIONS } from './definitions/scene.js';
import { GENERATED_TOOL_DEFINITIONS } from './definitions/generated.js';
import { META_TOOL_DEFINITIONS } from './definitions/meta.js';
import { ROJO_TOOL_DEFINITIONS } from './rojo-registry.js';
import { TOOLCHAIN_TOOL_DEFINITIONS } from './toolchain-registry.js';
import { withOutputSchemas } from './output-schemas.js';
import { effectsForTool, isInspectorEffect } from './tool-effects.js';

export type ToolCategory = 'read' | 'write';
export type ToolEffect =
  | 'studio.read'
  | 'studio.write'
  | 'studio.execute'
  | 'local.files.read'
  | 'local.files.write'
  | 'local.process.execute'
  | 'network.external'
  | 'assets.upload'
  | 'playtest.control';
export type JsonSchema = Record<string, unknown>;

export interface ToolDefinition {
  name: string;
  description: string;
  category: ToolCategory;
  effects?: readonly ToolEffect[];
  inputSchema: object;
  outputSchema?: JsonSchema;
}

const RAW_TOOL_DEFINITIONS: ToolDefinition[] = [
  ...BROWSING_TOOL_DEFINITIONS,
  ...MUTATION_TOOL_DEFINITIONS,
  ...SCRIPTING_TOOL_DEFINITIONS,
  ...RUNTIME_TOOL_DEFINITIONS,
  ...BUILD_TOOL_DEFINITIONS,
  ...ASSET_TOOL_DEFINITIONS,
  ...SCENE_TOOL_DEFINITIONS,
  ...GENERATED_TOOL_DEFINITIONS,
  ...META_TOOL_DEFINITIONS,
  ...ROJO_TOOL_DEFINITIONS,
  ...TOOLCHAIN_TOOL_DEFINITIONS,
];

export const withToolEffects = (tools: ToolDefinition[]): ToolDefinition[] =>
  tools.map((tool) => ({ ...tool, effects: tool.effects ?? effectsForTool(tool.name, tool.category) }));

export const TOOL_DEFINITIONS: ToolDefinition[] = withToolEffects(withOutputSchemas(RAW_TOOL_DEFINITIONS));

export const getReadOnlyTools = () => TOOL_DEFINITIONS.filter(
  (tool) => tool.effects?.every(isInspectorEffect),
);
export const getAllTools = () => [...TOOL_DEFINITIONS];
