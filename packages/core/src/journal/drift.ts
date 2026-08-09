// Three-way reconcile: journal baseline, current live scene, proposed plan.
//
// Roadmap B5. Two-way comparison cannot answer the question that matters. If
// the live scene differs from the plan, a two-way diff knows only that they
// differ — not whether the plan is stale or the scene has been edited since.
// Those want opposite responses, and guessing wrong either discards a user's
// work or re-applies a change they deliberately reverted.
//
// The third side is the baseline: what the journal says this stage left behind.
//
//   live == baseline            the scene is as we left it. Apply.
//   live != baseline, plan same  someone edited what we own. Stop.
//
// Divergence never resolves itself. It comes back as a choice — adopt, replan,
// or a reviewed diff — because every automatic answer here silently destroys
// one side of a disagreement between a person and a machine.

import { IDENTITY_ATTRIBUTES, isOwned } from '../identity/identity.js';

export interface LiveInstance {
  path: string;
  attributes: Readonly<Record<string, unknown>>;
  /** Digest of the properties this stage claims to control. */
  digest: string;
}

export interface PlannedChange {
  id: string;
  /** Digest the plan expects to find before it writes. */
  expected?: string;
  /** Digest the plan intends to leave. Absent means "remove". */
  intended?: string;
}

export type Divergence =
  | { kind: 'edited'; id: string; path: string; baseline: string; live: string }
  | { kind: 'vanished'; id: string; baseline: string }
  | { kind: 'appeared'; id: string; path: string; live: string }
  | { kind: 'duplicate'; id: string; paths: string[] };

export type Resolution = 'adopt' | 'replan' | 'review';

export interface DriftReport {
  clean: boolean;
  divergences: Divergence[];
  /** Offered only when there is something to resolve. */
  resolutions: Resolution[];
  /** Planned ids whose owned instance is missing from the live scene. */
  scope: { baseline: number; live: number; planned: number };
}

/**
 * Compare the three sides over the ids the plan and baseline actually name.
 *
 * Restricted to owned instances on purpose: a user's own additions are not
 * drift, they are the place. Only what this server claims to control is
 * compared, and only what it recorded is treated as a baseline.
 */
export function detectDrift(
  baseline: readonly { id: string; post?: string }[],
  live: readonly LiveInstance[],
  plan: readonly PlannedChange[],
): DriftReport {
  const baselineById = new Map<string, string>();
  for (const b of baseline) {
    // An entry with no post digest recorded a removal; there is nothing left to
    // compare, and treating its absence as drift would flag every deletion we
    // performed ourselves.
    if (b.post !== undefined) baselineById.set(b.id, b.post);
  }

  const liveById = new Map<string, LiveInstance>();
  const duplicates = new Map<string, string[]>();
  for (const instance of live) {
    if (!isOwned(instance.attributes)) continue;
    const id = instance.attributes[IDENTITY_ATTRIBUTES.id];
    if (typeof id !== 'string' || id === '') continue;
    const existing = liveById.get(id);
    if (existing) {
      duplicates.set(id, [...(duplicates.get(id) ?? [existing.path]), instance.path]);
      continue;
    }
    liveById.set(id, instance);
  }

  const divergences: Divergence[] = [];
  for (const [id, paths] of duplicates) divergences.push({ kind: 'duplicate', id, paths });

  // Only ids the plan touches or the baseline recorded are in scope. An owned
  // instance from a different stage is not this stage's business.
  const inScope = new Set<string>([...baselineById.keys(), ...plan.map((p) => p.id)]);

  for (const id of inScope) {
    const wasDuplicated = duplicates.has(id);
    if (wasDuplicated) continue;
    const recorded = baselineById.get(id);
    const now = liveById.get(id);

    if (recorded !== undefined && now === undefined) {
      divergences.push({ kind: 'vanished', id, baseline: recorded });
      continue;
    }
    if (recorded === undefined && now !== undefined) {
      // We never recorded this and yet it carries our ownership: either an
      // interrupted run or a journal that lost its tail. Either way the plan's
      // idea of "create" is wrong about it.
      divergences.push({ kind: 'appeared', id, path: now.path, live: now.digest });
      continue;
    }
    if (recorded !== undefined && now !== undefined && recorded !== now.digest) {
      divergences.push({ kind: 'edited', id, path: now.path, baseline: recorded, live: now.digest });
    }
  }

  const clean = divergences.length === 0;
  return {
    clean,
    divergences,
    // A duplicate id is not adoptable: there is no single current state to
    // adopt. Offering `adopt` there would invite a choice that cannot be made.
    resolutions: clean
      ? []
      : divergences.some((d) => d.kind === 'duplicate')
        ? ['review']
        : ['adopt', 'replan', 'review'],
    scope: { baseline: baselineById.size, live: liveById.size, planned: plan.length },
  };
}

/**
 * Whether a plan may be applied.
 *
 * Deliberately not `!report.divergences.length` at the call site: this is the
 * one decision the whole three-way comparison exists to make, and it should be
 * named once rather than re-derived by every caller that might get it wrong.
 */
export function mayApply(report: DriftReport): boolean {
  return report.clean;
}
