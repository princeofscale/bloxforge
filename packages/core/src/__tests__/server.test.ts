import {
  assertSecureBridgeBinding,
  isLoopbackHost,
  resolveBridgeHost,
  resolveBridgePort,
} from '../server.js';

describe('resolveBridgeHost', () => {
  test('defaults to IPv4 loopback and preserves explicit opt-in hosts', () => {
    expect(resolveBridgeHost(undefined)).toBe('127.0.0.1');
    expect(resolveBridgeHost('0.0.0.0')).toBe('0.0.0.0');
  });

  test.each([
    '127.0.0.1',
    '127.0.0.42',
    '::1',
    '0:0:0:0:0:0:0:1',
    '::ffff:127.0.0.1',
    'localhost',
    'LOCALHOST.',
    'localhost.localdomain',
    'ip6-localhost',
  ])('recognizes loopback host %s', (host) => {
    expect(isLoopbackHost(host)).toBe(true);
    expect(() => assertSecureBridgeBinding(host, undefined)).not.toThrow();
  });

  test.each(['0.0.0.0', '::', '192.168.1.20', 'example.test'])(
    'requires server authentication for non-loopback host %s',
    (host) => {
      expect(isLoopbackHost(host)).toBe(false);
      expect(() => assertSecureBridgeBinding(host, undefined)).toThrow(/BLOXFORGE_SESSION_TOKEN/);
      expect(() => assertSecureBridgeBinding(host, 'secret')).not.toThrow();
    },
  );

  test.each(['http://127.0.0.1', '127.0.0.1/path', '[::1]', 'bad host', '-bad.example'])(
    'rejects malformed bind host %s',
    (host) => {
      expect(() => assertSecureBridgeBinding(host, 'secret')).toThrow(/Invalid Roblox Studio bridge host/);
    },
  );
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
