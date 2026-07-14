import { PROTOCOL_MANIFEST, protocolPolicy } from '../protocol-manifest.js';

describe('protocol manifest', () => {
  test('has unique prefixes and shared timeout/mutation policies', () => {
    expect(new Set(PROTOCOL_MANIFEST.map((entry) => entry.endpoint)).size).toBe(PROTOCOL_MANIFEST.length);
    expect(protocolPolicy('/api/execute-luau').timeoutClass).toBe('heavy');
    expect(protocolPolicy('/api/delete-object').mode).toBe('mutation');
    expect(protocolPolicy('/api/edit-script-lines').mode).toBe('mutation');
    expect(protocolPolicy('/api/add-tag').mode).toBe('mutation');
    expect(protocolPolicy('/api/insert-asset').mode).toBe('mutation');
    expect(protocolPolicy('/api/mass-get-property').mode).toBe('read');
    expect(protocolPolicy('/api/get-instance-children').retryPolicy).toBe('safe-read');
  });
});
