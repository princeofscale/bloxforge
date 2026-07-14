/**
 * Pure-string utilities for the execute_luau wrapper — platform-neutral
 * reimplementations of the roblox-ts functions in
 * studio-plugin/src/modules/LuauExec.ts. Used here for unit-testing the
 * wrapper's line-offset, traceback remapping, and line-counting logic without
 * needing a Roblox Studio runtime (or Lune).
 *
 * The plugin source is the canonical implementation; this file exists so
 * regressions in the wrapper's string math surface in CI via jest.
 */

// --- countLines -----------------------------------------------------------

/** Count lines in a string (1 for empty). Mirrors LuauExec.countLines. */
export function countLines(s: string): number {
  if (s === '') return 1;
  let n = 1;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\n') n++;
  }
  return n;
}

// --- luaPatternEscape -----------------------------------------------------

/**
 * Escape a string for use as a Lua pattern (like string.gsub's second arg
 * with plain=true). Every character that is NOT in Lua's %w class gets a %
 * prefix. Lua/Luau %w is alphanumeric, so underscores are escaped. Mirrors
 * LuauExec.luaPatternEscape.
 */
export function luaPatternEscape(s: string): string {
  return s.replace(/([^A-Za-z0-9])/g, '%$1');
}

// --- remapPayloadLines ---------------------------------------------------

/**
 * Escape a string for safe embedding inside a JS RegExp. This is NOT the same
 * as luaPatternEscape (which escapes for Lua patterns). Used by remapPayloadLines
 * to safely build a RegExp from a user-supplied payload instance name.
 */
function jsRegexEscape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Remap payload module line numbers to user-relative line numbers, with
 * clamping. Mirrors the TS-side remapPayloadLines in LuauExec.ts.
 *
 * Handles two chunk-name formats:
 *   "Workspace.__MCPExecLuauPayload:N"
 *   "__MCPExecLuauPayload:N"
 *   "[string "..."]:N"
 */
export function remapPayloadLines(
  s: string,
  userLines: number,
  wrapperLineOffset: number,
  payloadInstanceName = '__MCPExecLuauPayload',
): string {
  const userLine = (payload: number): string => {
    const u = payload - wrapperLineOffset;
    if (u < 1) return '1';
    if (u > userLines) return `${userLines} (at end of input)`;
    return String(u);
  };
  const payloadPattern = jsRegexEscape(payloadInstanceName);

  let out = s;
  // Workspace.__MCPExecLuauPayload:N
  out = out.replace(
    new RegExp(`Workspace\\.${payloadPattern}:(\\d+)`, 'g'),
    (_match, num: string) => {
      const n = Number(num);
      return Number.isFinite(n) ? `user_code:${userLine(n)}` : `user_code:${num}`;
    },
  );
  // __MCPExecLuauPayload:N
  out = out.replace(
    new RegExp(`${payloadPattern}:(\\d+)`, 'g'),
    (_match, num: string) => {
      const n = Number(num);
      return Number.isFinite(n) ? `user_code:${userLine(n)}` : `user_code:${num}`;
    },
  );
  // [string "..."]:N
  out = out.replace(
    /\[string "[^"]+"\]:(\d+)/g,
    (_match, num: string) => {
      const n = Number(num);
      return Number.isFinite(n) ? `user_code:${userLine(n)}` : `user_code:${num}`;
    },
  );
  return out;
}

// --- renderWrapper (minimal) --------------------------------------------

/**
 * Minimal reimplementation of the wrapper rendering that's enough to
 * verify line-offset correctness. Returns the wrapper with `${code}`
 * replaced by a sentinel so we can count preamble lines.
 *
 * This does NOT need to reproduce the full wrapper — just the line count
 * must match the plugin's renderWrapper.
 */
export function renderWrapperForOffsetProbe(
  preambleExtraLines: string[] = [],
  codeSentinel = '__MCP_USER_CODE_LINE__',
): string {
  // Fixed preamble lines (mirroring the Luau template structure).
  // If the plugin template changes, update this array.
  const fixedPreamble = [
    'return (function()',
    '\tlocal __mcp_traceback',
    '\tlocal __mcp_remap',
    '\tlocal __mcp_LINE_OFFSET = 0',
    '\tlocal __mcp_USER_LINES = 0',
    '\tlocal __mcp_LogService = game:GetService("LogService")',
    '\tlocal __mcp_REQUIRE_GENERIC = "Requested module experienced an error while loading"',
    '\tlocal __mcp_output = {}',
    '\tlocal __mcp_real_print = print',
    '\tlocal __mcp_real_warn = warn',
    '\tlocal __mcp_real_require = require',
    '\tlocal print = function(...)',
    '\t\t__mcp_real_print(...)',
    '\t\tlocal args = {...}',
    '\t\tlocal parts = table.create(#args)',
    '\t\tfor i, a in ipairs(args) do parts[i] = tostring(a) end',
    '\t\ttable.insert(__mcp_output, table.concat(parts, "\\t"))',
    '\tend',
    '\tlocal warn = function(...)',
    '\t\t__mcp_real_warn(...)',
    '\t\tlocal args = {...}',
    '\t\tlocal parts = table.create(#args)',
    '\t\tfor i, a in ipairs(args) do parts[i] = tostring(a) end',
    '\t\ttable.insert(__mcp_output, "[warn] " .. table.concat(parts, "\\t"))',
    '\tend',
    '\tlocal function __mcp_is_stack_noise(msg)',
    '\t\treturn msg == "Stack Begin" or msg == "Stack End" or string.sub(msg, 1, 8) == "Script \'"',
    '\tend',
    '\tlocal function __mcp_is_actionable_require_log(entry)',
    '\t\tif not entry or entry.messageType ~= Enum.MessageType.MessageError then return false end',
    '\t\tlocal msg = tostring(entry.message)',
    '\t\treturn msg ~= __mcp_REQUIRE_GENERIC and not __mcp_is_stack_noise(msg)',
    '\tend',
    '\tlocal function __mcp_entry_mentions_module(entry, module_path)',
    '\t\tif not entry or not module_path or module_path == "" then return false end',
    '\t\treturn string.find(tostring(entry.message), module_path, 1, true) ~= nil',
    '\tend',
    '\tlocal function __mcp_prior_module_error(hist, module_path)',
    '\t\tif not module_path or module_path == "" then return nil end',
    '\t\tfor i = #hist, 1, -1 do',
    '\t\t\tlocal entry = hist[i]',
    '\t\t\tif __mcp_entry_mentions_module(entry, module_path) then',
    '\t\t\t\tif __mcp_is_actionable_require_log(entry) then',
    '\t\t\t\t\treturn tostring(entry.message)',
    '\t\t\t\tend',
    '\t\t\t\tfor j = i - 1, math.max(1, i - 6), -1 do',
    '\t\t\t\t\tlocal previous = hist[j]',
    '\t\t\t\t\tif __mcp_is_actionable_require_log(previous) then',
    '\t\t\t\t\t\treturn tostring(previous.message)',
    '\t\t\t\t\tend',
    '\t\t\t\tend',
    '\t\t\tend',
    '\t\tend',
    '\t\treturn nil',
    '\tend',
    '\tlocal function __mcp_recover_require_error(err, history_start, module)',
    '\t\tlocal err_msg = tostring(err)',
    '\t\tif err_msg ~= __mcp_REQUIRE_GENERIC then return err_msg end',
    '\t\tlocal module_path',
    '\t\tif typeof(module) == "Instance" then',
    '\t\t\tlocal ok_path, path = pcall(function()',
    '\t\t\t\treturn module:GetFullName()',
    '\t\t\tend)',
    '\t\t\tif ok_path then module_path = path end',
    '\t\tend',
    '\t\ttask.wait(0.05)',
    '\t\tlocal hist = __mcp_LogService:GetLogHistory()',
    '\t\tfor i = #hist, history_start + 1, -1 do',
    '\t\t\tlocal entry = hist[i]',
    '\t\t\tif __mcp_is_actionable_require_log(entry) then',
    '\t\t\t\treturn tostring(entry.message)',
    '\t\t\tend',
    '\t\tend',
    '\t\tlocal prior = __mcp_prior_module_error(hist, module_path)',
    '\t\tif prior then return prior end',
    '\t\treturn err_msg',
    '\tend',
    '\tlocal function require(module)',
    '\t\tlocal history_start = #__mcp_LogService:GetLogHistory()',
    '\t\tlocal ok, value = pcall(__mcp_real_require, module)',
    '\t\tif ok then return value end',
    '\t\terror(__mcp_recover_require_error(value, history_start, module), 0)',
    '\tend',
    '\tlocal function fresh_require(module)',
    '\t\tlocal clone = module:Clone()',
    '\t\tclone.Name = "__MCP_fresh_require_clone"',
    '\t\tclone.Parent = game:GetService("Workspace")',
    '\t\tlocal history_start = #__mcp_LogService:GetLogHistory()',
    '\t\tlocal ok, value = pcall(__mcp_real_require, clone)',
    '\t\tclone:Destroy()',
    '\t\tif ok then return value end',
    '\t\terror(__mcp_recover_require_error(value, history_start, clone), 0)',
    '\tend',
    '\t_G.fresh_require = fresh_require',
    '\tlocal function __mcp_run()',
  ];
  return [...fixedPreamble, ...preambleExtraLines, codeSentinel].join('\n');
}

/**
 * Compute the wrapper line offset by counting preamble lines before the
 * sentinel. Mirrors the plugin's computeWrapperLineOffset().
 */
export function computeWrapperLineOffset(
  extraPreambleLines: string[] = [],
): number {
  const probe = renderWrapperForOffsetProbe(extraPreambleLines);
  const idx = probe.indexOf('__MCP_USER_CODE_LINE__');
  if (idx === -1) throw new Error('sentinel not found');
  const before = probe.substring(0, idx);
  return countLines(before) - 1;
}
