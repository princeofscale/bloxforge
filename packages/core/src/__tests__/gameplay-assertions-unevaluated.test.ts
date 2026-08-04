import { RuntimeTools } from '../tools/runtime-tools.js';

// "Could not evaluate" must not read as "every assertion failed". Live, a runtime
// peer refused `loadstring`, the old fallback reported failed: 3, and the episode
// verdict said `fail` — three healthy checks looked like a regression.

const asserts = [
  { name: 'a', expr: 'true' },
  { name: 'b', expr: 'true' },
];

function harness(respond: (code: string) => unknown) {
  const codes: string[] = [];
  const tools = new RuntimeTools({
    callSingle: async (_endpoint: string, data: { code: string }) => {
      codes.push(data.code);
      return respond(data.code);
    },
  } as never);
  return { tools, codes };
}

const readJson = (r: { content?: unknown[] }) =>
  JSON.parse((r.content?.[0] as { text?: string })?.text ?? '{}');

describe('run_gameplay_assertions when the chunk does not run', () => {
  it('reports evaluated: false rather than counting every assertion as failed', async () => {
    const { tools } = harness(() => ({ success: false, error: 'loadstring() is not available' }));
    const out = readJson(await tools.runGameplayAssertions(asserts, 'server'));
    expect(out.evaluated).toBe(false);
    expect(out.summary.failed).toBe(0);
    expect(out.error).toContain('loadstring() is not available');
  });

  it('re-runs each assertion alone to name the one that broke the batch', async () => {
    // Regression: an empty `results: []` in the fallback made the batch look like
    // it had run, so this isolation pass was unreachable dead code.
    const { tools, codes } = harness((code) => code.includes('\nbad\n')
      ? { success: false, error: 'Incomplete statement' }
      : { success: true, returnValue: JSON.stringify({
        results: [{ name: 'ok', passed: true }],
        summary: { total: 1, passed: 1, failed: 0 },
        allPassed: true,
      }) });
    const out = readJson(await tools.runGameplayAssertions(
      [{ name: 'ok', expr: 'true' }, { name: 'broken', expr: 'bad' }],
      'server',
    ));
    expect(codes).toHaveLength(3); // batch + one per assertion
    expect(out.evaluated).toBe(false);
    expect(out.results).toEqual([
      { name: 'ok', passed: true },
      { name: 'broken', evaluated: false, error: 'Incomplete statement' },
    ]);
  });

  it('always carries a results array, even when isolation is skipped', async () => {
    const { tools } = harness(() => ({ success: false, error: 'nope' }));
    const out = readJson(await tools.runGameplayAssertions([{ name: 'only', expr: 'true' }], 'server'));
    expect(out.results).toEqual([]);
  });

  it('leaves a successful run untouched', async () => {
    const { tools, codes } = harness(() => ({ success: true, returnValue: JSON.stringify({
      results: [{ name: 'a', passed: true }, { name: 'b', passed: true }],
      summary: { total: 2, passed: 2, failed: 0 },
      allPassed: true,
    }) }));
    const out = readJson(await tools.runGameplayAssertions(asserts, 'server'));
    expect(codes).toHaveLength(1);
    expect(out.allPassed).toBe(true);
    expect(out.evaluated).toBeUndefined();
  });
});
