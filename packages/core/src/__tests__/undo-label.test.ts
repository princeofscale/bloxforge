import { BridgeService } from '../bridge-service.js';
import { RobloxStudioTools } from '../tools/index.js';

const READY = {
  pluginSessionId: 'session-1',
  instanceId: 'place:test',
  role: 'edit' as const,
  placeId: 0,
  placeName: 'TestPlace',
  dataModelName: 'TestPlace',
  isRunning: false,
  protocolVersion: 3,
};

// execute-luau carries every generated-Luau tool, mutating and read-only alike.
// The plugin opens a ChangeHistoryService recording only when the request
// declares an undoLabel, so these assertions are what keep a write undoable and
// a read out of the user's undo history.
// Tools reach the bridge after at least one await (safety gate, plan build), so
// the request is not queued synchronously with the call.
async function awaitPending(bridge: BridgeService) {
  for (let i = 0; i < 50; i++) {
    const pending = bridge.getPendingRequest('place:test', 'edit');
    if (pending) return pending;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error('no execute-luau request reached the bridge');
}

async function labelOf(bridge: BridgeService, promise: Promise<unknown>): Promise<unknown> {
  promise.catch(() => undefined);
  const pending = await awaitPending(bridge);
  expect(pending.request).toMatchObject({ endpoint: '/api/execute-luau' });
  const label = (pending.request as { data: Record<string, unknown> }).data.undoLabel;
  bridge.resolveRequest(pending.requestId, { success: true, returnValue: '{}' });
  await promise.catch(() => undefined);
  return label;
}

describe('execute-luau undo labels', () => {
  let bridge: BridgeService;
  let tools: RobloxStudioTools;

  beforeEach(() => {
    bridge = new BridgeService();
    tools = new RobloxStudioTools(bridge);
    bridge.registerInstance(READY);
  });

  afterEach(() => bridge.clearAllPendingRequests());

  it('labels a recipe apply so it lands as one undo waypoint', async () => {
    expect(await labelOf(bridge, tools.applyRecipe('kill_brick', {}, 'place:test'))).toBe('recipe kill_brick');
  });

  it('labels a generated terrain build', async () => {
    const call = tools.terrainGenerateBaseplate({ size: [128, 8, 128] }, 'place:test');
    expect(await labelOf(bridge, call)).toBe('baseplate');
  });

  it('labels an applied mutation plan but not a dry run', async () => {
    const ops = [{ op: 'set_property', path: 'game.Workspace.Part', property: 'Name', value: 'x' }] as never;

    expect(await labelOf(bridge, tools.applyMutationPlan(ops, true, undefined, 'place:test'))).toBeUndefined();
    expect(await labelOf(bridge, tools.applyMutationPlan(ops, false, true, 'place:test'))).toBe('mutation plan (1 ops)');
  });

  it('leaves a read-only snapshot unlabelled so it opens no recording', async () => {
    const call = tools.getWorldSnapshot(undefined, undefined, undefined, 'place:test');
    expect(await labelOf(bridge, call)).toBeUndefined();
  });
});
