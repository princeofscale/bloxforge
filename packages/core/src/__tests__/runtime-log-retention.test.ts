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
  // What the peer's buffer holds when the snapshot is taken. Tests override it.
  const buffer: { entries: unknown[] } = {
    entries: [{ seq: 1, level: 'ERR', message: 'boom' }],
  };
  const client = {
    request: async (endpoint: string, _data: unknown, instanceId: string, role: string) => {
      requests.push({ endpoint, instanceId, role });
      if (endpoint === '/api/get-runtime-logs') {
        return { entries: buffer.entries, totalDropped: 0 };
      }
      // A successful stop really does remove the runtime peers; modelling that
      // is what exercises the teardown path instead of polling to its timeout.
      if (endpoint === '/api/stop-playtest' || endpoint === '/api/multiplayer-test-end') {
        state.peers = state.peers.filter((p) => p.role === 'edit');
      }
      return { success: true };
    },
  };
  const tools = new RuntimeTools({ bridge, client, callSingle: async () => ({}) } as never);
  return { tools, state, requests, buffer };
}

const readJson = (r: { content?: unknown[] }) =>
  JSON.parse((r.content?.[0] as { text?: string })?.text ?? '{}');

describe('runtime log retention across teardown', () => {
  it('serves a departed peer’s buffer, clearly marked', async () => {
    const { tools } = harness([
      { instanceId: 'inst', role: 'edit' },
      { instanceId: 'inst', role: 'server', isRunning: true },
      { instanceId: 'inst', role: 'client-1', isRunning: true },
    ]);

    await tools.stopPlaytest('inst');  // snapshots, then the stop removes the peers

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

  it('applies since / tail / filter to a retained read, like the live one does', async () => {
    const { tools, buffer } = harness([
      { instanceId: 'inst', role: 'edit' },
      { instanceId: 'inst', role: 'server', isRunning: true },
    ]);
    buffer.entries = [
      { seq: 1, level: 'OUT', message: 'alpha' },
      { seq: 2, level: 'ERR', message: 'beta boom' },
      { seq: 3, level: 'OUT', message: 'gamma' },
    ];
    await tools.stopPlaytest('inst');

    const read = async (since?: number, tail?: number, filter?: string) =>
      readJson(await tools.getRuntimeLogs('server', since, tail, filter, 'inst')).entries as Array<{ seq: number }>;

    expect((await read()).map((e) => e.seq)).toEqual([1, 2, 3]);
    expect((await read(undefined, 1)).map((e) => e.seq)).toEqual([3]);
    expect((await read(1)).map((e) => e.seq)).toEqual([2, 3]);
    expect((await read(undefined, undefined, 'boom')).map((e) => e.seq)).toEqual([2]);
    // Same order the plugin uses: since, then filter, then tail.
    expect((await read(1, 1, 'a')).map((e) => e.seq)).toEqual([3]);
  });

  it('never serves an older session after a run that produced no logs', async () => {
    const { tools, state, buffer } = harness([
      { instanceId: 'inst', role: 'edit' },
      { instanceId: 'inst', role: 'server', isRunning: true },
    ]);
    await tools.stopPlaytest('inst');
    expect(readJson(await tools.getRuntimeLogs('server', undefined, undefined, undefined, 'inst')).entries)
      .toHaveLength(1);

    // Second run, this time silent. Keeping the first run's buffer would report
    // the wrong session's output as if it belonged to this one.
    state.peers = [{ instanceId: 'inst', role: 'edit' }, { instanceId: 'inst', role: 'server', isRunning: true }];
    buffer.entries = [];
    await tools.stopPlaytest('inst');

    await expect(
      tools.getRuntimeLogs('server', undefined, undefined, undefined, 'inst'),
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
