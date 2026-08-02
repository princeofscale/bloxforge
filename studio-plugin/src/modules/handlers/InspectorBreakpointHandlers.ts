// Inspector builds redirect BreakpointHandlers here and omit the debugger
// implementation entirely.
//
// The exported shape has to mirror the real module's `export =` surface: the
// callers are compiled against that one and the redirect happens afterwards, on
// the emitted Luau. An `export default` object arrives as `{ default = … }`, so
// every call through it — `BreakpointHandlers.init(plugin)` in the server
// bootstrap, `BreakpointHandlers.breakpoints(…)` in ClientBroker — indexes nil.
function breakpoints(_requestData: Record<string, unknown>): unknown {
	return { error: "BloxForge Inspector is read-only and rejected endpoint: /api/breakpoints" };
}

function init(_plugin: Plugin): void {}

export = { breakpoints, init };
