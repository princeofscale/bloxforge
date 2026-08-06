import { RuntimeTools } from '../tools/runtime-tools.js';
import { TOOL_HANDLERS } from '../http-server.js';

// The plugin has recorded an Undo waypoint for any script that arrives with an
// undoLabel since the feature was written, but only generated builders were
// sending one. A caller writing its own mutation through execute_luau — the
// most general write path there is — had no way to reach that mechanism, so the
// edit landed outside the undo stack and Ctrl+Z would not take it back.

function toolsWithSpy() {
  const calls: Array<{ endpoint: string; payload: Record<string, unknown> }> = [];
  const runtime = {
    callSingle: async (endpoint: string, payload: Record<string, unknown>) => {
      calls.push({ endpoint, payload });
      return { ok: true };
    },
    safetyGate: () => undefined,
    recordOperation: () => undefined,
  };
  return { calls, tools: new RuntimeTools(runtime as never) };
}

describe('execute_luau undo waypoints', () => {
  it('forwards a declared label so the edit lands in the undo stack', async () => {
    const { calls, tools } = toolsWithSpy();
    await tools.executeLuau('workspace.Baseplate:Destroy()', undefined, undefined, undefined, 'delete baseplate');
    expect(calls[0].endpoint).toBe('/api/execute-luau');
    expect(calls[0].payload).toEqual({ code: 'workspace.Baseplate:Destroy()', undoLabel: 'delete baseplate' });
  });

  it('sends no label for a read, because an empty recording is worse than none', async () => {
    const { calls, tools } = toolsWithSpy();
    await tools.executeLuau('return #workspace:GetChildren()');
    expect(calls[0].payload).toEqual({ code: 'return #workspace:GetChildren()' });
    expect(calls[0].payload).not.toHaveProperty('undoLabel');
  });

  it('treats an empty label as no label rather than recording under ""', async () => {
    const { calls, tools } = toolsWithSpy();
    await tools.executeLuau('return 1', undefined, undefined, undefined, '');
    expect(calls[0].payload).not.toHaveProperty('undoLabel');
  });

  it('reaches the tool through the dispatch table both transports share', async () => {
    const seen: Array<unknown[]> = [];
    const fake = { executeLuau: async (...args: unknown[]) => { seen.push(args); return { content: [] }; } };
    await TOOL_HANDLERS.execute_luau(fake as never, { code: 'x = 1', undoLabel: 'set x' } as never);
    // code, target, instance_id, safety options, undoLabel
    expect(seen[0][4]).toBe('set x');
  });
});
