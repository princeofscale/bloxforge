import {
  auditProvenance,
  checkGates,
  rankCandidates,
  scoreAgainstStyle,
  type AssetGates,
  type ProvenanceRecord,
  type StyleWeights,
} from '../assets/provenance.js';

const weights: StyleWeights = { palette: 0.3, material: 0.2, scale: 0.2, visual: 0.2, trust: 0.1 };
const allow: AssetGates = { licenseAllowed: 'yes', permissionAllowed: 'yes', scriptRiskAllowed: 'yes' };

describe('provenance audit', () => {
  const full: ProvenanceRecord = {
    sourceUrl: 'https://example.org/rock', sha256: 'abc', retrievedAt: 1, licenseId: 'CC0-1.0',
  };

  it('is usable once the essential fields are there, and still names the gaps', () => {
    const audit = auditProvenance(full);
    expect(audit.usable).toBe(true);
    // A partial record that says which parts are missing is useful; one that
    // reports itself complete is not.
    expect(audit.missingExpected).toContain('creatorId');
    expect(audit.completeness).toBeLessThan(1);
  });

  it('is unusable without a licence, a source, a hash or a timestamp', () => {
    for (const key of ['sourceUrl', 'sha256', 'retrievedAt', 'licenseId'] as const) {
      const partial = { ...full };
      delete partial[key];
      expect(auditProvenance(partial).usable).toBe(false);
      expect(auditProvenance(partial).missingEssential).toContain(key);
    }
  });

  it('treats an empty string and an empty list as absent, not as filled in', () => {
    expect(auditProvenance({ ...full, licenseId: '' }).usable).toBe(false);
    expect(auditProvenance({ ...full, transformations: [] }).missingExpected).toContain('transformations');
  });
});

describe('hard gates', () => {
  it('lets through only an explicit yes on all three', () => {
    expect(checkGates(allow).allowed).toBe(true);
  });

  it('blocks on unknown exactly as it blocks on no', () => {
    // An unread licence is not a permissive one. Treating unknown as permission
    // is how a pipeline ships something nobody ever decided to ship.
    for (const key of ['licenseAllowed', 'permissionAllowed', 'scriptRiskAllowed'] as const) {
      expect(checkGates({ ...allow, [key]: 'unknown' }).allowed).toBe(false);
      expect(checkGates({ ...allow, [key]: 'no' }).allowed).toBe(false);
    }
  });

  it('says why, and distinguishes unknown from forbidden in the wording', () => {
    expect(checkGates({ ...allow, licenseAllowed: 'unknown' }).blocking[0]).toMatch(/unknown — an unread licence/);
    expect(checkGates({ ...allow, licenseAllowed: 'no' }).blocking[0]).toBe('license is not allowed');
  });
});

describe('style scoring', () => {
  it('scores a perfect match at 1 and a worst match at 0', () => {
    expect(scoreAgainstStyle(
      { paletteDeltaE: 0, materialDivergence: 0, scaleError: 0, visualSimilarity: 1, trust: 1 }, weights,
    ).score).toBe(1);
    expect(scoreAgainstStyle(
      { paletteDeltaE: 1, materialDivergence: 1, scaleError: 1, visualSimilarity: 0, trust: 0 }, weights,
    ).score).toBe(0);
  });

  it('drops an absent signal and names it rather than defaulting it', () => {
    // Scored as 0 it pushes the candidate down for a reason that has nothing to
    // do with the candidate; as 1 it pushes it up for the same non-reason.
    const scored = scoreAgainstStyle({ paletteDeltaE: 0, trust: 1 }, weights);
    expect(scored.missingSignals).toEqual(['material', 'scale', 'visual']);
    expect(scored.score).toBe(1);
    expect(scored.effectiveWeight).toBeCloseTo(0.4, 5);
  });

  it('reports a candidate with no measurable signal at all rather than ranking it', () => {
    const scored = scoreAgainstStyle({}, weights);
    expect(scored.score).toBe(0);
    expect(scored.effectiveWeight).toBe(0);
    expect(scored.missingSignals).toHaveLength(5);
  });

  it('ignores a non-finite signal instead of poisoning the score', () => {
    expect(scoreAgainstStyle({ trust: NaN, paletteDeltaE: 0 }, weights).missingSignals).toContain('trust');
  });
});

describe('ranking', () => {
  it('does not rank a blocked candidate at all', () => {
    // Returning it at position nine with a good style score invites exactly the
    // mistake the gates exist to prevent.
    const { ranked, blocked } = rankCandidates([
      { id: 'perfect-but-unlicensed', gates: { ...allow, licenseAllowed: 'unknown' }, signals: { paletteDeltaE: 0, materialDivergence: 0, scaleError: 0, visualSimilarity: 1, trust: 1 } },
      { id: 'mediocre-but-clear', gates: allow, signals: { paletteDeltaE: 0.5, materialDivergence: 0.5, scaleError: 0.5, visualSimilarity: 0.5, trust: 0.5 } },
    ], weights);

    expect(ranked.map((r) => r.id)).toEqual(['mediocre-but-clear']);
    expect(blocked.map((r) => r.id)).toEqual(['perfect-but-unlicensed']);
    expect(blocked[0].gates.blocking[0]).toMatch(/license is unknown/);
  });

  it('orders the cleared candidates by score, deterministically on a tie', () => {
    const same = { paletteDeltaE: 0.2, materialDivergence: 0.2, scaleError: 0.2, visualSimilarity: 0.8, trust: 0.8 };
    const { ranked } = rankCandidates([
      { id: 'b', gates: allow, signals: same },
      { id: 'a', gates: allow, signals: same },
      { id: 'best', gates: allow, signals: { paletteDeltaE: 0, materialDivergence: 0, scaleError: 0, visualSimilarity: 1, trust: 1 } },
    ], weights);
    expect(ranked.map((r) => r.id)).toEqual(['best', 'a', 'b']);
  });
});
