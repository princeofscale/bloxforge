import {
  PROTOCOL_MANIFEST,
  normalizeProtocolPluginVariant,
  pluginVariantSupportsEndpoint,
  protocolPolicy,
} from '../protocol-manifest.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('protocol manifest', () => {
  test('has unique prefixes and shared timeout/mutation policies', () => {
    expect(new Set(PROTOCOL_MANIFEST.map((entry) => entry.endpoint)).size).toBe(PROTOCOL_MANIFEST.length);
    expect(protocolPolicy('/api/execute-luau').timeoutClass).toBe('heavy');
    expect(protocolPolicy('/api/delete-object').mode).toBe('mutation');
    expect(protocolPolicy('/api/edit-script-lines').mode).toBe('mutation');
    expect(protocolPolicy('/api/add-tag').mode).toBe('mutation');
    expect(protocolPolicy('/api/insert-asset').mode).toBe('mutation');
    expect(protocolPolicy('/api/mass-get-property').mode).toBe('read');
    expect(protocolPolicy('/api/instance-children').retryPolicy).toBe('safe-read');
    expect(protocolPolicy('/api/read-managed-scripts')).toMatchObject({
      mode: 'read',
      pluginVariants: ['main', 'inspector'],
    });
  });

  test('classifies every compiled plugin endpoint exactly once', () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), '../../studio-plugin/src/modules/Communication.ts'),
      'utf8',
    );
    const pluginEndpoints = [...source.matchAll(/^\s*"(?<endpoint>\/api\/[^"]+)":/gm)]
      .map((match) => match.groups!.endpoint)
      .sort();
    const manifestEndpoints = PROTOCOL_MANIFEST.map((entry) => entry.endpoint).sort();

    expect(pluginEndpoints).toEqual(manifestEndpoints);
  });

  test('keeps the plugin-side inspector allowlist synchronized with the manifest', () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), '../../studio-plugin/src/modules/Communication.ts'),
      'utf8',
    );
    const allowlist = source.match(
      /const inspectorAllowedEndpoints = new Set<string>\(\[([\s\S]*?)\]\);/,
    );
    expect(allowlist).not.toBeNull();
    const pluginEndpoints = [...allowlist![1].matchAll(/"(?<endpoint>\/api\/[^"]+)"/g)]
      .map((match) => match.groups!.endpoint)
      .sort();
    const manifestEndpoints = PROTOCOL_MANIFEST
      .filter((entry) => entry.pluginVariants.includes('inspector'))
      .map((entry) => entry.endpoint)
      .sort();

    expect(pluginEndpoints).toEqual(manifestEndpoints);
  });

  test('normalizes the historical full name but denies inspector mutations', () => {
    expect(normalizeProtocolPluginVariant('full')).toBe('main');
    expect(pluginVariantSupportsEndpoint('/api/file-tree', 'inspector')).toBe(true);
    expect(pluginVariantSupportsEndpoint('/api/delete-object', 'inspector')).toBe(false);
    expect(pluginVariantSupportsEndpoint('/api/delete-object', 'main')).toBe(true);
  });

  test('fails closed for unknown endpoints', () => {
    expect(() => protocolPolicy('/api/not-a-real-endpoint')).toThrow(/Unknown plugin endpoint/);
  });
});
