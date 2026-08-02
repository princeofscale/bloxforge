// Inspector builds redirect the server bootstrap here and omit the debugger
// implementation entirely.
const InspectorBreakpointHandlers = {
	init(_plugin: Plugin): void {},
};

export default InspectorBreakpointHandlers;
