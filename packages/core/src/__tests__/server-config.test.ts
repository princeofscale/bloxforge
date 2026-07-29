import { authorizedToolsForProfile, shouldUseLazyToolLoading, toolProfileDomains } from '../server.js';
import type { ToolDefinition } from '../tools/definitions.js';

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
      { name: 'get_place_info', description: '', category: 'read', inputSchema: {} },
      { name: 'set_property', description: '', category: 'write', inputSchema: {} },
      { name: 'execute_luau', description: '', category: 'write', inputSchema: {} },
      { name: 'execute_luau_async', description: '', category: 'write', inputSchema: {} },
      { name: 'eval_server_runtime', description: '', category: 'write', inputSchema: {} },
    ];

    expect(authorizedToolsForProfile(tools, 'inspector').map((tool) => tool.name))
      .toEqual(['get_place_info']);
    expect(authorizedToolsForProfile(tools, 'builder').map((tool) => tool.name))
      .toEqual(['get_place_info', 'set_property']);
    expect(authorizedToolsForProfile(tools, 'full')).toEqual(tools);
  });
});
