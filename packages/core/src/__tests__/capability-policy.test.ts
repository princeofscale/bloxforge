import { parseCapabilities, parseClientCapabilities, requiredCapability } from '../capability-policy.js';

describe('capability policy', () => {
  test('maps sensitive tools to narrow capabilities', () => {
    expect(requiredCapability('get_instance_children', 'read')).toBe('read.scene');
    expect(requiredCapability('set_property', 'write')).toBe('write.properties');
    expect(requiredCapability('delete_object', 'write')).toBe('write.instances');
    expect(requiredCapability('execute_luau', 'write')).toBe('execute.luau');
    expect(requiredCapability('insert_asset', 'write')).toBe('assets.external');
    expect(requiredCapability('start_playtest', 'write')).toBe('playtest.control');
  });

  test('parses stdio and per-token capability sets', () => {
    expect(parseCapabilities('read.scene, write.properties')).toEqual(new Set(['read.scene', 'write.properties']));
    expect(parseClientCapabilities('{"client-a":["read.scene"]}').get('client-a')).toEqual(new Set(['read.scene']));
  });
});
