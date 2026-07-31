import type { ToolEffect } from './definitions.js';

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
