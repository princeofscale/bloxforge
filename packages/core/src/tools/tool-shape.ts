import type { JsonSchema, ToolDefinition } from './definitions.js';

/** MCP tool annotations (hints a host uses to drive approval UX). All optional and
 *  advisory — a host treats them as untrusted unless the server itself is trusted. */
export interface McpToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface McpToolShape {
  name: string;
  description: string;
  inputSchema: object;
  outputSchema?: JsonSchema;
  annotations?: McpToolAnnotations;
}

// Write tools that may DESTROY or irreversibly overwrite existing state — hosts
// should confirm these even when auto-approving ordinary writes. (The dry-run/confirm
// safety gate already guards them server-side; this is the client-facing hint.)
const DESTRUCTIVE_TOOLS = new Set([
  'delete_object',
  'delete_attribute',
  'delete_script_lines',
  'set_script_source',
  'find_and_replace_in_scripts',
  'restore_script_backup',
  'mass_set_property',
  'bulk_set_attributes',
  'apply_mutation_plan',
  'terrain_clear_region',
  'reset_simulation_state',
  'import_scene',
  'import_build',
  'import_rbxm',
]);

// Tools that reach an EXTERNAL service (marketplace/Creator Store/asset CDN/image gen)
// rather than only the local Studio place — openWorldHint per the MCP spec.
const OPEN_WORLD_TOOLS = new Set([
  'marketplace_search',
  'marketplace_search_and_insert',
  'plan_asset_insert',
  'asset_preflight_insert',
  'insert_asset',
  'preview_asset',
  'search_assets',
  'get_asset_details',
  'get_asset_thumbnail',
  'upload_asset',
  'image_generate',
  'image_generate_and_upload',
]);

/** Advisory risk hints derived from the tool's category + small explicit sets. */
export function toolAnnotations(tool: ToolDefinition): McpToolAnnotations {
  const readOnly = tool.category === 'read';
  const annotations: McpToolAnnotations = { readOnlyHint: readOnly };
  if (!readOnly) annotations.destructiveHint = DESTRUCTIVE_TOOLS.has(tool.name);
  if (OPEN_WORLD_TOOLS.has(tool.name)) annotations.openWorldHint = true;
  return annotations;
}

export function toolDefinitionToMcpTool(tool: ToolDefinition): McpToolShape {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    ...(tool.outputSchema ? { outputSchema: tool.outputSchema } : {}),
    annotations: toolAnnotations(tool),
  };
}
