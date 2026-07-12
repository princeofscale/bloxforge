import { shouldUseLazyToolLoading, toolProfileDomains } from '../server.js';

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
});
