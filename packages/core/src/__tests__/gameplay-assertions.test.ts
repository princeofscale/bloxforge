import { buildGameplayAssertionsLuau, type GameplayAssertion } from '../builders/gameplay-assertions.js';

const asserts: GameplayAssertion[] = [
  { name: 'terrain exists', expr: 'workspace:FindFirstChildOfClass("Terrain") ~= nil' },
  { name: 'has players', expr: '#game:GetService("Players"):GetPlayers() > 0' },
];

describe('buildGameplayAssertionsLuau', () => {
  it('decodes specs via JSONDecode and evaluates each expr in pcall', () => {
    const code = buildGameplayAssertionsLuau(asserts);
    expect(code).toContain('HttpService:JSONDecode(');
    expect(code).toContain('loadstring("return (" .. tostring(spec.expr) .. ")")');
    expect(code).toContain('local ok, val = pcall(fn)');
  });

  it('reports per-assertion pass/fail, compile errors, and an allPassed summary', () => {
    const code = buildGameplayAssertionsLuau(asserts);
    expect(code).toContain('r.passed = (val and true or false)');
    expect(code).toContain('compile error: ');
    expect(code).toContain('allPassed = failed == 0');
    expect(code).toContain('summary = { total = #specs, passed = passed, failed = failed }');
  });

  it('keeps names as data (not interpolated into code)', () => {
    const code = buildGameplayAssertionsLuau([{ name: 'x"]; os.exit()', expr: 'true' }]);
    expect(code).toContain('HttpService:JSONDecode(');
    expect(code).not.toContain('r = { name = x"]; os.exit()');
  });
});
