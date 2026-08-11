import { diffTrees, equalValues, summarizeDiff, type TreeNode } from '../scene/tree-diff.js';

const part = (name: string, over: Partial<TreeNode> = {}): TreeNode => ({
  name, className: 'Part', properties: { Anchored: true, Position: { x: 0, y: 5, z: 0 } }, ...over,
});

const model = (children: TreeNode[], name = 'Room'): TreeNode => ({ name, className: 'Model', children });

describe('the questions a JSON comparison cannot answer', () => {
  it('reports a reparent as one move, not a delete and an add', () => {
    // Reported as two, a reviewer reads a rebuild where a reparent happened.
    const before = model([
      { name: 'A', className: 'Folder', children: [part('Crate', { id: 'crate-1' })] },
      { name: 'B', className: 'Folder', children: [] },
    ]);
    const after = model([
      { name: 'A', className: 'Folder', children: [] },
      { name: 'B', className: 'Folder', children: [part('Crate', { id: 'crate-1' })] },
    ]);
    const diff = diffTrees(before, after);
    expect(diff.changes).toEqual([{ kind: 'moved', path: 'Room.B.Crate', from: 'Room.A.Crate' }]);
  });

  it('does not report a child that only changed position among its siblings', () => {
    // Identity beats order. A diff that flags a reorder trains a reader to skim.
    const before = model([part('A'), part('B'), part('C')]);
    const after = model([part('C'), part('A'), part('B')]);
    expect(diffTrees(before, after).identical).toBe(true);
  });

  it('does not report float noise as a change', () => {
    const before = model([part('A', { properties: { Transparency: 0.30000000000000004 } })]);
    const after = model([part('A', { properties: { Transparency: 0.3 } })]);
    expect(diffTrees(before, after).identical).toBe(true);
  });

  it('reaches the tolerance into nested values, where positions live', () => {
    // Comparing a Vector3 exactly is how a rounded position becomes a change.
    const before = model([part('A', { properties: { Position: { x: 1.0000000001, y: 2, z: 3 } } })]);
    const after = model([part('A', { properties: { Position: { x: 1, y: 2, z: 3 } } })]);
    expect(diffTrees(before, after).identical).toBe(true);
  });

  it('still reports a real move of the same magnitude as the tolerance times a thousand', () => {
    const before = model([part('A', { properties: { Position: { x: 0, y: 5, z: 0 } } })]);
    const after = model([part('A', { properties: { Position: { x: 0, y: 5.001, z: 0 } } })]);
    expect(diffTrees(before, after).changes).toEqual([
      { kind: 'property', path: 'Room.A', property: 'Position', before: { x: 0, y: 5, z: 0 }, after: { x: 0, y: 5.001, z: 0 } },
    ]);
  });

  it('names an unchanged subtree once instead of walking it', () => {
    const shared = { name: 'Props', className: 'Folder', children: [part('A'), part('B'), part('C')] };
    const before = model([shared, part('Door')]);
    const after = model([shared, part('Door', { properties: { Anchored: false, Position: { x: 0, y: 5, z: 0 } } })]);
    const diff = diffTrees(before, after);
    expect(diff.unchangedSubtrees).toEqual(['Room.Props']);
    expect(diff.changes).toHaveLength(1);
  });
});

describe('structural changes', () => {
  it('separates a class change from a property change', () => {
    // Every property on it means something different now.
    const diff = diffTrees(model([part('A')]), model([part('A', { className: 'MeshPart' })]));
    expect(diff.changes).toEqual([{ kind: 'reclassed', path: 'Room.A', before: 'Part', after: 'MeshPart' }]);
  });

  it('reports a rename of the root itself', () => {
    const diff = diffTrees(model([], 'Room'), model([], 'Lobby'));
    expect(diff.changes[0]).toMatchObject({ kind: 'renamed', before: 'Room', after: 'Lobby' });
  });

  it('reports an added and a removed child', () => {
    const diff = diffTrees(model([part('A')]), model([part('B')]));
    expect(diff.changes.map((c) => [c.kind, c.path]).sort()).toEqual([['added', 'Room.B'], ['removed', 'Room.A']]);
  });

  it('reports a property that disappeared, not only one that changed', () => {
    const before = model([part('A', { properties: { Anchored: true, Massless: true } })]);
    const after = model([part('A', { properties: { Anchored: true } })]);
    expect(diffTrees(before, after).changes).toEqual([
      { kind: 'property', path: 'Room.A', property: 'Massless', before: true, after: undefined },
    ]);
  });

  it('follows a moved node into its properties', () => {
    const before = model([
      { name: 'A', className: 'Folder', children: [part('Crate', { id: 'c1', properties: { Anchored: true } })] },
      { name: 'B', className: 'Folder', children: [] },
    ]);
    const after = model([
      { name: 'A', className: 'Folder', children: [] },
      { name: 'B', className: 'Folder', children: [part('Crate', { id: 'c1', properties: { Anchored: false } })] },
    ]);
    const kinds = diffTrees(before, after).changes.map((c) => c.kind);
    expect(kinds).toEqual(['moved', 'property']);
  });
});

describe('options', () => {
  it('ignores the properties it was told to ignore', () => {
    const before = model([part('A', { properties: { Anchored: true, LastEdited: 1 } })]);
    const after = model([part('A', { properties: { Anchored: true, LastEdited: 2 } })]);
    expect(diffTrees(before, after, { ignoreProperties: ['LastEdited'] }).identical).toBe(true);
  });

  it('takes an explicit epsilon over the default', () => {
    const before = model([part('A', { properties: { Transparency: 0.5 } })]);
    const after = model([part('A', { properties: { Transparency: 0.51 } })]);
    expect(diffTrees(before, after).identical).toBe(false);
    expect(diffTrees(before, after, { epsilon: 0.02 }).identical).toBe(true);
  });
});

describe('value comparison', () => {
  it('treats two NaNs as equal, since neither is a change from the other', () => {
    expect(equalValues(Number.NaN, Number.NaN, 1e-6)).toBe(true);
  });

  it('does not treat a number and its string as the same value', () => {
    expect(equalValues(1, '1', 1e-6)).toBe(false);
  });

  it('compares arrays by length and element', () => {
    expect(equalValues([1, 2], [1, 2], 1e-6)).toBe(true);
    expect(equalValues([1, 2], [1, 2, 3], 1e-6)).toBe(false);
  });
});

describe('the summary', () => {
  it('leads with counts, because the shape of a diff is the first question', () => {
    const diff = diffTrees(model([part('A'), part('B')]), model([part('A', { className: 'MeshPart' }), part('C')]));
    expect(summarizeDiff(diff)).toMatch(/1 added, 1 reclassed, 1 removed/);
  });

  it('says so plainly when nothing differs', () => {
    expect(summarizeDiff(diffTrees(model([part('A')]), model([part('A')])))).toBe('Identical.');
  });
});
