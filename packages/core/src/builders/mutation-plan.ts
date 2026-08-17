// Transactional batch mutations (research review #4). One typed plan → many small
// edits in a single round-trip, with a dry-run diff and a ready-to-run reverse plan
// ("rollback") in the receipt — stateless: the rollback IS another mutation plan, so
// no server-side handle/TTL is needed. Runs via execute-luau.
//
// Supported ops (safe, type-unambiguous subset; for Vector3/Color3/Enum properties
// use the existing set_property tool, which has full deserialization):
//   { op:"set_property",  target, property, value }   value: boolean | number | string
//   { op:"set_attribute", target, name, value }       value: boolean | number | string
//   { op:"add_tag",       target, tag }
//   { op:"remove_tag",    target, tag }

import { luaBool, PATH_RESOLVER_LUA } from './luau-emit.js';

export interface MutationOp {
  op: 'set_property' | 'set_attribute' | 'add_tag' | 'remove_tag';
  target: string;
  property?: string;
  name?: string;
  tag?: string;
  value?: boolean | number | string;
  expected?: boolean | number | string | null;
}

export function buildMutationPlanLuau(operations: MutationOp[], dryRun: boolean, atomic = true): string {
  // `expected: null` means "I expect no value here" — the guard that stops a
  // plan from creating an attribute someone else already created. JSON null
  // decodes to nil, and a nil `expected` is indistinguishable from no
  // `expected` at all, so the check the caller asked for used to be dropped and
  // the write went ahead. Carry the intent in a key that survives the decode.
  const encoded = operations.map((op) =>
    op.expected === null ? { ...op, expected: undefined, expectUnset: true } : op);
  // Operations travel as a JSON literal decoded inside Luau (HttpService:JSONDecode),
  // so user strings never interpolate into code — injection-safe.
  const opsJson = JSON.stringify(JSON.stringify(encoded));
  return `${PATH_RESOLVER_LUA}
local HttpService = game:GetService("HttpService")
local CollectionService = game:GetService("CollectionService")
local ops = HttpService:JSONDecode(${opsJson})
local dryRun = ${luaBool(dryRun)}
local atomic = ${luaBool(atomic)}

local function ser(v)
\tlocal t = typeof(v)
\tif t == "number" or t == "boolean" or t == "string" then return v end
\treturn tostring(v)
end

local results = {}
local rollback = {}
local succeeded, failed = 0, 0
local conflicts = {}

for index, op in ipairs(ops) do
\tif _G.__mcp and _G.__mcp.checkCancelled and _G.__mcp.checkCancelled() then return { applied = false, cancelled = true } end
\tif op.expected ~= nil or op.expectUnset then
\t\tlocal inst = resolvePath(op.target)
\t\tlocal current, readable = nil, true
\t\tif inst and op.op == "set_property" then
\t\t\t-- Reading a property that does not exist throws. Unguarded, a typo in a
\t\t\t-- precondition took down the whole plan with a raw Luau error instead of
\t\t\t-- reporting which check could not be made.
\t\t\tlocal ok, value = pcall(function() return inst[op.property] end)
\t\t\treadable = ok
\t\t\tif ok then current = ser(value) end
\t\telseif inst and op.op == "set_attribute" then
\t\t\tlocal before = inst:GetAttribute(op.name)
\t\t\tif before ~= nil then current = ser(before) end
\t\telseif inst and (op.op == "add_tag" or op.op == "remove_tag") then current = CollectionService:HasTag(inst, op.tag) end
\t\t-- An absent tag is false, not nil: "expect unset" on a tag means untagged.
\t\tlocal expected = op.expected
\t\tif op.expectUnset then
\t\t\texpected = nil
\t\t\tif op.op == "add_tag" or op.op == "remove_tag" then expected = false end
\t\tend
\t\tif not readable then
\t\t\ttable.insert(conflicts, { index = index, target = op.target, expected = expected, actual = nil, unreadable = true })
\t\telseif current ~= expected then
\t\t\ttable.insert(conflicts, { index = index, target = op.target, expected = expected, actual = current })
\t\tend
\tend
end

if #conflicts > 0 then
\treturn { applied = false, conflict = true, conflicts = conflicts, results = {}, rollback = {}, summary = { total = #ops, succeeded = 0, failed = 0 } }
end

for _, op in ipairs(ops) do
\tif _G.__mcp and _G.__mcp.checkCancelled and _G.__mcp.checkCancelled() then return { applied = false, cancelled = true, rollback = rollback } end
\tlocal r = { op = op.op, target = op.target }
\tlocal inst = resolvePath(op.target)
\tif not inst then
\t\tr.ok = false; r.error = "not found"; failed = failed + 1
\telse
\t\tif op.op == "set_property" then
\t\t\tlocal okb, before = pcall(function() return inst[op.property] end)
\t\t\tif okb then r.before = ser(before) end
\t\t\tr.property = op.property
\t\t\tif dryRun then
\t\t\t\tr.ok = true; r.wouldSet = ser(op.value)
\t\t\telse
\t\t\t\tlocal oks, err = pcall(function() inst[op.property] = op.value end)
\t\t\t\tr.ok = oks
\t\t\t\tif oks then
\t\t\t\t\tr.after = ser(op.value); succeeded = succeeded + 1
\t\t\t\t\tif okb then table.insert(rollback, { op = "set_property", target = op.target, property = op.property, value = ser(before) }) end
\t\t\t\telse r.error = tostring(err); failed = failed + 1 end
\t\t\tend
\t\telseif op.op == "set_attribute" then
\t\t\tlocal before = inst:GetAttribute(op.name)
\t\t\tif before ~= nil then r.before = ser(before) end
\t\t\tr.name = op.name
\t\t\tif dryRun then r.ok = true; r.wouldSet = ser(op.value)
\t\t\telse
\t\t\t\tlocal oks, err = pcall(function() inst:SetAttribute(op.name, op.value) end)
\t\t\t\tr.ok = oks
\t\t\t\tif oks then succeeded = succeeded + 1
\t\t\t\t\ttable.insert(rollback, { op = "set_attribute", target = op.target, name = op.name, value = before ~= nil and ser(before) or nil })
\t\t\t\telse r.error = tostring(err); failed = failed + 1 end
\t\t\tend
\t\telseif op.op == "add_tag" then
\t\t\tlocal had = CollectionService:HasTag(inst, op.tag)
\t\t\tif dryRun then r.ok = true
\t\t\telse local oks, err = pcall(function() CollectionService:AddTag(inst, op.tag) end)
\t\t\t\tr.ok = oks
\t\t\t\tif oks then succeeded = succeeded + 1
\t\t\t\t\tif not had then table.insert(rollback, { op = "remove_tag", target = op.target, tag = op.tag }) end
\t\t\t\telse r.error = tostring(err); failed = failed + 1 end
\t\t\tend
\t\telseif op.op == "remove_tag" then
\t\t\tlocal had = CollectionService:HasTag(inst, op.tag)
\t\t\tif dryRun then r.ok = true
\t\t\telse local oks, err = pcall(function() CollectionService:RemoveTag(inst, op.tag) end)
\t\t\t\tr.ok = oks
\t\t\t\tif oks then succeeded = succeeded + 1
\t\t\t\t\tif had then table.insert(rollback, { op = "add_tag", target = op.target, tag = op.tag }) end
\t\t\t\telse r.error = tostring(err); failed = failed + 1 end
\t\t\tend
\t\telse
\t\t\tr.ok = false; r.error = "unsupported op: " .. tostring(op.op); failed = failed + 1
\t\tend
\tend
\ttable.insert(results, r)
end

local rolledBack = false
local rollbackFailures = {}
if atomic and not dryRun and failed > 0 then
\trolledBack = true
\tfor i = #rollback, 1, -1 do
\t\tlocal op = rollback[i]
\t\tlocal inst = resolvePath(op.target)
\t\t-- A restore that fails used to be swallowed by a bare pcall, and the
\t\t-- receipt still said rolledBack = true. That reads as "nothing changed"
\t\t-- while the place is half-mutated, which is the one state a caller must
\t\t-- not be told is clean.
\t\tif not inst then
\t\t\ttable.insert(rollbackFailures, { op = op.op, target = op.target, error = "not found" })
\t\telse
\t\t\tlocal ok, err = pcall(function()
\t\t\t\tif op.op == "set_property" then inst[op.property] = op.value
\t\t\t\telseif op.op == "set_attribute" then inst:SetAttribute(op.name, op.value)
\t\t\t\telseif op.op == "add_tag" then CollectionService:AddTag(inst, op.tag)
\t\t\t\telseif op.op == "remove_tag" then CollectionService:RemoveTag(inst, op.tag) end
\t\t\tend)
\t\t\tif not ok then
\t\t\t\ttable.insert(rollbackFailures, { op = op.op, target = op.target, error = tostring(err) })
\t\t\tend
\t\tend
\tend
end

-- Only meaningful when a rollback was attempted. Reported unconditionally it
-- read as "the place is back where it started" for a plan that never rolled
-- anything back — including the atomic = false plan below, which leaves the
-- successful operations in place by design.
local rollbackComplete = nil
if rolledBack then rollbackComplete = #rollbackFailures == 0 end

-- Whether the place is in a state the caller did not ask for. Three ways in:
-- a rollback that could not finish, and a non-atomic plan where some operations
-- landed and others did not.
local partiallyApplied = false
if not dryRun then
\tif rolledBack then partiallyApplied = #rollbackFailures > 0
\telse partiallyApplied = failed > 0 and succeeded > 0 end
end

return {
\tapplied = not dryRun and not rolledBack,
\tdryRun = dryRun,
\tatomic = atomic,
\trolledBack = rolledBack,
\trollbackComplete = rollbackComplete,
\trollbackFailures = #rollbackFailures > 0 and rollbackFailures or nil,
\tpartiallyApplied = partiallyApplied,
\tresults = results,
\trollback = rollback,
\tsummary = { total = #ops, succeeded = succeeded, failed = failed },
}`;
}
