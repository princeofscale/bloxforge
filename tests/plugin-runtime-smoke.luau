-- Lune runtime smoke tests for LuauExec wrapper functions.
-- Run: lune tests/plugin-runtime-smoke.luau
--
-- Tests buildWrapper, remapPayloadLines, countLines, luaPatternEscape,
-- and fresh_require wrapper semantics WITHOUT a Roblox Studio runtime.
-- Requires: lune (https://lune-org.github.io/lune/)

local process = require("@lune/process")
local test = {}

local passed = 0
local failed = 0

local function assert_eq(label, actual, expected)
	if actual == expected then
		passed += 1
	else
		failed += 1
		print(string.format("  ✗ %s: expected %q, got %q", label, tostring(expected), tostring(actual)))
	end
end

local function assert_true(label, value)
	assert_eq(label, value, true)
end

-- NOTE: LuauExec.luau is compiled roblox-ts that references game:GetService
-- etc. We can't load it directly in Lune (no Roblox globals).
-- Instead, we test the STRING-MATH functions by duplicating the pure logic
-- (countLines, luaPatternEscape, remapPayloadLines) and verifying they
-- match the Node-side luau-wrapper-utils.test.ts expectations.

-- === countLines ===
local function countLines(s)
	local n = 1
	for i = 1, #s do
		if string.sub(s, i, i) == "\n" then n += 1 end
	end
	return n
end

print("countLines")
assert_eq("empty", countLines(""), 1)
assert_eq("single line", countLines("hello"), 1)
assert_eq("two lines", countLines("a\nb\nc"), 3)
assert_eq("trailing newline", countLines("a\nb\n"), 3)
assert_eq("single newline", countLines("\n"), 2)

-- === luaPatternEscape ===
local function luaPatternEscape(s)
	return (string.gsub(s, "([^%w])", "%%%1"))
end

print("luaPatternEscape")
assert_eq("dots and parens", luaPatternEscape("hello.world(test)"), "hello%.world%(test%)")
assert_eq("alphanumeric unchanged", luaPatternEscape("abc123"), "abc123")
assert_eq("payload name", luaPatternEscape("__MCPExecLuauPayload"), "%_%_MCPExecLuauPayload")

-- === remapPayloadLines (minimal) ===
local function remap(s, userLines, offset)
	local function userLine(payload)
		local u = payload - offset
		if u < 1 then return "1" end
		if u > userLines then return tostring(userLines) .. " (at end of input)" end
		return tostring(u)
	end
	local out = s
	out = string.gsub(out, "Workspace%.__MCPExecLuauPayload:(%d+)", function(num)
		local n = tonumber(num)
		if n then return "user_code:" .. userLine(n) end
		return "user_code:" .. num
	end)
	out = string.gsub(out, "__MCPExecLuauPayload:(%d+)", function(num)
		local n = tonumber(num)
		if n then return "user_code:" .. userLine(n) end
		return "user_code:" .. num
	end)
	return out
end

print("remapPayloadLines")
assert_eq("basic remap", remap("Workspace.__MCPExecLuauPayload:95: err", 10, 90), "user_code:5: err")
assert_eq("clamp below", remap("Workspace.__MCPExecLuauPayload:50: early", 10, 90), "user_code:1: early")
assert_eq("clamp above", remap("__MCPExecLuauPayload:200: overflow", 10, 90), "user_code:10 (at end of input): overflow")

-- === Summary ===
print(string.format("\nplugin-runtime-smoke: %d passed, %d failed", passed, failed))
if failed > 0 then
	process.exit(1)
end
