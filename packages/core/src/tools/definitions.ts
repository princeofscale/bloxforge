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
import { INTEGRATION_TOOL_DEFINITIONS } from './integration-registry.js';
import { UI_IR_TOOL_DEFINITIONS } from './ui-ir-registry.js';
import { withOutputSchemas } from './output-schemas.js';
import { isInspectorTool } from './tool-effects.js';

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
  /** Required, and never inferred from the name — see `tool-effects.ts`. */
  effects: readonly ToolEffect[];
  /**
   * Bridge endpoints this tool drives that are not in the manifest's `read`
   * set, declared only where that is not already obvious from `effects`.
   *
   * Effects describe what a tool does to the user's project; they say nothing
   * about which plugin route carries it. Those are different facts, and eleven
   * tools fell into the gap: `get_world_snapshot` and friends compute a
   * read-only answer by running server-generated Luau, so `studio.read` is an
   * honest effect — but the transport is `/api/execute-luau`, which the
   * inspector plugin refuses by design. The inspector advertised all eleven and
   * every one of them failed with "BloxForge Inspector is read-only and
   * rejected endpoint".
   *
   * Declared rather than derived, for the same reason `effects` is:
   * `scripts/check-endpoint-effects.mjs` cross-checks this against the
   * endpoints the source actually reaches, in both directions.
   */
  bridgeEndpoints?: readonly string[];
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
  ...INTEGRATION_TOOL_DEFINITIONS,
  ...UI_IR_TOOL_DEFINITIONS,
];

export const TOOL_DEFINITIONS: ToolDefinition[] = withOutputSchemas(RAW_TOOL_DEFINITIONS);

export const getReadOnlyTools = () => TOOL_DEFINITIONS.filter(isInspectorTool);
export const getAllTools = () => [...TOOL_DEFINITIONS];
