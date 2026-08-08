import { diffFingerprints, SnapshotStore, type Fingerprint } from '../world-changes.js';
import { buildWorldFingerprintLuau } from '../builders/world-fingerprint.js';
import { WorldModelTools } from '../tools/world-model-tools.js';

const node = (p: string, st: string, se = '', me = '') => ({ p, st, se, me });

const SCOPE = 'place services only (…)';

/** A plugin execute-luau envelope carrying a one-node fingerprint. */
const fingerprintEnvelope = (st: string) => ({
  success: true,
  returnValue: JSON.stringify({
    fingerprint: { a: node('Workspace.A', st) },
    count: 1,
    truncated: false,
    scope: SCOPE,
  }),
});

const readJson = (result: { content?: unknown[] }) =>
  JSON.parse((result.content?.[0] as { text?: string })?.text ?? '{}');

describe('get_changes_since scope reporting', () => {
  // The Luau has emitted `scope` since the place-scoping change, but
  // _captureFingerprint parsed only fingerprint/count/truncated and dropped it —
  // so the tool description and output schema advertised a field that never
  // arrived. Caught by calling the live tool and reading the payload.
  it('surfaces the scope on both the baseline and the diff', async () => {
    let st = 'Part|r|A|0';
    const tools = new WorldModelTools({
      callSingle: async () => fingerprintEnvelope(st),
    } as never);

    const baseline = readJson(await tools.getChangesSince());
    expect(baseline.baseline).toBe(true);
    expect(baseline.scope).toBe(SCOPE);

    st = 'Part|r|Renamed|0';
    const diff = readJson(await tools.getChangesSince(baseline.snapshotId));
    expect(diff.changedCount).toBe(1);
    expect(diff.scope).toBe(SCOPE);
  });
});

describe('get_changes_since baseline stability', () => {
  /** Tools whose world reports whatever `st` currently holds. */
  const toolsReading = (read: () => string) =>
    new WorldModelTools({ callSingle: async () => fingerprintEnvelope(read()) } as never);

  // The defect: the baseline rolled forward on every call, so a snapshotId meant
  // "since my previous call" rather than "since the baseline". Asking the same
  // question twice reported an unchanged world.
  it('keeps answering against the original baseline by default', async () => {
    let st = 'Part|r|A|0';
    const tools = toolsReading(() => st);
    const baseline = readJson(await tools.getChangesSince());

    st = 'Part|r|Renamed|0';
    const first = readJson(await tools.getChangesSince(baseline.snapshotId));
    expect(first.changedCount).toBe(1);
    expect(first.since).toBe('baseline');

    // The change is still a change relative to the baseline — it does not
    // evaporate just because it was already reported once.
    const second = readJson(await tools.getChangesSince(baseline.snapshotId));
    expect(second.changedCount).toBe(1);
    expect(second.since).toBe('baseline');
  });

  it('advances the baseline only when rebaseline is requested', async () => {
    let st = 'Part|r|A|0';
    const tools = toolsReading(() => st);
    const baseline = readJson(await tools.getChangesSince());

    st = 'Part|r|Renamed|0';
    const polled = readJson(await tools.getChangesSince(baseline.snapshotId, undefined, undefined, true));
    expect(polled.changedCount).toBe(1);
    expect(polled.since).toBe('previous-call');

    // Nothing moved since that poll, so the next poll is quiet.
    const quiet = readJson(await tools.getChangesSince(baseline.snapshotId, undefined, undefined, true));
    expect(quiet.changedCount).toBe(0);
  });
});

describe('diffFingerprints', () => {
  it('detects added, removed, and per-channel changes', () => {
    const prev: Fingerprint = {
      a: node('Workspace.A', 'Part|r|A|0', 'geom:1,1,1', ''),
      b: node('Workspace.B', 'Model|r|B|2', '', 't:Tree'),
      c: node('Workspace.C', 'Folder|r|C|1', '', ''),
    };
    const curr: Fingerprint = {
      a: node('Workspace.A', 'Part|r|A|0', 'geom:9,1,1', ''),      // semantics moved
      b: node('Workspace.B', 'Model|r|B|2', '', 't:Tree,Big'),     // meta moved
      d: node('Workspace.D', 'Part|r|D|0', '', ''),                // added
    };
    const diff = diffFingerprints(prev, curr);
    expect(diff.added.map((x) => x.id)).toEqual(['d']);
    expect(diff.removed.map((x) => x.id)).toEqual(['c']);
    const a = diff.changed.find((x) => x.id === 'a')!;
    const b = diff.changed.find((x) => x.id === 'b')!;
    expect(a.channels).toEqual(['semantics']);
    expect(b.channels).toEqual(['meta']);
  });

  it('reports a structure change (rename/move/childCount)', () => {
    const prev: Fingerprint = { a: node('Workspace.A', 'Part|r|A|0') };
    const curr: Fingerprint = { a: node('Workspace.Renamed', 'Part|r|Renamed|0') };
    const diff = diffFingerprints(prev, curr);
    expect(diff.changed[0].channels).toEqual(['structure']);
  });

  it('returns empty diffs for identical fingerprints', () => {
    const fp: Fingerprint = { a: node('A', 's', 'se', 'me') };
    const diff = diffFingerprints(fp, { a: node('A', 's', 'se', 'me') });
    expect(diff.addedCount + diff.removedCount + diff.changedCount).toBe(0);
  });
});

describe('SnapshotStore', () => {
  it('stores, retrieves, and rolls a baseline', () => {
    const store = new SnapshotStore();
    const id = store.put('game', { a: node('A', 's1') });
    expect(store.get(id)?.fingerprint.a.st).toBe('s1');
    store.update(id, { a: node('A', 's2') });
    expect(store.get(id)?.fingerprint.a.st).toBe('s2');
  });

  it('evicts the oldest beyond capacity', () => {
    const store = new SnapshotStore(2);
    const id1 = store.put('p', { a: node('a', '1') });
    store.put('p', { b: node('b', '1') });
    store.put('p', { c: node('c', '1') });
    expect(store.get(id1)).toBeUndefined();
  });
});

describe('buildWorldFingerprintLuau', () => {
  it('emits three channels keyed by a stable node id', () => {
    const code = buildWorldFingerprintLuau('game.Workspace');
    expect(code).toContain('resolvePath("game.Workspace")');
    expect(code).toContain('d:GetDebugId(0)');
    expect(code).toContain('structureSig(d)');
    expect(code).toContain('semanticsSig(d)');
    expect(code).toContain('metaSig(d)');
    expect(code).toContain('st = structureSig(d)');
  });

  it('folds a part orientation into the geometry signature', () => {
    // Verified live before the fix: rotating a part from Orientation
    // [20.7,49.1,82.2] to [0,90,0] with its position untouched produced
    // "changed":[] and changedCount 0 — the changefeed could not see a
    // rotation at all, because the signature only carried cf.Position.
    const code = buildWorldFingerprintLuau();
    expect(code).toContain('cf:ToOrientation()');
    expect(code).toContain('round(math.deg(rx))');
  });

  it('computes domain-specific semantics for parts, sounds, scripts', () => {
    const code = buildWorldFingerprintLuau();
    expect(code).toContain('d:IsA("BasePart")');
    expect(code).toContain('d:IsA("Sound")');
    expect(code).toContain('d:IsA("LuaSourceContainer")');
    expect(code).toContain('d:GetTags()');
    expect(code).toContain('d:GetAttributes()');
  });

  it('caps the node count and flags truncation', () => {
    const code = buildWorldFingerprintLuau('game', 100);
    expect(code).toContain('count >= 100');
    expect(code).toContain('truncated = true');
  });
});
