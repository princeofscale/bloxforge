import { getReadOnlyTools, TOOL_DEFINITIONS, type ToolDefinition } from '../tools/definitions.js';
import { isInspectorTool } from '../tools/tool-effects.js';
import { authorizedToolsForProfile } from '../server.js';
import { ENDPOINT_SOURCE } from '../protocol-endpoints.generated.js';

const READ_ENDPOINTS = new Set<string>(ENDPOINT_SOURCE.read);

const tool = (over: Partial<ToolDefinition>): ToolDefinition => ({
  name: 'x', description: '', category: 'read', effects: ['studio.read'], inputSchema: {}, ...over,
});

describe('inspector tool surface', () => {
  // The inspector plugin answers the manifest's read endpoints and rejects
  // everything else. Advertising a tool it will refuse costs a round trip and
  // returns an error that reads as a broken server rather than as a tool that
  // was never there.
  it('drops a tool that drives a non-read endpoint even when every effect is inspector-safe', () => {
    expect(isInspectorTool(tool({ effects: ['studio.read'] }))).toBe(true);
    expect(isInspectorTool(tool({
      effects: ['studio.read'],
      bridgeEndpoints: ['/api/execute-luau'],
    }))).toBe(false);
    // An empty declaration is not a loophole.
    expect(isInspectorTool(tool({ effects: ['studio.read'], bridgeEndpoints: [] }))).toBe(true);
  });

  it('applies the same rule to the inspector profile of a full server', () => {
    const tools = [
      tool({ name: 'get_place_info' }),
      tool({ name: 'get_world_snapshot', bridgeEndpoints: ['/api/execute-luau'] }),
    ];
    expect(authorizedToolsForProfile(tools, 'inspector').map((t) => t.name)).toEqual(['get_place_info']);
  });

  it('never advertises a tool whose declared endpoints are outside the read set', () => {
    for (const t of getReadOnlyTools()) {
      expect(t.bridgeEndpoints ?? []).toEqual([]);
    }
  });

  // A declared endpoint outside the read set is the whole point of the field;
  // one inside it is a declaration that says nothing and will rot.
  it('only declares endpoints the manifest does not already classify as reads', () => {
    for (const t of TOOL_DEFINITIONS) {
      for (const endpoint of t.bridgeEndpoints ?? []) {
        expect(READ_ENDPOINTS.has(endpoint)).toBe(false);
      }
    }
  });

  // Named rather than counted: these eleven were advertised by the inspector
  // and failed every call with "BloxForge Inspector is read-only and rejected
  // endpoint", because they compute a read-only answer by running
  // server-generated Luau through /api/execute-luau. Dropping the declaration
  // from any of them puts it straight back on the inspector's tool list.
  it('keeps the generated-Luau read tools off the inspector', () => {
    const inspector = new Set(getReadOnlyTools().map((t) => t.name));
    const byName = new Map(TOOL_DEFINITIONS.map((t) => [t.name, t]));
    for (const name of [
      'get_world_snapshot', 'scene_search', 'get_node_batch', 'get_spatial_layout',
      'get_changes_since', 'design_lint', 'asset_fit_plan', 'asset_sanitize_plan',
      'get_reproduction_bundle', 'get_device_simulator_state', 'get_simulation_state',
    ]) {
      expect(byName.get(name)?.bridgeEndpoints).toEqual(['/api/execute-luau']);
      expect(inspector.has(name)).toBe(false);
    }
  });
});
