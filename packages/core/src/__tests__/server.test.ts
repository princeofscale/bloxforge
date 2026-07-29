import { resolveBridgeHost, resolveBridgePort } from '../server.js';

describe('resolveBridgeHost', () => {
  test('defaults to IPv4 loopback and preserves explicit opt-in hosts', () => {
    expect(resolveBridgeHost(undefined)).toBe('127.0.0.1');
    expect(resolveBridgeHost('0.0.0.0')).toBe('0.0.0.0');
  });
});

describe('resolveBridgePort', () => {
  test('defaults to the Studio bridge port and accepts a valid override', () => {
    expect(resolveBridgePort(undefined)).toBe(58741);
    expect(resolveBridgePort('6000')).toBe(6000);
  });

  test.each(['0', '65536', 'abc', '123.5'])('rejects invalid port %s', (value) => {
    expect(() => resolveBridgePort(value)).toThrow(/Invalid Roblox Studio bridge port/);
  });
});
