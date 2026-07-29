import { PROTOCOL_MANIFEST, protocolPolicy } from '../protocol-manifest.js';
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

  test('fails closed for unknown endpoints', () => {
    expect(() => protocolPolicy('/api/not-a-real-endpoint')).toThrow(/Unknown plugin endpoint/);
  });
});
