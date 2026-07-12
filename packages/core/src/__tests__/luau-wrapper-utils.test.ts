import {
  countLines,
  luaPatternEscape,
  remapPayloadLines,
  computeWrapperLineOffset,
  renderWrapperForOffsetProbe,
} from '../luau-wrapper-utils.js';

describe('luau-wrapper-utils', () => {
  // --- countLines ----------------------------------------------------------

  describe('countLines', () => {
    it('returns 1 for empty string', () => {
      expect(countLines('')).toBe(1);
    });
    it('returns 1 for a single line without newline', () => {
      expect(countLines('hello')).toBe(1);
    });
    it('counts newlines correctly', () => {
      expect(countLines('a\nb\nc')).toBe(3);
    });
    it('counts trailing newline as an extra line', () => {
      expect(countLines('a\nb\n')).toBe(3);
    });
    it('handles single newline', () => {
      expect(countLines('\n')).toBe(2);
    });
    it('handles many lines', () => {
      const lines = Array(100).fill('x').join('\n');
      expect(countLines(lines)).toBe(100);
    });
  });

  // --- luaPatternEscape ----------------------------------------------------
  // Mirrors the Luau string.gsub(s, "([^%w])", "%%%1"): every non-%w
  // character gets a % prefix. Lua/Luau %w is alphanumeric; underscore is
  // therefore escaped.

  describe('luaPatternEscape', () => {
    it('escapes a dot', () => {
      expect(luaPatternEscape('hello.world')).toBe('hello%.world');
    });
    it('leaves alphanumeric unchanged', () => {
      expect(luaPatternEscape('abc123')).toBe('abc123');
    });
    it('escapes underscores (Lua %w does not include _)', () => {
      expect(luaPatternEscape('__MCPExecLuauPayload')).toBe('%_%_MCPExecLuauPayload');
    });
    it('escapes parentheses and brackets', () => {
      expect(luaPatternEscape('f(x)[y]')).toBe('f%(x%)%[y%]');
    });
    it('escapes a dash', () => {
      expect(luaPatternEscape('a-b')).toBe('a%-b');
    });
    it('escapes empty string', () => {
      expect(luaPatternEscape('')).toBe('');
    });
  });

  // --- remapPayloadLines ---------------------------------------------------

  describe('remapPayloadLines', () => {
    const offset = 90;

    it('remaps Workspace.__MCPExecLuauPayload:N to user_code:line', () => {
      const result = remapPayloadLines(
        'Workspace.__MCPExecLuauPayload:95: some error',
        10,
        offset,
      );
      expect(result).toBe('user_code:5: some error');
    });

    it('remaps bare __MCPExecLuauPayload:N', () => {
      const result = remapPayloadLines(
        '__MCPExecLuauPayload:96: some error',
        10,
        offset,
      );
      expect(result).toBe('user_code:6: some error');
    });

    it('remaps [string "..."]:N', () => {
      const result = remapPayloadLines(
        '[string "return ((function()..."]:95: some error',
        10,
        offset,
      );
      expect(result).toBe('user_code:5: some error');
    });

    it('clamps to 1 for lines before user code', () => {
      const result = remapPayloadLines(
        'Workspace.__MCPExecLuauPayload:50: early line',
        10,
        offset,
      );
      expect(result).toBe('user_code:1: early line');
    });

    it('clamps to userLines (at end of input) for lines after user code', () => {
      const result = remapPayloadLines(
        'Workspace.__MCPExecLuauPayload:200: overflow',
        10,
        offset,
      );
      expect(result).toBe('user_code:10 (at end of input): overflow');
    });

    it('handles multiple line references in one string', () => {
      const result = remapPayloadLines(
        'Workspace.__MCPExecLuauPayload:95 and __MCPExecLuauPayload:96',
        10,
        offset,
      );
      expect(result).toContain('user_code:5');
      expect(result).toContain('user_code:6');
    });

    it('uses custom payloadInstanceName', () => {
      const result = remapPayloadLines(
        'Workspace.CustomName:95: error',
        10,
        offset,
        'CustomName',
      );
      expect(result).toBe('user_code:5: error');
    });

    it('leaves non-matching text unchanged', () => {
      const result = remapPayloadLines('no line numbers here', 10, offset);
      expect(result).toBe('no line numbers here');
    });

    it('a line exactly at offset+1 maps to user_code:1', () => {
      const result = remapPayloadLines(
        'Workspace.__MCPExecLuauPayload:91: first user line',
        10,
        offset,
      );
      expect(result).toBe('user_code:1: first user line');
    });
  });

  // --- computeWrapperLineOffset -------------------------------------------

  describe('computeWrapperLineOffset', () => {
    it('returns a positive number consistent with the preamble', () => {
      const offset = computeWrapperLineOffset();
      expect(offset).toBeGreaterThan(0);
    });

    it('increments when extra preamble lines are added', () => {
      const base = computeWrapperLineOffset();
      const withExtra = computeWrapperLineOffset(['\tlocal __mcp_extra = 42']);
      expect(withExtra).toBe(base + 1);
    });

    it('the offset equals countLines(before-sentinel) - 1', () => {
      // Reconstruct the probe the same way computeWrapperLineOffset does and
      // verify the invariant holds for the current template.
      const probe = renderWrapperForOffsetProbe();
      const sentinelIdx = probe.indexOf('__MCP_USER_CODE_LINE__');
      const before = probe.substring(0, sentinelIdx);
      const offset = computeWrapperLineOffset();
      expect(countLines(before) - 1).toBe(offset);
    });
  });
});
