import { RuntimeTools } from '../tools/runtime-tools.js';
import { RoutingFailure } from '../bridge-service.js';

// The log buffer lives inside the runtime DataModel, so it dies with the peer:
// after a test ended, get_runtime_logs for "client-1" answered
// target_role_not_present_on_instance and the session's output was gone —
// reproduced live before this change. Post-test QA is exactly when it matters.

type Peer = { instanceId: string; role: string; isRunning?: boolean };

function harness(peers: Peer[]) {
  const requests: Array<{ endpoint: string; instanceId: string; role: string }> = [];
  const state = { peers };
  const bridge = {
    getPublicInstances: () => state.peers,
    getInstances: () => state.peers,
    getEquivalentInstanceIds: (id: string) => [id],
    resolveTarget: ({ target }: { target: string }) =>
      state.peers.some((p) => p.role === target)
        ? { ok: true, mode: 'single', targetInstanceId: 'inst', targetRole: target }
        : { ok: false, error: { code: 'target_role_not_present_on_instance', message: `no role "${target}"` } },
  };
  const client = {
    request: async (endpoint: string, _data: unknown, instanceId: string, role: string) => {
      requests.push({ endpoint, instanceId, role });
      if (endpoint === '/api/get-runtime-logs') {
        return { entries: [{ seq: 1, level: 'ERR', message: `boom on ${role}` }], totalDropped: 0 };
      }
      return { success: true };
    },
  };
  const tools = new RuntimeTools({ bridge, client, callSingle: async () => ({}) } as never);
  return { tools, state, requests };
}

const readJson = (r: { content?: unknown[] }) =>
  JSON.parse((r.content?.[0] as { text?: string })?.text ?? '{}');

describe('runtime log retention across teardown', () => {
  it('serves a departed peer’s buffer, clearly marked', async () => {
    const { tools, state } = harness([
      { instanceId: 'inst', role: 'edit' },
      { instanceId: 'inst', role: 'server', isRunning: true },
      { instanceId: 'inst', role: 'client-1', isRunning: true },
    ]);

    await tools.stopPlaytest('inst');           // snapshots on the way out
    state.peers = [{ instanceId: 'inst', role: 'edit' }];  // peers torn down

    const out = readJson(await tools.getRuntimeLogs('client-1', undefined, undefined, undefined, 'inst'));
    expect(out.retained).toBe(true);
    expect(out.capturedBy).toBe('client-1');
    expect(out.entries).toHaveLength(1);
    expect(out.note).toContain('no longer connected');
  });

  it('still fails loudly for a role that never existed', async () => {
    const { tools } = harness([{ instanceId: 'inst', role: 'edit' }]);
    await expect(
      tools.getRuntimeLogs('client-9', undefined, undefined, undefined, 'inst'),
    ).rejects.toBeInstanceOf(RoutingFailure);
  });

  it('does not retain the edit peer, which never goes away', async () => {
    const { tools, requests } = harness([
      { instanceId: 'inst', role: 'edit' },
      { instanceId: 'inst', role: 'server', isRunning: true },
    ]);
    await tools.stopPlaytest('inst');
    const captured = requests.filter((r) => r.endpoint === '/api/get-runtime-logs').map((r) => r.role);
    expect(captured).toEqual(['server']);
  });
});
