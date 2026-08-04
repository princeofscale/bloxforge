import { buildGameplayAssertionsLuau, type GameplayAssertion } from '../builders/gameplay-assertions.js';

const asserts: GameplayAssertion[] = [
  { name: 'terrain exists', expr: 'workspace:FindFirstChildOfClass("Terrain") ~= nil' },
  { name: 'has players', expr: '#game:GetService("Players"):GetPlayers() > 0' },
];

describe('buildGameplayAssertionsLuau', () => {
  it('never calls loadstring, which a runtime peer refuses', () => {
    // Verified live: on a runtime peer `typeof(loadstring) == "function"` but
    // calling it throws "loadstring() is not available", because
    // ServerScriptService.LoadStringEnabled is off by default. So target:"server"
    // — the pairing this tool's own description recommends, and the only one that
    // can see live state — evaluated nothing and reported failures instead.
    const code = buildGameplayAssertionsLuau(asserts);
    expect(code).not.toContain('loadstring');
  });

  it('emits each expression as an inline function evaluated under pcall', () => {
    const code = buildGameplayAssertionsLuau(asserts);
    expect(code).toContain('check(1, function() return (workspace:FindFirstChildOfClass("Terrain") ~= nil) end)');
    expect(code).toContain('check(2, function() return (#game:GetService("Players"):GetPlayers() > 0) end)');
    expect(code).toContain('local ok, val = pcall(fn)');
  });

  it('defines the checker before the checks run', () => {
    const code = buildGameplayAssertionsLuau(asserts);
    expect(code.indexOf('local function check(')).toBeLessThan(code.indexOf('check(1,'));
  });

  it('reports per-assertion pass/fail and an allPassed summary', () => {
    const code = buildGameplayAssertionsLuau(asserts);
    expect(code).toContain('r.passed = (val and true or false)');
    expect(code).toContain('allPassed = failed == 0');
    expect(code).toContain('summary = { total = #names, passed = passed, failed = failed }');
  });

  it('keeps names as data (not interpolated into code)', () => {
    const code = buildGameplayAssertionsLuau([{ name: 'x"]; os.exit()', expr: 'true' }]);
    expect(code).toContain('HttpService:JSONDecode(');
    expect(code).not.toContain('r = { name = x"]; os.exit()');
  });

  it('wraps each expression in parentheses so an operator cannot leak out', () => {
    // `false or true` must stay one value rather than splitting the statement.
    const code = buildGameplayAssertionsLuau([{ name: 'either', expr: 'false or true' }]);
    expect(code).toContain('function() return (false or true) end');
  });
});
