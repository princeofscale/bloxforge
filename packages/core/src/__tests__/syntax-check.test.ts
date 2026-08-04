import { buildSyntaxCheckLuau, parseSyntaxError } from '../builders/syntax-check.js';

// validate_script_source shelled out to three optional binaries, so on a machine
// without them it answered with nothing but "is not installed" — a typo could
// only be found by writing the script into the place and burning a playtest.
// The plugin has loadstring, which compiles without running.

describe('buildSyntaxCheckLuau', () => {
  it('compiles without executing', () => {
    const code = buildSyntaxCheckLuau('print("hi")');
    expect(code).toContain('loadstring(');
    // The source must reach loadstring as a literal, never be spliced as code.
    expect(code).toContain('"print(\\"hi\\")"');
    expect(code).not.toMatch(/^print\("hi"\)/m);
  });

  it('escapes source that would otherwise break out of the literal', () => {
    const hostile = 'a") os.exit() --';
    const code = buildSyntaxCheckLuau(hostile);
    expect(code).not.toContain('loadstring("a") os.exit()');
    expect(code).toContain('\\"');
  });

  it('keeps newlines and backslashes intact', () => {
    const code = buildSyntaxCheckLuau('local p = "C:\\\\temp"\nprint(p)');
    expect(code).toContain('\\n');
    expect(code).toContain('\\\\\\\\');
  });
});

describe('parseSyntaxError', () => {
  it('splits the Luau location off the message', () => {
    // The chunk name is our own throwaway literal, so it is noise to the caller.
    const raw = '[string "local a = ..."]:2: Expected identifier when parsing expression, got \'then\'';
    expect(parseSyntaxError(raw)).toEqual({
      message: "Expected identifier when parsing expression, got 'then'",
      line: 2,
    });
  });

  it('handles a multi-line chunk name', () => {
    const raw = '[string "local a = 1\nlocal b ="]:12: Malformed string';
    expect(parseSyntaxError(raw)).toEqual({ message: 'Malformed string', line: 12 });
  });

  it('passes through a message with no location rather than mangling it', () => {
    expect(parseSyntaxError('something unexpected')).toEqual({ message: 'something unexpected' });
    expect(parseSyntaxError('')).toEqual({ message: '' });
  });
});
