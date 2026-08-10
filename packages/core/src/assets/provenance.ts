// What has to be known about an asset before it is allowed into a place.
//
// Roadmap C3. The record is long because the questions it answers are asked
// later, by someone who was not there: where did this come from, may we ship
// it, who said so, and what did we do to it on the way in. A record missing a
// field is not a smaller record — it is a question that will be answered by
// guessing.
//
// The distinction this file exists to hold: **"permitted" and "not known to be
// forbidden" are different answers.** A missing licence is not a permissive
// one, and an absent moderation state is not an approved one.

export type Tri = 'yes' | 'no' | 'unknown';

export interface ProvenanceRecord {
  // where it came from
  sourceUrl?: string;
  sourceAssetId?: string;
  sourceVersionId?: string;
  retrievedAt?: number;

  // what it is
  sha256?: string;
  originalFilename?: string;
  mimeType?: string;
  bytes?: number;

  // who made it
  creatorId?: string;
  creatorName?: string;

  // what we may do with it
  licenseId?: string;
  licenseVersion?: string;
  licenseUrl?: string;
  attributionText?: string;

  // what we did to it
  transformations?: { tool: string; version: string; note?: string }[];
  derivedAssetIds?: string[];

  // what Roblox says about it
  uploadOperationId?: string;
  robloxAssetId?: string;
  moderationState?: Tri;
  permissionState?: Tri;

  // who approved it, and under what policy
  approvedBy?: string;
  approvedAction?: string;
  projectPolicyVersion?: string;

  // how it was chosen
  styleProfileHash?: string;
  rankingEvidence?: string[];
}

/**
 * Fields without which the record cannot answer the question it exists for.
 *
 * Deliberately shorter than the full schema: this is the line below which a
 * record is not worth keeping, not a wish list. Everything else is reported as
 * a gap rather than an error, because a partial record that says which parts
 * are missing is useful and one that pretends to be complete is not.
 */
const ESSENTIAL: (keyof ProvenanceRecord)[] = ['sourceUrl', 'sha256', 'retrievedAt', 'licenseId'];

const EXPECTED: (keyof ProvenanceRecord)[] = [
  'sourceAssetId', 'sourceVersionId', 'originalFilename', 'mimeType', 'bytes',
  'creatorId', 'creatorName', 'licenseVersion', 'licenseUrl', 'attributionText',
  'transformations', 'uploadOperationId', 'robloxAssetId', 'moderationState',
  'permissionState', 'approvedBy', 'approvedAction', 'projectPolicyVersion',
  'styleProfileHash', 'rankingEvidence',
];

export interface ProvenanceAudit {
  usable: boolean;
  missingEssential: string[];
  missingExpected: string[];
  completeness: number;
}

export function auditProvenance(record: ProvenanceRecord): ProvenanceAudit {
  const absent = (k: keyof ProvenanceRecord) => {
    const v = record[k];
    return v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
  };
  const missingEssential = ESSENTIAL.filter(absent).map(String);
  const missingExpected = EXPECTED.filter(absent).map(String);
  const total = ESSENTIAL.length + EXPECTED.length;
  return {
    usable: missingEssential.length === 0,
    missingEssential,
    missingExpected,
    completeness: Math.round(((total - missingEssential.length - missingExpected.length) / total) * 100) / 100,
  };
}

export interface AssetGates {
  licenseAllowed: Tri;
  permissionAllowed: Tri;
  scriptRiskAllowed: Tri;
}

export interface GateVerdict {
  allowed: boolean;
  blocking: string[];
}

/**
 * The hard gates. No score, weight or preference can move these.
 *
 * `unknown` blocks. That is the whole design: an unread licence is not a
 * permissive one, an asset whose moderation state has not come back is not an
 * approved one, and a model whose scripts were never examined is not a safe
 * one. Treating unknown as permission is how a pipeline ends up shipping
 * something nobody ever decided to ship.
 */
export function checkGates(gates: AssetGates): GateVerdict {
  const blocking: string[] = [];
  const check = (value: Tri, name: string, unknownMeans: string) => {
    if (value === 'no') blocking.push(`${name} is not allowed`);
    else if (value === 'unknown') blocking.push(`${name} is unknown — ${unknownMeans}`);
  };
  check(gates.licenseAllowed, 'license', 'an unread licence is not a permissive one');
  check(gates.permissionAllowed, 'permission', 'an asset whose permission state has not come back is not approved');
  check(gates.scriptRiskAllowed, 'script risk', 'a model whose scripts were never examined is not a safe one');
  return { allowed: blocking.length === 0, blocking };
}

export interface StyleProfile {
  hash: string;
  /** Share of the palette in each hue bucket. Sums to about 1. */
  paletteDistribution: Record<string, number>;
  /** Share of surface area per material. */
  materialHistogram: Record<string, number>;
  /** Typical dimension relative to an avatar or module. */
  scaleRatios: { avatar: number; module: number };
  textureDensity: number;
}

export interface StyleWeights {
  palette: number;
  material: number;
  scale: number;
  visual: number;
  trust: number;
}

export interface CandidateSignals {
  /** Normalized ΔE2000 against the profile palette, 0 best. */
  paletteDeltaE?: number;
  /** Jensen-Shannon divergence of material histograms, 0 best. */
  materialDivergence?: number;
  /** Normalized scale error, 0 best. */
  scaleError?: number;
  /** Cosine similarity of embeddings, 1 best. */
  visualSimilarity?: number;
  /** Source trust, 1 best. */
  trust?: number;
}

export interface StyleScore {
  score: number;
  /** Signals that were absent and therefore not scored, named. */
  missingSignals: string[];
  /** The weight actually used, after dropping absent signals. */
  effectiveWeight: number;
}

/**
 * Score a candidate against a style profile.
 *
 * Absent signals are dropped and named rather than defaulted. A missing
 * embedding scored as 0 similarity pushes a candidate down for a reason that
 * has nothing to do with the candidate, and scored as 1 pushes it up for the
 * same non-reason — and the roadmap is explicit that a field which is not
 * actually in the provider's response must not be invented. The remaining
 * weights are renormalized so two candidates measured on different signals are
 * not compared on different scales without saying so.
 */
export function scoreAgainstStyle(
  signals: CandidateSignals,
  weights: StyleWeights,
): StyleScore {
  const terms: { name: string; weight: number; value: number | undefined }[] = [
    { name: 'palette', weight: weights.palette, value: signals.paletteDeltaE === undefined ? undefined : 1 - signals.paletteDeltaE },
    { name: 'material', weight: weights.material, value: signals.materialDivergence === undefined ? undefined : 1 - signals.materialDivergence },
    { name: 'scale', weight: weights.scale, value: signals.scaleError === undefined ? undefined : 1 - signals.scaleError },
    { name: 'visual', weight: weights.visual, value: signals.visualSimilarity },
    { name: 'trust', weight: weights.trust, value: signals.trust },
  ];

  const present = terms.filter((t) => t.value !== undefined && Number.isFinite(t.value));
  const missingSignals = terms.filter((t) => !present.includes(t)).map((t) => t.name);
  const effectiveWeight = present.reduce((sum, t) => sum + t.weight, 0);
  if (effectiveWeight === 0) {
    return { score: 0, missingSignals, effectiveWeight: 0 };
  }
  const score = present.reduce((sum, t) => sum + t.weight * Math.max(0, Math.min(1, t.value!)), 0) / effectiveWeight;
  return { score: Math.round(score * 1000) / 1000, missingSignals, effectiveWeight };
}

export interface RankedCandidate {
  id: string;
  gates: GateVerdict;
  style?: StyleScore;
}

/**
 * Rank candidates, with the gates applied first and absolutely.
 *
 * A blocked candidate is not ranked low — it is not ranked. Returning it at
 * position nine with a good style score invites exactly the mistake the gates
 * exist to prevent.
 */
export function rankCandidates(
  candidates: readonly { id: string; gates: AssetGates; signals: CandidateSignals }[],
  weights: StyleWeights,
): { ranked: RankedCandidate[]; blocked: RankedCandidate[] } {
  const ranked: RankedCandidate[] = [];
  const blocked: RankedCandidate[] = [];
  for (const candidate of candidates) {
    const verdict = checkGates(candidate.gates);
    if (!verdict.allowed) {
      blocked.push({ id: candidate.id, gates: verdict });
      continue;
    }
    ranked.push({ id: candidate.id, gates: verdict, style: scoreAgainstStyle(candidate.signals, weights) });
  }
  ranked.sort((a, b) => (b.style!.score - a.style!.score) || a.id.localeCompare(b.id));
  return { ranked, blocked };
}
