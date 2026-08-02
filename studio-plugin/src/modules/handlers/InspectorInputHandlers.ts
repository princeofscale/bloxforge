// Inspector builds redirect InputHandlers here so the read-only plugin does not
// package code that drives the mouse and keyboard. Mirrors the real module's
// `export =` surface — see InspectorBreakpointHandlers for why that matters.
function simulateMouseInput(_requestData: Record<string, unknown>): unknown {
	return { error: "BloxForge Inspector is read-only and rejected endpoint: /api/simulate-mouse-input" };
}

function simulateKeyboardInput(_requestData: Record<string, unknown>): unknown {
	return { error: "BloxForge Inspector is read-only and rejected endpoint: /api/simulate-keyboard-input" };
}

export = { simulateMouseInput, simulateKeyboardInput };
