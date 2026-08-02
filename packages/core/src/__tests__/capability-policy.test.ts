import { parseCapabilities, parseClientCapabilities, requiredCapabilities, requiredCapability } from '../capability-policy.js';
import { TOOL_DEFINITIONS } from '../tools/definitions.js';

describe('capability policy', () => {
  test('maps sensitive tools to narrow capabilities', () => {
    expect(requiredCapability('get_instance_children', 'read')).toBe('read.scene');
    expect(requiredCapability('set_property', 'write')).toBe('write.properties');
    expect(requiredCapability('delete_object', 'write')).toBe('write.instances');
    expect(requiredCapability('execute_luau', 'write')).toBe('execute.luau');
    expect(requiredCapability('run_gameplay_assertions', 'write')).toBe('execute.luau');
    expect(requiredCapability('run_playtest_episode', 'write')).toBe('execute.luau');
    expect(requiredCapability('insert_asset', 'write')).toBe('assets.external');
    expect(requiredCapability('start_playtest', 'write')).toBe('playtest.control');
  });

  test('requires every declared local and Studio effect capability', () => {
    expect(TOOL_DEFINITIONS.some((tool) => tool.name === 'sync_pull')).toBe(false);
    expect(TOOL_DEFINITIONS.some((tool) => tool.name === 'sync_status')).toBe(false);
    expect(TOOL_DEFINITIONS.some((tool) => tool.name === 'sync_push')).toBe(false);

    const rojoPatch = TOOL_DEFINITIONS.find((tool) => tool.name === 'rojo_patch_source')!;
    expect(requiredCapabilities(rojoPatch)).toEqual([
      'local.files.read',
      'local.files.write',
      'local.process.execute',
    ]);

    const rojoCreate = TOOL_DEFINITIONS.find((tool) => tool.name === 'rojo_create_source')!;
    expect(requiredCapabilities(rojoCreate)).toEqual([
      'local.files.read',
      'local.files.write',
      'local.process.execute',
    ]);
  });

  test('parses stdio and per-token capability sets', () => {
    expect(parseCapabilities('read.scene, write.properties')).toEqual(new Set(['read.scene', 'write.properties']));
    expect(parseClientCapabilities('{"client-a":["read.scene"]}').get('client-a')).toEqual(new Set(['read.scene']));
  });
});
