import { RuntimeTools } from '../tools/runtime-tools.js';

// `since` is a sequence cursor (the plugin filters `entry.seq > since`), but
// run_playtest_episode passed startedAt — a millisecond epoch. `seq > 1.78e12`
// is never true for a seq starting at 1, so the episode collected zero entries
// always, and errorCount/warningCount were structurally 0. That is why fixing
// the severity classifier alone could not make a runtime error fail an episode.

type Call = { endpoint: string; data: Record<string, unknown> };

function harness(entries: Array<Record<string, unknown>>) {
  const calls: Call[] = [];
  const peers = [{ instanceId: 'inst', role: 'edit' }, { instanceId: 'inst', role: 'server', isRunning: true }];
  const bridge = {
    getPublicInstances: () => peers,
    getInstances: () => peers,
    getEquivalentInstanceIds: (id: string) => [id],
    resolveTarget: () => ({ ok: true, mode: 'single', targetInstanceId: 'inst', targetRole: 'server' }),
  };
  const client = {
    request: async (endpoint: string, data: Record<string, unknown>) => {
      calls.push({ endpoint, data });
      if (endpoint === '/api/get-runtime-logs') return { entries, totalDropped: 0 };
      return { success: true };
    },
  };
  const episodes = { add: () => {}, list: () => [], get: () => undefined };
  const tools = new RuntimeTools({ bridge, client, episodes, callSingle: async () => ({}) } as never);
  // Only the log-gathering step is under test; stub the playtest lifecycle around
  // it rather than driving the real start/stop handshake.
  const wrap = (o: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(o) }] });
  (tools as unknown as Record<string, unknown>).startPlaytest =
    async () => wrap({ success: true, runtimeReady: true });
  (tools as unknown as Record<string, unknown>).stopPlaytest =
    async () => wrap({ success: true });
  return { tools, calls };
}

const readJson = (r: { content?: unknown[] }) =>
  JSON.parse((r.content?.[0] as { text?: string })?.text ?? '{}');

describe('run_playtest_episode log window', () => {
  it('does not pass a wall-clock timestamp as the sequence cursor', async () => {
    const { tools, calls } = harness([]);
    await tools.runPlaytestEpisode('run', undefined, undefined, 0);
    const logCall = calls.find((c) => c.endpoint === '/api/get-runtime-logs');
    expect(logCall).toBeTruthy();
    // Anything near an epoch here means the seq filter silently discards the run.
    expect(logCall!.data.since).toBeUndefined();
  });

  it('keeps entries from the run and drops ones from before it', async () => {
    const now = Date.now();
    const { tools } = harness([
      { seq: 1, ts: (now - 60_000) / 1000, level: 'ERR', message: 'stale error from before the run' },
      { seq: 2, ts: (now + 500) / 1000, level: 'ERR', message: 'ServerScriptService.Boom:2: attempt to index nil' },
      { seq: 3, ts: (now + 600) / 1000, level: 'WARN', message: 'during the run' },
      // No usable timestamp: kept, because dropping a real error over a missing
      // clock field is the worse failure.
      { seq: 4, level: 'ERR', message: 'no timestamp' },
    ]);
    const out = readJson(await tools.runPlaytestEpisode('run', undefined, undefined, 0));
    expect(out.logs.errorCount).toBe(2);
    expect(out.logs.warningCount).toBe(1);
    expect(out.logs.errors.map((e: { message: string }) => e.message))
      .not.toContain('stale error from before the run');
  });

  it('a runtime error fails the verdict', async () => {
    const now = Date.now();
    const { tools } = harness([
      { seq: 1, ts: (now + 100) / 1000, level: 'ERR', message: 'ServerScriptService.Boom:2: attempt to index nil' },
    ]);
    const out = readJson(await tools.runPlaytestEpisode('run', undefined, undefined, 0));
    expect(out.verdict).toBe('fail');
    expect(out.hint).toContain('Runtime errors were logged');
  });
});
