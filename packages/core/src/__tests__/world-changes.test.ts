import { diffFingerprints, SnapshotStore } from '../world-changes.js';
import { buildWorldFingerprintLuau } from '../builders/world-fingerprint.js';

describe('diffFingerprints', () => {
  it('detects added, removed, and changed paths', () => {
    const prev = { 'a': 'Part|0', 'b': 'Model|2', 'c': 'Folder|1' };
    const curr = { 'a': 'Part|0', 'b': 'Model|3', 'd': 'Part|0' };
    const diff = diffFingerprints(prev, curr);
    expect(diff.added).toEqual(['d']);
    expect(diff.removed).toEqual(['c']);
    expect(diff.changed).toEqual(['b']);
    expect(diff.addedCount).toBe(1);
    expect(diff.removedCount).toBe(1);
    expect(diff.changedCount).toBe(1);
  });

  it('returns empty diffs for identical fingerprints', () => {
    const fp = { 'a': 'Part|0' };
    const diff = diffFingerprints(fp, { ...fp });
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(diff.changed).toEqual([]);
  });
});

describe('SnapshotStore', () => {
  it('stores and retrieves a snapshot by id', () => {
    const store = new SnapshotStore();
    const id = store.put('game.Workspace', { 'a': 'Part|0' });
    expect(store.get(id)?.fingerprint).toEqual({ 'a': 'Part|0' });
    expect(store.get(id)?.path).toBe('game.Workspace');
  });

  it('updates a baseline in place', () => {
    const store = new SnapshotStore();
    const id = store.put('game', { 'a': 'Part|0' });
    store.update(id, { 'a': 'Part|1' });
    expect(store.get(id)?.fingerprint).toEqual({ 'a': 'Part|1' });
  });

  it('evicts the oldest beyond capacity', () => {
    const store = new SnapshotStore(2);
    const id1 = store.put('p', { a: '1' });
    const id2 = store.put('p', { b: '1' });
    const id3 = store.put('p', { c: '1' });
    expect(store.get(id1)).toBeUndefined();
    expect(store.get(id2)).toBeDefined();
    expect(store.get(id3)).toBeDefined();
  });

  it('returns undefined for an unknown id', () => {
    expect(new SnapshotStore().get('nope')).toBeUndefined();
  });
});

describe('buildWorldFingerprintLuau', () => {
  it('builds a per-node signature keyed by full path', () => {
    const code = buildWorldFingerprintLuau('game.Workspace');
    expect(code).toContain('resolvePath("game.Workspace")');
    expect(code).toContain('d:GetFullName()');
    expect(code).toContain('d.ClassName .. "|" .. tostring(#d:GetChildren())');
    expect(code).toContain('fingerprint = fp');
  });

  it('caps the node count and flags truncation', () => {
    const code = buildWorldFingerprintLuau('game', 100);
    expect(code).toContain('count >= 100');
    expect(code).toContain('truncated = true');
  });
});
