import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

import { OWNER } from '../identity/identity.js';
import { evaluateAcceptance, type AcceptanceContract } from '../journal/acceptance.js';
import { detectDrift, mayApply, type LiveInstance } from '../journal/drift.js';
import {
  appendEntry,
  JournalError,
  journalPathFor,
  JOURNAL_SCHEMA_VERSION,
  latestFor,
  readJournal,
  type JournalEntry,
} from '../journal/journal.js';

const entry = (over: Partial<JournalEntry> = {}): JournalEntry => ({
  schemaVersion: JOURNAL_SCHEMA_VERSION,
  placeId: '123',
  baselineDigest: 'sha256:base',
  revision: 41,
  stage: 'environment',
  intent: 'set the mood',
  planHash: 'sha256:plan',
  paths: [{ id: 'a', post: 'd1' }],
  acceptance: { contract: 'env@1', result: 'passed' },
  warnings: [],
  ...over,
});

const owned = (id: string, digest: string, path = `game.Workspace.${id}`): LiveInstance => ({
  path,
  attributes: { BloxForgeOwner: OWNER, BloxForgeId: id },
  digest,
});

describe('journal surface', () => {
  it('refuses to pick a persistence surface for a Studio-only place', () => {
    // The two options are not interchangeable: plugin settings are machine-local
    // and vanish for a teammate; DataModel metadata modifies the very artefact
    // being recorded. Choosing silently would misrepresent where history lives.
    expect(() => journalPathFor({ kind: 'plugin-settings' })).toThrow(/not a file/);
    expect(() => journalPathFor({ kind: 'datamodel' })).toThrow(/not a file/);
  });
});

describe('journal store', () => {
  let root: string;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'bloxforge-journal-')); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it('appends and reads back in order', () => {
    const surface = { kind: 'repository' as const, root };
    appendEntry(surface, entry({ revision: 41 }));
    appendEntry(surface, entry({ revision: 42, stage: 'terrain' }));
    const { entries, truncatedTail } = readJournal(surface);
    expect(entries.map((e) => e.revision)).toEqual([41, 42]);
    expect(truncatedTail).toBe(false);
    expect(latestFor(entries, 'environment')?.revision).toBe(41);
    expect(latestFor(entries, 'nothing')).toBeUndefined();
  });

  it('an absent journal is empty, not an error', () => {
    expect(readJournal({ kind: 'repository', root }).entries).toEqual([]);
  });

  it('tolerates a torn last line but not a hole in the middle', () => {
    const surface = { kind: 'repository' as const, root };
    appendEntry(surface, entry());
    const path = journalPathFor(surface);

    writeFileSync(path, `${readFileSync(path, 'utf8')}{"schemaVersion":1,"placeId":`);
    const torn = readJournal(surface);
    expect(torn.entries).toHaveLength(1);
    expect(torn.truncatedTail).toBe(true);

    // The same damage anywhere but the end means entries were lost, and a
    // baseline with holes that reports itself complete is worse than none.
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `{"broken":\n${JSON.stringify(entry())}\n`);
    expect(() => readJournal(surface)).toThrow(/hole in it/);
  });

  it('refuses an entry from a schema version it does not read', () => {
    expect(() => appendEntry({ kind: 'repository', root }, entry({ schemaVersion: 99 })))
      .toThrow(JournalError);
  });

  it('refuses an entry that records nothing about a path', () => {
    expect(() => appendEntry({ kind: 'repository', root }, entry({ paths: [{ id: 'a' }] })))
      .toThrow(/neither a pre nor a post/);
  });

  it('refuses a duplicated path id', () => {
    expect(() => appendEntry({ kind: 'repository', root }, entry({ paths: [{ id: 'a', post: '1' }, { id: 'a', post: '2' }] })))
      .toThrow(/twice/);
  });
});

describe('three-way drift', () => {
  it('is clean when the live scene is exactly what the journal recorded', () => {
    const report = detectDrift([{ id: 'a', post: 'd1' }], [owned('a', 'd1')], [{ id: 'a', intended: 'd2' }]);
    expect(report.clean).toBe(true);
    expect(mayApply(report)).toBe(true);
    expect(report.resolutions).toEqual([]);
  });

  it('stops the write when someone edited what we own', () => {
    const report = detectDrift([{ id: 'a', post: 'd1' }], [owned('a', 'edited')], [{ id: 'a', intended: 'd2' }]);
    expect(mayApply(report)).toBe(false);
    expect(report.divergences).toEqual([
      { kind: 'edited', id: 'a', path: 'game.Workspace.a', baseline: 'd1', live: 'edited' },
    ]);
    // Never resolved automatically: every automatic answer here destroys one
    // side of a disagreement between a person and a machine.
    expect(report.resolutions).toEqual(['adopt', 'replan', 'review']);
  });

  it('notices what the journal recorded and the scene no longer has', () => {
    const report = detectDrift([{ id: 'a', post: 'd1' }], [], [{ id: 'a', intended: 'd2' }]);
    expect(report.divergences).toEqual([{ kind: 'vanished', id: 'a', baseline: 'd1' }]);
  });

  it('notices something owned that was never recorded', () => {
    const report = detectDrift([], [owned('a', 'd1')], [{ id: 'a', intended: 'd2' }]);
    expect(report.divergences).toEqual([
      { kind: 'appeared', id: 'a', path: 'game.Workspace.a', live: 'd1' },
    ]);
  });

  it('does not treat a removal we performed as drift', () => {
    // No post digest means the entry recorded a removal; its absence now is the
    // recorded outcome, not a divergence.
    const report = detectDrift([{ id: 'a' }], [], [{ id: 'b', intended: 'd' }]);
    expect(report.clean).toBe(true);
  });

  it("ignores the user's own instances entirely", () => {
    const theirs: LiveInstance = { path: 'game.Workspace.Theirs', attributes: {}, digest: 'whatever' };
    const report = detectDrift([{ id: 'a', post: 'd1' }], [owned('a', 'd1'), theirs], [{ id: 'a' }]);
    expect(report.clean).toBe(true);
    expect(report.scope.live).toBe(1);
  });

  it('ignores an owned instance from another stage that this plan does not touch', () => {
    const report = detectDrift([{ id: 'a', post: 'd1' }], [owned('a', 'd1'), owned('z', 'other')], [{ id: 'a' }]);
    expect(report.clean).toBe(true);
  });

  it('offers only review for a duplicated id, because there is no single state to adopt', () => {
    const report = detectDrift(
      [{ id: 'a', post: 'd1' }],
      [owned('a', 'd1', 'game.Workspace.One'), owned('a', 'd1', 'game.Workspace.Two')],
      [{ id: 'a' }],
    );
    expect(report.clean).toBe(false);
    expect(report.divergences).toEqual([
      { kind: 'duplicate', id: 'a', paths: ['game.Workspace.One', 'game.Workspace.Two'] },
    ]);
    expect(report.resolutions).toEqual(['review']);
  });
});

describe('acceptance contract', () => {
  const contract = (over: Partial<AcceptanceContract> = {}): AcceptanceContract => ({
    contract: 'env@1',
    preconditions: { revision: 41, baselineDigest: 'sha256:base' },
    planHash: 'sha256:plan',
    gates: [
      { id: 'static_scenery_unanchored', hard: true, result: 'passed' },
      { id: 'route_legibility', hard: false, result: 'passed' },
    ],
    evidence: { retain: ['metrics', 'sceneDigest'] },
    ...over,
  });
  const observed = { revision: 41, baselineDigest: 'sha256:base' };

  it('passes when every gate passed and the preconditions hold', () => {
    expect(evaluateAcceptance(contract(), observed).passed).toBe(true);
  });

  it('an unknown hard invariant is not a pass', () => {
    const verdict = evaluateAcceptance(
      contract({ gates: [{ id: 'expected_values_match', hard: true, result: 'unknown' }] }),
      observed,
    );
    expect(verdict.passed).toBe(false);
    expect(verdict.counts.hardUnknown).toBe(1);
    // Worded as "could not be evaluated" rather than "failed": the two lead to
    // different next actions, and collapsing them is how an unrunnable check
    // becomes a permanent pass.
    expect(verdict.reasons[0]).toMatch(/could not be evaluated/);
  });

  it('an unknown soft gate is a missing opinion, not a violation', () => {
    const verdict = evaluateAcceptance(
      contract({
        gates: [
          { id: 'static_scenery_unanchored', hard: true, result: 'passed' },
          { id: 'route_legibility', hard: false, result: 'unknown' },
        ],
      }),
      observed,
    );
    expect(verdict.passed).toBe(true);
    expect(verdict.counts.unknown).toBe(1);
    expect(verdict.counts.hardUnknown).toBe(0);
  });

  it('an empty contract cannot be satisfied', () => {
    const verdict = evaluateAcceptance(contract({ gates: [] }), observed);
    expect(verdict.passed).toBe(false);
    expect(verdict.reasons).toContain('the contract declares no gates, so it cannot be satisfied');
  });

  it('reports an inapplicable contract rather than a failing one', () => {
    const verdict = evaluateAcceptance(contract(), { revision: 42, baselineDigest: 'sha256:base' });
    expect(verdict.passed).toBe(false);
    expect(verdict.reasons[0]).toMatch(/written for revision 41, the place is at 42/);
    expect(verdict.counts.failed).toBe(0);
  });

  it('rejects evidence gathered under a different plan or revision', () => {
    expect(evaluateAcceptance(
      contract({ evidence: { retain: [], planHash: 'sha256:other' } }), observed,
    ).reasons).toContain('evidence was gathered against a different planHash than the contract names');
    expect(evaluateAcceptance(
      contract({ evidence: { retain: [], revision: 40 } }), observed,
    ).reasons).toContain('evidence was gathered at a different revision than the contract names');
  });
});
