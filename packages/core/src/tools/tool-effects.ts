import type { ToolDefinition, ToolEffect } from './definitions.js';

/**
 * Effects are declared per tool, never inferred. They used to be guessed from
 * the tool's name: `/asset|marketplace|…|export_rbxm/` meant `network.external`,
 * so `export_rbxm` — which asks Studio for bytes and writes them to disk — was
 * marked as reaching the network and never as writing a local file, and
 * `get_asset_provenance`, which reads an in-memory map, was marked as both.
 *
 * A name pattern also fails in the dangerous direction: a new tool that does
 * reach the network gets no `network.external` unless its name happens to
 * match, and a capability policy would wave it through. `ToolDefinition.effects`
 * is therefore required, which makes an omission a compile error.
 */
export function isInspectorEffect(effect: ToolEffect): boolean {
  return effect === 'studio.read' || effect === 'local.files.read';
}

/**
 * Whether the inspector build can both advertise and actually serve this tool.
 *
 * Inspector-safe effects are necessary but not sufficient. The inspector plugin
 * answers only the manifest's `read` endpoints and rejects everything else, so a
 * tool that declares `bridgeEndpoints` — by definition, endpoints outside that
 * set — cannot work there however read-only its effects are. Advertising one
 * costs a round trip and returns "BloxForge Inspector is read-only and rejected
 * endpoint", which reads to an agent as a broken server rather than a tool that
 * was never available.
 */
export function isInspectorTool(tool: ToolDefinition): boolean {
  return tool.effects.every(isInspectorEffect) && (tool.bridgeEndpoints ?? []).length === 0;
}
