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

/**
 * Emit each expression as an inline function rather than `loadstring`-ing it.
 *
 * `loadstring` is the obvious way to evaluate a string expression, and it works
 * in the edit plugin context — but calling it on a *runtime* peer throws
 * "loadstring() is not available", because `ServerScriptService.LoadStringEnabled`
 * is off by default. So `target: "server"` — the pairing this tool's own
 * description recommends, and the only one that can see live state — could not
 * evaluate a single assertion on a default place. It reported them as failures,
 * which is how an infrastructure gap came back looking like a game regression.
 *
 * `execute_luau` reaches the runtime peer fine, because the plugin falls back to
 * a ModuleScript require when loadstring is unavailable. Emitting the expressions
 * into the chunk we are already sending puts them through that same path, so no
 * second compiler is needed.
 *
 * Names still ride as JSON data and are never interpolated into code; only `expr`
 * is, which is exactly what loadstring did with it.
 */
export function buildGameplayAssertionsLuau(assertions: GameplayAssertion[]): string {
  const names = JSON.stringify(JSON.stringify(assertions.map((a) => a.name)));
  // The closing `) end)` goes on its own line. On one line, an expr ending in a
  // `--` comment eats them and takes the whole batch with it — verified live:
  // `true -- explanation` gave "Expected ')' (to close '(' at line 131), got
  // 'check'", so one commented assertion failed every other assertion too.
  const checks = assertions
    .map((a, index) => `check(${index + 1}, function() return (\n${a.expr}\n) end)`)
    .join('\n');
  return `local HttpService = game:GetService("HttpService")
local names = HttpService:JSONDecode(${names})
local results = {}
local passed, failed = 0, 0
local function check(index, fn)
\tlocal r = { name = names[index] }
\tlocal ok, val = pcall(fn)
\tif not ok then
\t\tr.passed = false
\t\tr.error = tostring(val)
\t\tfailed = failed + 1
\telse
\t\tr.passed = (val and true or false)
\t\tr.value = tostring(val)
\t\tif r.passed then passed = passed + 1 else failed = failed + 1 end
\tend
\ttable.insert(results, r)
end
${checks}
return { results = results, summary = { total = #names, passed = passed, failed = failed }, allPassed = failed == 0 }`;
}
