import { resolveBridgeHost } from '../server.js';

describe('resolveBridgeHost', () => {
  test('defaults to IPv4 loopback and preserves explicit opt-in hosts', () => {
    expect(resolveBridgeHost(undefined)).toBe('127.0.0.1');
    expect(resolveBridgeHost('0.0.0.0')).toBe('0.0.0.0');
  });
});
