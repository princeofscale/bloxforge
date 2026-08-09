// Reconcile a desired generated set against what is actually in the scene.
//
// Roadmap D4. The rule that makes this safe is narrow and absolute: only
// instances this server stamped as its own are ever modified or deleted.
// Everything else is invisible to the plan, however much it resembles what we
// would have built.
//
// The failure this prevents is not hypothetical for a scatter generator. A user
// hand-places three of the same rock the generator produces, then asks for a
// lower density; a reconcile that matched on appearance, position or tag would
// delete their rocks along with ours and report a clean run.

import { IDENTITY_ATTRIBUTES, isOwned, type IdentityStamp } from './identity.js';

export interface DesiredItem {
  /** Where it goes, and what it is. Opaque here — the generator owns the shape. */
  readonly stamp: IdentityStamp;
  readonly properties: Readonly<Record<string, unknown>>;
}

export interface ObservedItem {
  readonly path: string;
  readonly attributes: Readonly<Record<string, unknown>>;
  readonly properties: Readonly<Record<string, unknown>>;
}

export interface ReconcilePlan {
  create: DesiredItem[];
  update: { path: string; item: DesiredItem; changed: string[] }[];
  remove: { path: string; id: string }[];
  /** Owned instances from another group: seen, deliberately untouched. */
  foreignGroup: number;
  /** Instances that are not ours at all. Counted so a zero-op run can say so. */
  unowned: number;
}

export class ReconcileConflict extends Error {
  constructor(message: string, readonly paths: readonly string[]) {
    super(message);
    this.name = 'ReconcileConflict';
  }
}

function changedKeys(
  desired: Readonly<Record<string, unknown>>,
  observed: Readonly<Record<string, unknown>>,
): string[] {
  const changed: string[] = [];
  for (const [key, value] of Object.entries(desired)) {
    if (JSON.stringify(observed[key]) !== JSON.stringify(value)) changed.push(key);
  }
  // Deliberately one-directional: a property the desired set does not mention
  // is not ours to reset. A generator that sets Size and Colour has no opinion
  // about a Tag someone added afterwards.
  return changed;
}

/**
 * Build the plan. Pure — it decides nothing about how the plan is applied.
 *
 * Fails closed on two ambiguities rather than guessing, because both mean the
 * scene is not in a state this model describes and acting would be acting on a
 * wrong belief:
 *
 * - **duplicate identity**: two owned instances carrying the same `BloxForgeId`.
 *   Updating "the" instance means picking one, and the other silently drifts.
 * - **owned but unidentified**: our owner tag with no id or no group. Something
 *   half-wrote it, and we cannot tell whether it belongs to this group.
 */
export function planReconcile(
  group: string,
  desired: readonly DesiredItem[],
  observed: readonly ObservedItem[],
): ReconcilePlan {
  const desiredById = new Map<string, DesiredItem>();
  for (const item of desired) {
    if (desiredById.has(item.stamp.BloxForgeId)) {
      throw new ReconcileConflict(
        `desired set contains ${item.stamp.BloxForgeId} twice — two items resolved to the same module slot`,
        [],
      );
    }
    desiredById.set(item.stamp.BloxForgeId, item);
  }

  const ownedById = new Map<string, ObservedItem>();
  const duplicates = new Map<string, string[]>();
  const malformed: string[] = [];
  let foreignGroup = 0;
  let unowned = 0;

  for (const instance of observed) {
    if (!isOwned(instance.attributes)) {
      unowned++;
      continue;
    }
    const id = instance.attributes[IDENTITY_ATTRIBUTES.id];
    const itsGroup = instance.attributes[IDENTITY_ATTRIBUTES.group];
    if (typeof id !== 'string' || id === '' || typeof itsGroup !== 'string' || itsGroup === '') {
      malformed.push(instance.path);
      continue;
    }
    if (itsGroup !== group) {
      foreignGroup++;
      continue;
    }
    const existing = ownedById.get(id);
    if (existing) {
      const paths = duplicates.get(id) ?? [existing.path];
      paths.push(instance.path);
      duplicates.set(id, paths);
      continue;
    }
    ownedById.set(id, instance);
  }

  if (malformed.length > 0) {
    throw new ReconcileConflict(
      `${malformed.length} instance(s) carry BloxForgeOwner without a usable id and group — refusing to guess whether they belong to this group`,
      malformed,
    );
  }
  if (duplicates.size > 0) {
    const paths = [...duplicates.values()].flat();
    throw new ReconcileConflict(
      `${duplicates.size} BloxForgeId(s) appear on more than one instance — updating one would leave the other drifting`,
      paths,
    );
  }

  const plan: ReconcilePlan = { create: [], update: [], remove: [], foreignGroup, unowned };

  for (const [id, item] of desiredById) {
    const instance = ownedById.get(id);
    if (!instance) {
      plan.create.push(item);
      continue;
    }
    const changed = changedKeys(item.properties, instance.properties);
    if (changed.length > 0) plan.update.push({ path: instance.path, item, changed });
  }
  for (const [id, instance] of ownedById) {
    if (!desiredById.has(id)) plan.remove.push({ path: instance.path, id });
  }

  return plan;
}

/** True when the plan would touch nothing — the roadmap's zero-op acceptance. */
export function isZeroOp(plan: ReconcilePlan): boolean {
  return plan.create.length === 0 && plan.update.length === 0 && plan.remove.length === 0;
}
