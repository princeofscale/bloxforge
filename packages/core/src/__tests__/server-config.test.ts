import { authorizedToolsForProfile, shouldUseLazyToolLoading, toolProfileDomains } from '../server.js';
import { getReadOnlyTools, TOOL_DEFINITIONS, type ToolDefinition } from '../tools/definitions.js';

describe('server config', () => {
  it('defaults lazy tool loading on as the primary discovery path', () => {
    expect(shouldUseLazyToolLoading(undefined)).toBe(true);
  });

  it('keeps lazy tool loading on for explicit truthy values', () => {
    expect(shouldUseLazyToolLoading('1')).toBe(true);
    expect(shouldUseLazyToolLoading('true')).toBe(true);
    expect(shouldUseLazyToolLoading('on')).toBe(true);
  });

  it('allows full upfront schemas as an explicit opt-out', () => {
    expect(shouldUseLazyToolLoading('0')).toBe(false);
    expect(shouldUseLazyToolLoading('false')).toBe(false);
    expect(shouldUseLazyToolLoading('off')).toBe(false);
  });

  it('maps BloxForge profiles to preloaded tool domains', () => {
    expect(toolProfileDomains('core')).toEqual([]);
    expect(toolProfileDomains('builder')).toContain('terrain');
    expect(toolProfileDomains('tester')).toContain('runtime');
    expect(toolProfileDomains('full')).toContain('sync');
    expect(toolProfileDomains('inspector')).not.toContain('mutation');
  });

  it('rejects unknown profiles instead of silently falling back', () => {
    expect(() => toolProfileDomains('typo')).toThrow(/Invalid BloxForge tool profile/);
  });

  it('enforces inspector and builder authorization independently of discovery', () => {
    const tools: ToolDefinition[] = [
      { name: 'get_place_info', description: '', category: 'read', effects: ['studio.read'], inputSchema: {} },
      { name: 'set_property', description: '', category: 'write', effects: ['studio.write'], inputSchema: {} },
      { name: 'execute_luau', description: '', category: 'write', effects: ['studio.execute'], inputSchema: {} },
      { name: 'execute_luau_async', description: '', category: 'write', effects: ['studio.execute'], inputSchema: {} },
      { name: 'eval_server_runtime', description: '', category: 'write', effects: ['studio.execute'], inputSchema: {} },
      { name: 'run_gameplay_assertions', description: '', category: 'write', effects: ['studio.execute'], inputSchema: {} },
      { name: 'run_playtest_episode', description: '', category: 'write', effects: ['studio.execute', 'playtest.control'], inputSchema: {} },
    ];

    expect(authorizedToolsForProfile(tools, 'inspector').map((tool) => tool.name))
      .toEqual(['get_place_info']);
    expect(authorizedToolsForProfile(tools, 'builder').map((tool) => tool.name))
      .toEqual(['get_place_info', 'set_property']);
    expect(authorizedToolsForProfile(tools, 'full')).toEqual(tools);
  });

  it('keeps local writes and process execution out of inspector authorization', () => {
    const byName = new Map(TOOL_DEFINITIONS.map((tool) => [tool.name, tool]));
    const inspectorNames = new Set(getReadOnlyTools().map((tool) => tool.name));

    expect(byName.get('sync_pull')).toMatchObject({
      effects: expect.arrayContaining(['studio.read', 'local.files.write']),
    });
    expect(inspectorNames).not.toContain('sync_pull');
    expect(inspectorNames).not.toContain('validate_script_source');
    expect(inspectorNames).not.toContain('run_quality_gate');
  });
});
