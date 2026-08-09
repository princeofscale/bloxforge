import { bulkReceipt, isReturnMode } from '../compact.js';

const rows = (n: number, extra: (i: number) => Record<string, unknown> = () => ({})) =>
  Array.from({ length: n }, (_, i) => ({
    path: `game.Workspace.Props.Crate${String(i + 1).padStart(3, '0')}`,
    success: true,
    ...extra(i),
  }));

describe('bulkReceipt', () => {
  it('hoists the fields every successful row repeats and drops the rows they were on', () => {
    const receipt = bulkReceipt({
      results: rows(200, () => ({ propertyName: 'Anchored', propertyValue: true })),
      summary: { total: 200, succeeded: 200, failed: 0 },
    }) as Record<string, unknown>;

    expect(receipt).toEqual({
      summary: { total: 200, succeeded: 200, failed: 0 },
      propertyName: 'Anchored',
      propertyValue: true,
    });
    expect(receipt.results).toBeUndefined();
  });

  it('is the whole point: measure it', () => {
    const before = {
      results: rows(200, () => ({ propertyName: 'Anchored', propertyValue: true })),
      summary: { total: 200, succeeded: 200, failed: 0 },
    };
    const after = bulkReceipt(before);
    // Not a token count — a byte count, which is what a token count is made of.
    expect(JSON.stringify(after).length).toBeLessThan(JSON.stringify(before).length / 50);
  });

  it('names every failure in full and never folds one away', () => {
    const receipt = bulkReceipt({
      results: [
        ...rows(8, () => ({ propertyName: 'Anchored', propertyValue: true })),
        { path: 'game.Workspace.Props.Crate009', success: false, error: 'Instance not found' },
        { path: 'game.Workspace.Props.Crate010', success: false, error: 'Property is read only' },
      ],
      summary: { total: 10, succeeded: 8, failed: 2 },
    }) as { failures?: unknown[] };

    expect(receipt.failures).toEqual([
      { path: 'game.Workspace.Props.Crate009', error: 'Instance not found' },
      { path: 'game.Workspace.Props.Crate010', error: 'Property is read only' },
    ]);
  });

  // The hoist is derived, not a hardcoded list of field names, so it has to stop
  // on its own when the rows stop agreeing.
  it('keeps a field that differs between rows, and keeps the rows with it', () => {
    const receipt = bulkReceipt({
      results: rows(3, (i) => ({ propertyName: 'Transparency', propertyValue: i / 10 })),
      summary: { total: 3, succeeded: 3, failed: 0 },
    }) as { propertyName?: unknown; propertyValue?: unknown; succeeded?: unknown[] };

    expect(receipt.propertyName).toBe('Transparency');
    expect(receipt.propertyValue).toBeUndefined();
    expect(receipt.succeeded).toEqual([
      { path: 'game.Workspace.Props.Crate001', propertyValue: 0 },
      { path: 'game.Workspace.Props.Crate002', propertyValue: 0.1 },
      { path: 'game.Workspace.Props.Crate003', propertyValue: 0.2 },
    ]);
  });

  it('honors a different row key', () => {
    const receipt = bulkReceipt({
      results: [
        { attributeName: 'Tier', success: true },
        { attributeName: 'Weight', success: true },
      ],
      summary: { total: 2, succeeded: 2, failed: 0 },
    }) as Record<string, unknown>;
    // With the default key the attributeName is what differs, so the rows stay.
    expect(receipt.succeeded).toEqual([{ attributeName: 'Tier' }, { attributeName: 'Weight' }]);

    const keyed = bulkReceipt({
      results: [
        { attributeName: 'Tier', success: true },
        { attributeName: 'Weight', success: true },
      ],
      summary: { total: 2, succeeded: 2, failed: 0 },
    }, 'attributeName') as Record<string, unknown>;
    expect(keyed.succeeded).toBeUndefined();
  });

  // Fail closed: a response this does not describe is passed through untouched
  // rather than reshaped into something that looks like a receipt.
  it.each<[string, unknown]>([
    ['no results array', { summary: { total: 0 } }],
    ['an empty results array', { results: [], summary: { total: 0 } }],
    ['rows that are not objects', { results: ['ok', 'ok'] }],
    ['rows with no success flag', { results: [{ path: 'a' }, { path: 'b' }] }],
    ['nothing that succeeded', { results: [{ path: 'a', success: false, error: 'x' }] }],
  ])('passes through %s unchanged', (_label, payload) => {
    expect(bulkReceipt(payload as { results?: unknown })).toBe(payload);
  });

  describe('returnMode', () => {
    const payload = () => ({
      results: [
        ...rows(3, () => ({ propertyName: 'Anchored', propertyValue: true })),
        { path: 'game.Workspace.Gone', success: false, error: 'not found' },
      ],
      summary: { total: 4, succeeded: 3, failed: 1 },
    });

    it('full returns exactly what the plugin said', () => {
      const before = payload();
      expect(bulkReceipt(before, 'path', 'full')).toEqual(before);
    });

    it('failures drops the successful side and keeps every failure', () => {
      const out = bulkReceipt(payload(), 'path', 'failures') as Record<string, unknown>;
      expect(out.results).toBeUndefined();
      expect(out.succeeded).toBeUndefined();
      expect(out.failures).toEqual([{ path: 'game.Workspace.Gone', error: 'not found' }]);
    });

    it('failures still says how many ran, via the summary the plugin already sent', () => {
      // The counters are not re-invented; this asserts the field they would
      // have duplicated is carried through, which is why they are not needed.
      const out = bulkReceipt(payload(), 'path', 'failures') as Record<string, unknown>;
      expect(out.summary).toEqual({ total: 4, succeeded: 3, failed: 1 });
      expect(out.changed).toBeUndefined();
      expect(out.failed).toBeUndefined();
    });

    it('a clean run in failures mode carries no failures key at all', () => {
      const out = bulkReceipt(
        { results: rows(5), summary: { total: 5, succeeded: 5, failed: 0 } },
        'path',
        'failures',
      ) as Record<string, unknown>;
      expect(out.failures).toBeUndefined();
      expect(out.summary).toEqual({ total: 5, succeeded: 5, failed: 0 });
    });

    it('failures is smaller than receipt whenever the receipt still carries rows', () => {
      const differing = {
        results: rows(60, (i) => ({ value: i })),
        summary: { total: 60, succeeded: 60, failed: 0 },
      };
      const receipt = JSON.stringify(bulkReceipt(differing, 'path', 'receipt')).length;
      const failuresOnly = JSON.stringify(bulkReceipt(differing, 'path', 'failures')).length;
      expect(failuresOnly).toBeLessThan(receipt);
    });


    it('leaves a response whose rows carry no success flag alone, in every mode', () => {
      // Receipt mode always had this guard; `failures` ran ahead of it and
      // reclassified every row of an unrecognised shape as a failure.
      const foreign = { results: [{ path: 'a', value: 1 }, { path: 'b', value: 2 }] };
      expect(bulkReceipt(foreign, 'path', 'receipt')).toEqual(foreign);
      expect(bulkReceipt(foreign, 'path', 'failures')).toEqual(foreign);
      expect(bulkReceipt(foreign, 'path', 'full')).toEqual(foreign);
    });

    it('still treats a row that explicitly failed as a failure', () => {
      const out = bulkReceipt(
        { results: [{ path: 'a', success: true }, { path: 'b', success: false, error: 'nope' }] },
        'path',
        'failures',
      ) as Record<string, unknown>;
      expect(out.failures).toEqual([{ path: 'b', error: 'nope' }]);
    });
    it('defaults to receipt when no mode is given', () => {
      expect(bulkReceipt(payload())).toEqual(bulkReceipt(payload(), 'path', 'receipt'));
    });
  });
});

describe('isReturnMode', () => {
  it('accepts exactly the three modes and nothing else', () => {
    for (const mode of ['receipt', 'failures', 'full']) expect(isReturnMode(mode)).toBe(true);
    // The value arrives raw from an HTTP body; a typo that silently became
    // `receipt` would hand a caller who asked for `full` the compacted answer
    // they were trying to check against.
    for (const bad of ['Full', 'raw', '', 'receipts', null, undefined, 3, {}]) {
      expect(isReturnMode(bad)).toBe(false);
    }
  });
});
