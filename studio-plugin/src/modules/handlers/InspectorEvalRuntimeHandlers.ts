// Inspector builds redirect EvalRuntimeHandlers here. This is the one that
// matters most: it keeps arbitrary Luau execution in the running DataModel out
// of the read-only plugin entirely, rather than merely refusing to route to it.
function evalRuntime(_requestData: Record<string, unknown>): unknown {
	return { error: "BloxForge Inspector is read-only and rejected endpoint: /api/eval-runtime" };
}

export = { evalRuntime };
