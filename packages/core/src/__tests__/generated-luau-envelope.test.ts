import { RobloxStudioTools } from '../tools/index.js';
import { BridgeService } from '../bridge-service.js';

// The plugin JSON-*encodes* a Luau table return into the `returnValue` string
// of the execute-luau envelope. Every generated-Luau tool (scene summary, the
// UI/environment/terrain builders, media, design_lint, apply_theme) funnels
// through RobloxStudioTools#_runGeneratedLuau, which used to hand that envelope
// straight back. Two things followed from that:
//
//   - callers saw double-encoded JSON, so reading `.returnValue.newPath` off it
//     silently produced undefined — which is what left design_review permanently
//     answering "could not stage the UI for capture";
//   - a Luau `{ error = ... }` result still arrived as
//     `success: true, message: "Code executed successfully"`, so an agent
//     branching on success read a failed build as a successful one.

function payloadOf(result: { content: Array<{ type: string; text?: string }> }): Record<string, unknown> {
  const node = result.content.find((c) => c.type === 'text');
  return JSON.parse(node?.text ?? '{}');
}

function toolsReturning(response: unknown): RobloxStudioTools {
  const tools = new RobloxStudioTools(new BridgeService());
  (tools as unknown as { _callSingle: () => Promise<unknown> })._callSingle = async () => response;
  return tools;
}

describe('generated-Luau result envelope', () => {
  it('hands back the decoded Luau table, not a stringified returnValue', async () => {
    const tools = toolsReturning({
      success: true,
      message: 'Code executed successfully',
      output: [],
      returnValue: JSON.stringify({ root: 'game.Workspace', totalDescendants: 6, distinctClasses: 6 }),
    });

    const payload = await tools.getSceneSummary().then(payloadOf);

    expect(payload).toMatchObject({ root: 'game.Workspace', totalDescendants: 6 });
    expect(payload.returnValue).toBeUndefined();
  });

  it('surfaces a Luau-level error instead of reporting success', async () => {
    const tools = toolsReturning({
      success: true,
      message: 'Code executed successfully',
      output: [],
      returnValue: JSON.stringify({ error: 'Path not found: game.Workspace.Nope' }),
    });

    const payload = await tools.getSceneSummary('game.Workspace.Nope').then(payloadOf);

    expect(payload.error).toBe('Path not found: game.Workspace.Nope');
    expect(payload.success).not.toBe(true);
  });

  it('reports a failed execution as an error', async () => {
    const tools = toolsReturning({ success: false, error: 'user_code:2: attempt to index nil', output: [] });

    const payload = await tools.getSceneSummary().then(payloadOf);

    expect(payload).toMatchObject({ success: false, error: 'user_code:2: attempt to index nil' });
  });

  it('gives design_review the staging fields it reads', async () => {
    // The exact seam that was broken: _returnValueOf over a _runGeneratedLuau
    // result has to yield the Luau table, or designReview's `setupRet.newPath`
    // is undefined and it bails out before ever taking a screenshot.
    const tools = toolsReturning({
      success: true,
      returnValue: JSON.stringify({ newPath: 'CoreGui.MainGui', origParentPath: 'StarterGui', name: 'MainGui' }),
    });
    const internals = tools as unknown as {
      _runGeneratedLuau: (code: string) => Promise<{ content: Array<{ type: string; text?: string }> }>;
      _returnValueOf: (result: unknown) => unknown;
    };

    const staged = internals._returnValueOf(await internals._runGeneratedLuau('return {}'));

    expect(staged).toMatchObject({ newPath: 'CoreGui.MainGui', origParentPath: 'StarterGui' });
  });
});
