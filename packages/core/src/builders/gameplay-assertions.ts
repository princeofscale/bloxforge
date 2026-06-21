// Gameplay assertions (research review #7 — close the fix→verify loop). Run a typed
// list of named boolean assertions against the (live or edit) DataModel and get a
// structured pass/fail per assertion — the QA primitive that lets an agent PROVE a
// fix rather than declare it. Each assertion's `expr` is a Luau expression evaluated
// in plugin context (same trust model as execute_luau). Runs via execute-luau; pair
// with start_playtest + target="server" to assert live runtime state.

export interface GameplayAssertion {
  name: string;
  expr: string;
}

export function buildGameplayAssertionsLuau(assertions: GameplayAssertion[]): string {
  // Specs ride as JSONDecode data; only `expr` is loadstring'd (intentional — these
  // are assertions). Names/structure are never interpolated into code.
  const json = JSON.stringify(JSON.stringify(assertions));
  return `local HttpService = game:GetService("HttpService")
local specs = HttpService:JSONDecode(${json})
local results = {}
local passed, failed = 0, 0
for _, spec in ipairs(specs) do
\tlocal r = { name = spec.name }
\tlocal fn, compileErr = loadstring("return (" .. tostring(spec.expr) .. ")")
\tif not fn then
\t\tr.passed = false
\t\tr.error = "compile error: " .. tostring(compileErr)
\t\tfailed = failed + 1
\telse
\t\tlocal ok, val = pcall(fn)
\t\tif not ok then
\t\t\tr.passed = false
\t\t\tr.error = tostring(val)
\t\t\tfailed = failed + 1
\t\telse
\t\t\tr.passed = (val and true or false)
\t\t\tr.value = tostring(val)
\t\t\tif r.passed then passed = passed + 1 else failed = failed + 1 end
\t\tend
\tend
\ttable.insert(results, r)
end
return { results = results, summary = { total = #specs, passed = passed, failed = failed }, allPassed = failed == 0 }`;
}
