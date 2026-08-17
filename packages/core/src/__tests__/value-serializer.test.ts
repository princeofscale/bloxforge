import { LOSSY_WITHOUT_FULL_SHAPE } from '../engine/capability-registry.js';
import { buildNodeBatchLuau, buildWorldSnapshotLuau, STRUCTURED_VALUE_TYPES } from '../builders/world-model.js';
import { buildSceneSummaryLuau } from '../builders/scene-summary.js';
import { buildSceneSearchLuau } from '../builders/scene-search.js';
import { buildSpatialLayoutLuau } from '../builders/scene-layout.js';

describe('the lossy list and the serializer', () => {
  it('handles every type the capability registry calls lossy', () => {
    // The list is a guard only if something consults it. CFrame was on it once,
    // and losing its rotation was silent precisely because nothing did.
    const structured = new Set(STRUCTURED_VALUE_TYPES);
    const unhandled = Object.keys(LOSSY_WITHOUT_FULL_SHAPE).filter((type) => !structured.has(type));
    expect(unhandled).toEqual([]);
  });

  it('emits a branch for each type it claims to structure', () => {
    const luau = buildNodeBatchLuau(['game.Workspace']);
    for (const type of STRUCTURED_VALUE_TYPES) {
      expect(luau).toContain(`== "${type}"`);
    }
  });

  it('names what it could not structure instead of returning a bare string', () => {
    // An opaque blob that looks like a value is how a caller writes back
    // something that is not what it read.
    expect(buildNodeBatchLuau(['game.Workspace'])).toMatch(/__opaque = tostring\(v\), __type = t/);
  });
});

describe('every ordering has a tie-break', () => {
  // The runtime harness asserts the *property* — that a returned list is
  // ordered — but it can only assert it on the values a fixture happens to
  // produce, and a fixture with no ties makes that check pass vacuously.
  // Removing a tie-break from scene-summary did not fail the harness. This
  // asserts the comparator itself, which cannot pass for want of a tie.
  const comparators: [string, string, string][] = [
    ['scene summary', buildSceneSummaryLuau('game.Workspace', 5), 'a.className < b.className'],
    ['world snapshot', buildWorldSnapshotLuau('game', 'overview', 5), 'a.className < b.className'],
    ['scene search', buildSceneSearchLuau('x', 'game.Workspace', 5), 'a.path < b.path'],
    ['spatial layout', buildSpatialLayoutLuau('game.Workspace', 16, 5), 'a.name < b.name'],
  ];

  it.each(comparators)('%s breaks ties rather than leaving pairs() to decide', (_label, luau, tieBreak) => {
    expect(luau).toContain(tieBreak);
  });

  it('has no single-key sort left in a builder that returns a ranked list', () => {
    for (const [, luau] of comparators) {
      // `return a.x > b.x end)` on one line is the shape every one of these had.
      expect(luau).not.toMatch(/table\.sort\([^)]*function\(a, b\) return a\.\w+ > b\.\w+ end\)/);
    }
  });
});
