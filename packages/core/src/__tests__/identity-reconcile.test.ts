// The four acceptance criteria the roadmap states for D4, written as tests
// rather than as prose, plus the two ambiguities that must fail closed.
import {
  canonicalize,
  groupKey,
  identityStamp,
  isOwned,
  itemId,
  OWNER,
  type GroupSpec,
} from '../identity/identity.js';
import {
  isZeroOp,
  planReconcile,
  ReconcileConflict,
  type DesiredItem,
  type ObservedItem,
} from '../identity/reconcile.js';

const spec = (params: Record<string, unknown> = { density: 0.4 }): GroupSpec => ({
  generator: 'scatter_rocks',
  generatorVersion: '2.1.0',
  seed: 20260809,
  params,
  sourceId: 'game.Workspace.Zones.North',
});

/** A grid slot — nameable again from the same inputs, unlike an array index. */
const slot = (x: number, z: number) => `cell:${x},${z}`;

const desiredAt = (s: GroupSpec, x: number, z: number, props: Record<string, unknown> = {}): DesiredItem => ({
  stamp: identityStamp(s, slot(x, z)),
  properties: { Size: [4, 4, 4], Material: 'Slate', ...props },
});

const observedFrom = (item: DesiredItem, path: string, props?: Record<string, unknown>): ObservedItem => ({
  path,
  attributes: { ...item.stamp },
  properties: props ?? item.properties,
});

describe('canonicalize', () => {
  it('hashes the same configuration alike whatever order the keys arrive in', () => {
    expect(canonicalize({ a: 1, b: 2 })).toBe(canonicalize({ b: 2, a: 1 }));
    expect(canonicalize({ a: { x: 1, y: 2 } })).toBe(canonicalize({ a: { y: 2, x: 1 } }));
  });

  it('keeps array order, because for a parameter list the order is the value', () => {
    expect(canonicalize([1, 2])).not.toBe(canonicalize([2, 1]));
  });

  it('treats an explicit undefined as absence', () => {
    expect(canonicalize({ a: 1, b: undefined })).toBe(canonicalize({ a: 1 }));
  });

  it('does not distinguish -0 from 0', () => {
    expect(canonicalize({ offset: -0 })).toBe(canonicalize({ offset: 0 }));
  });

  it('refuses a non-finite parameter rather than hashing it as null', () => {
    expect(() => canonicalize({ scale: NaN })).toThrow(/finite number/);
    expect(() => canonicalize({ scale: Infinity })).toThrow(/finite number/);
  });
});

describe('group and item keys', () => {
  it('is stable across runs with the same inputs', () => {
    expect(groupKey(spec())).toBe(groupKey(spec()));
    expect(groupKey(spec({ density: 0.4 }))).toBe(groupKey(spec({ density: 0.4 })));
  });

  it('changes when any component of the group changes', () => {
    const base = groupKey(spec());
    expect(groupKey({ ...spec(), generatorVersion: '2.2.0' })).not.toBe(base);
    expect(groupKey({ ...spec(), seed: 1 })).not.toBe(base);
    expect(groupKey({ ...spec(), sourceId: 'game.Workspace.Zones.South' })).not.toBe(base);
    expect(groupKey({ ...spec(), styleProfileHash: 'abc' })).not.toBe(base);
    expect(groupKey(spec({ density: 0.5 }))).not.toBe(base);
  });

  it('does not let two fields run together into one hash input', () => {
    // "tree" + "line1" must not hash as "treeline" + "1".
    const a = groupKey({ ...spec(), generator: 'tree', sourceId: 'line1' });
    const b = groupKey({ ...spec(), generator: 'treeline', sourceId: '1' });
    expect(a).not.toBe(b);
  });

  it('refuses an empty module slot', () => {
    expect(() => itemId(groupKey(spec()), '')).toThrow(/stableModuleSlot/);
  });
});

describe('planReconcile', () => {
  it('acceptance: the same inputs twice is a zero-op', () => {
    const s = spec();
    const group = groupKey(s);
    const desired = [desiredAt(s, 0, 0), desiredAt(s, 1, 0), desiredAt(s, 2, 0)];
    const observed = desired.map((d, i) => observedFrom(d, `game.Workspace.Rocks.R${i}`));

    const plan = planReconcile(group, desired, observed);
    expect(isZeroOp(plan)).toBe(true);
  });

  it('acceptance: reordering unrelated instances does not change any identity', () => {
    const s = spec();
    const group = groupKey(s);
    const desired = [desiredAt(s, 0, 0), desiredAt(s, 1, 0), desiredAt(s, 2, 0)];
    const observed = desired.map((d, i) => observedFrom(d, `game.Workspace.Rocks.R${i}`));

    // Same scene, walked in a different order, with a user's part in the middle.
    const shuffled = [observed[2], { path: 'game.Workspace.UserRock', attributes: {}, properties: {} }, observed[0], observed[1]];
    const plan = planReconcile(group, desired, shuffled);
    expect(isZeroOp(plan)).toBe(true);
    expect(plan.unowned).toBe(1);
  });

  it('acceptance: lowering the density is a deterministic delta, not a rebuild', () => {
    const s = spec();
    const group = groupKey(s);
    const before = [desiredAt(s, 0, 0), desiredAt(s, 1, 0), desiredAt(s, 2, 0)];
    const observed = before.map((d, i) => observedFrom(d, `game.Workspace.Rocks.R${i}`));

    // The same group with one slot no longer wanted. The slots that remain keep
    // their ids, so nothing about them is touched.
    const after = [before[0], before[2]];
    const plan = planReconcile(group, after, observed);

    expect(plan.create).toHaveLength(0);
    expect(plan.update).toHaveLength(0);
    expect(plan.remove).toEqual([{ path: 'game.Workspace.Rocks.R1', id: before[1].stamp.BloxForgeId }]);
  });

  it('acceptance: a user instance that looks identical is never touched', () => {
    const s = spec();
    const group = groupKey(s);
    const mine = desiredAt(s, 0, 0);
    const theirs: ObservedItem = {
      path: 'game.Workspace.Rocks.HandPlaced',
      // Same properties, and even the same id copied onto it — but not our
      // owner tag, so it is not ours.
      attributes: { ...mine.stamp, BloxForgeOwner: 'someone-else' },
      properties: mine.properties,
    };

    const plan = planReconcile(group, [], [theirs]);
    expect(plan.remove).toHaveLength(0);
    expect(plan.unowned).toBe(1);
    expect(isOwned(theirs.attributes)).toBe(false);
  });

  it('creates what is missing and updates only the properties that differ', () => {
    const s = spec();
    const group = groupKey(s);
    const a = desiredAt(s, 0, 0);
    const b = desiredAt(s, 1, 0, { Material: 'Granite' });
    const observed = [observedFrom(a, 'game.Workspace.Rocks.A', { Size: [4, 4, 4], Material: 'Slate' })];

    const plan = planReconcile(group, [a, b], observed);
    expect(plan.create).toEqual([b]);
    expect(plan.update).toHaveLength(0);
    expect(plan.remove).toHaveLength(0);

    const moved = planReconcile(group, [{ ...a, properties: { ...a.properties, Size: [6, 6, 6] } }], observed);
    expect(moved.update).toHaveLength(1);
    expect(moved.update[0].changed).toEqual(['Size']);
  });

  it('does not reset a property the desired set says nothing about', () => {
    const s = spec();
    const group = groupKey(s);
    const a = desiredAt(s, 0, 0);
    const observed = [observedFrom(a, 'game.Workspace.Rocks.A', { ...a.properties, Anchored: true })];
    expect(isZeroOp(planReconcile(group, [a], observed))).toBe(true);
  });

  it('leaves another group alone and counts it', () => {
    const s = spec();
    const other = spec({ density: 0.9 });
    const mine = desiredAt(s, 0, 0);
    const foreign = observedFrom(desiredAt(other, 0, 0), 'game.Workspace.Rocks.Other');

    const plan = planReconcile(groupKey(s), [mine], [foreign]);
    expect(plan.remove).toHaveLength(0);
    expect(plan.foreignGroup).toBe(1);
    expect(plan.create).toEqual([mine]);
  });

  it('fails closed on a duplicated identity rather than picking one', () => {
    const s = spec();
    const group = groupKey(s);
    const a = desiredAt(s, 0, 0);
    const twice = [observedFrom(a, 'game.Workspace.Rocks.A'), observedFrom(a, 'game.Workspace.Rocks.Copy')];

    expect(() => planReconcile(group, [a], twice)).toThrow(ReconcileConflict);
    try {
      planReconcile(group, [a], twice);
    } catch (error) {
      expect((error as ReconcileConflict).paths).toEqual(['game.Workspace.Rocks.A', 'game.Workspace.Rocks.Copy']);
    }
  });

  it('fails closed on our owner tag without a usable id or group', () => {
    const s = spec();
    const half: ObservedItem = {
      path: 'game.Workspace.Rocks.Half',
      attributes: { BloxForgeOwner: OWNER, BloxForgeGroup: '' },
      properties: {},
    };
    expect(() => planReconcile(groupKey(s), [], [half])).toThrow(/without a usable id and group/);
  });

  it('fails closed when the desired set resolves two items to one slot', () => {
    const s = spec();
    const a = desiredAt(s, 0, 0);
    expect(() => planReconcile(groupKey(s), [a, a], [])).toThrow(/twice/);
  });
});
