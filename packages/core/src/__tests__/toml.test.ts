import { parseToml } from '../toolchain/toml.js';

describe('TOML reader', () => {
  test('parses a rokit.toml manifest', () => {
    expect(parseToml(`
# Toolchain
[tools]
rojo = "rojo-rbx/rojo@7.7.0"
wally = "UpliftGames/wally@0.3.2"
`)).toEqual({ tools: { rojo: 'rojo-rbx/rojo@7.7.0', wally: 'UpliftGames/wally@0.3.2' } });
  });

  test('parses a wally.toml manifest with several dependency realms', () => {
    expect(parseToml(`
[package]
name = "biff/minimal"
version = "0.1.0"
registry = "https://github.com/UpliftGames/wally-index"
realm = "shared"

[dependencies]
Roact = "roblox/roact@1.4.4"

[server-dependencies]
Datastore = "kampfkarren/datastore@1.0.0"
`)).toEqual({
      package: {
        name: 'biff/minimal',
        version: '0.1.0',
        registry: 'https://github.com/UpliftGames/wally-index',
        realm: 'shared',
      },
      dependencies: { Roact: 'roblox/roact@1.4.4' },
      'server-dependencies': { Datastore: 'kampfkarren/datastore@1.0.0' },
    });
  });

  test('parses repeated [[package]] blocks in a wally.lock', () => {
    const lock = parseToml(`
registry = "https://github.com/UpliftGames/wally-index"

[[package]]
name = "biff/minimal"
version = "0.1.0"
dependencies = []

[[package]]
name = "roblox/roact"
version = "1.4.4"
checksum = "abc123"
dependencies = [["Symbol", "roblox/symbol@2.0.1"]]
`);
    expect(lock.registry).toBe('https://github.com/UpliftGames/wally-index');
    // The old regexp returned TOML key names such as "name" and "dependencies".
    expect((lock.package as Array<Record<string, unknown>>).map((entry) => entry.name))
      .toEqual(['biff/minimal', 'roblox/roact']);
    expect((lock.package as Array<Record<string, unknown>>)[1].dependencies)
      .toEqual([['Symbol', 'roblox/symbol@2.0.1']]);
  });

  test('handles dotted keys, inline tables, literals and numbers', () => {
    expect(parseToml(`
a.b = 1
c = { d = true, e = -2.5 }
f = 'literal \\ value'
g = """
multi
line"""
`)).toEqual({
      a: { b: 1 },
      c: { d: true, e: -2.5 },
      f: 'literal \\ value',
      g: 'multi\nline',
    });
  });

  test('throws instead of guessing at malformed or unsupported input', () => {
    expect(() => parseToml('name = ')).toThrow(/Invalid TOML/);
    expect(() => parseToml('a = 1\na = 2')).toThrow(/duplicate key/);
    expect(() => parseToml('a = "unterminated')).toThrow(/unterminated string/);
    expect(() => parseToml('when = 1979-05-27T07:32:00Z')).toThrow(/unsupported value/);
  });
});
