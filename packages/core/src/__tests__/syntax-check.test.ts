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

  it('names the chunk, so the source cannot appear in its own error prefix', () => {
    expect(buildSyntaxCheckLuau('print(1)')).toContain(', "bloxforge_syntax_check")');
  });
});

describe('parseSyntaxError', () => {
  it('splits the Luau location off the message', () => {
    // The chunk name is ours, so it is noise to the caller.
    const raw = '[string "bloxforge_syntax_check"]:2: Expected identifier when parsing expression, got \'then\'';
    expect(parseSyntaxError(raw)).toEqual({
      message: "Expected identifier when parsing expression, got 'then'",
      line: 2,
    });
  });

  it('accepts the bare chunk name too, since the decoration is the host\'s choice', () => {
    expect(parseSyntaxError('bloxforge_syntax_check:12: Malformed string'))
      .toEqual({ message: 'Malformed string', line: 12 });
  });

  it('is not fooled by a source that looks like a location prefix', () => {
    // Before the chunk was named, the source WAS the chunk name, so a script
    // containing `"]:9:` gave the lazy scan an earlier, wrong thing to match.
    const raw = '[string "bloxforge_syntax_check"]:7: Malformed string near \'"]:9: gotcha\'';
    expect(parseSyntaxError(raw)).toEqual({
      message: 'Malformed string near \'"]:9: gotcha\'',
      line: 7,
    });
  });

  it('passes through a message with no location rather than mangling it', () => {
    expect(parseSyntaxError('something unexpected')).toEqual({ message: 'something unexpected' });
    expect(parseSyntaxError('')).toEqual({ message: '' });
    // A foreign chunk name is not ours to strip.
    expect(parseSyntaxError('[string "other"]:3: nope'))
      .toEqual({ message: '[string "other"]:3: nope' });
  });
});
