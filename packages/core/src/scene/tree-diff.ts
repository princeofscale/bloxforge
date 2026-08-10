// What actually changed between two instance trees.
//
// Roadmap 04, item 4 — the half of the rbx-dom proposal that does not need a
// binary. The proposal was to pin `rbx_util`, parse `.rbxl` offline, and diff
// the results; but the parsing is the replaceable part and the diff is the
// payoff. A diff that works on *any* tree works on a Studio read, on the UI
// exporter's output, on a CI fixture, and on whatever a parser produces later.
//
// The point is not "these two trees differ" — comparing serialized JSON says
// that. It is **which** things differ and whether any of it matters:
//
//   - A moved instance is not a delete plus an add. Reported as two, a reviewer
//     reads a rebuild where a reparent happened.
//   - A property that changed from `0.30000000000000004` to `0.3` is float
//     noise, and reporting it buries the one property that moved for a reason.
//   - A subtree that is identical does not need to be walked, said, or read.

export interface TreeNode {
  /** Stable identity within the tree. Falls back to the path when absent. */
  id?: string;
  name: string;
  className: string;
  properties?: Record<string, unknown>;
  children?: TreeNode[];
}

export type ChangeKind = 'added' | 'removed' | 'moved' | 'renamed' | 'reclassed' | 'property';

export interface TreeChange {
  kind: ChangeKind;
  /** Path in the tree the change is anchored to. */
  path: string;
  /** For a move, where it came from. */
  from?: string;
  property?: string;
  before?: unknown;
  after?: unknown;
}

export interface TreeDiff {
  changes: TreeChange[];
  /** Subtrees identical on both sides, named once instead of walked. */
  unchangedSubtrees: string[];
  /** True when nothing differs at all. */
  identical: boolean;
}

export interface DiffOptions {
  /** Properties to ignore entirely — timestamps, generated ids. */
  ignoreProperties?: readonly string[];
  /**
   * Numbers closer than this count as equal.
   *
   * Defaults to 1e-6. Roblox round-trips floats through several
   * representations, so exact comparison reports arithmetic noise as a change
   * and buries the one property that moved for a reason.
   */
  epsilon?: number;
}

const DEFAULT_EPSILON = 1e-6;

/**
 * Compare two trees.
 *
 * Children are matched by `id` when both sides have one, and by name
 * otherwise — never by class, since a Part that became a MeshPart is the same
 * instance reclassed. Identity beats position: a child that moved from index 2
 * to index 0 has not changed, and a diff that says it has is noise that trains
 * a reader to skim.
 */
export function diffTrees(before: TreeNode, after: TreeNode, options: DiffOptions = {}): TreeDiff {
  const ignore = new Set(options.ignoreProperties ?? []);
  const epsilon = options.epsilon ?? DEFAULT_EPSILON;
  const changes: TreeChange[] = [];
  const unchangedSubtrees: string[] = [];

  // A first pass records where every identified node lives on each side, so a
  // node that appears somewhere else can be reported as a move rather than as a
  // removal and an unrelated addition.
  const beforeHomes = new Map<string, string>();
  const afterHomes = new Map<string, string>();
  indexById(before, '', beforeHomes);
  indexById(after, '', afterHomes);

  walk(before, after, '', changes, unchangedSubtrees, { ignore, epsilon, beforeHomes, afterHomes, beforeRoot: before });
  return { changes, unchangedSubtrees, identical: changes.length === 0 };
}

interface WalkContext {
  ignore: Set<string>;
  epsilon: number;
  beforeHomes: Map<string, string>;
  afterHomes: Map<string, string>;
  /** The whole `before` tree. A moved node is looked up from the root, because
   *  by definition it is no longer under the parent being walked. */
  beforeRoot: TreeNode;
}

function indexById(node: TreeNode, parentPath: string, into: Map<string, string>): void {
  const path = parentPath === '' ? node.name : `${parentPath}.${node.name}`;
  if (node.id) into.set(node.id, path);
  for (const child of node.children ?? []) indexById(child, path, into);
}

function walk(
  before: TreeNode,
  after: TreeNode,
  parentPath: string,
  changes: TreeChange[],
  unchanged: string[],
  ctx: WalkContext,
): void {
  const path = parentPath === '' ? after.name : `${parentPath}.${after.name}`;

  if (before.name !== after.name) {
    changes.push({ kind: 'renamed', path, before: before.name, after: after.name });
  }
  if (before.className !== after.className) {
    // Not a property change: every property on it means something different now.
    changes.push({ kind: 'reclassed', path, before: before.className, after: after.className });
  }

  for (const [key, afterValue] of Object.entries(after.properties ?? {})) {
    if (ctx.ignore.has(key)) continue;
    const beforeValue = (before.properties ?? {})[key];
    if (!equalValues(beforeValue, afterValue, ctx.epsilon)) {
      changes.push({ kind: 'property', path, property: key, before: beforeValue, after: afterValue });
    }
  }
  for (const key of Object.keys(before.properties ?? {})) {
    if (ctx.ignore.has(key) || key in (after.properties ?? {})) continue;
    changes.push({ kind: 'property', path, property: key, before: (before.properties ?? {})[key], after: undefined });
  }

  // Matched by identity, then by name. Deliberately *not* by class: a Part that
  // became a MeshPart is the same instance reclassed, and keying on class made
  // it read as a removal plus an unrelated addition — the exact confusion this
  // diff exists to avoid. Siblings sharing a name are paired in order, which is
  // the only thing left to go on.
  const beforeChildren = groupChildren(before.children ?? []);
  const afterChildren = groupChildren(after.children ?? []);

  for (const [key, afterChild] of afterChildren) {
    const beforeChild = beforeChildren.get(key);
    const childPath = `${path}.${afterChild.name}`;
    if (beforeChild) {
      const beforeCount = changes.length;
      walk(beforeChild, afterChild, path, changes, unchanged, ctx);
      // Only whole subtrees are worth naming; saying "unchanged" about every
      // leaf would be longer than the diff.
      if (changes.length === beforeCount && (afterChild.children ?? []).length > 0) {
        unchanged.push(childPath);
      }
      continue;
    }
    const previousHome = afterChild.id ? ctx.beforeHomes.get(afterChild.id) : undefined;
    if (previousHome && previousHome !== childPath) {
      // Reported as one move rather than a delete and an add, because a
      // reviewer reads the latter as a rebuild.
      changes.push({ kind: 'moved', path: childPath, from: previousHome });
      const moved = findById(ctx.beforeRoot, afterChild.id!);
      if (moved) walk(moved, afterChild, path, changes, unchanged, ctx);
      continue;
    }
    changes.push({ kind: 'added', path: childPath });
  }

  for (const [key, beforeChild] of beforeChildren) {
    if (afterChildren.has(key)) continue;
    const stillPresent = beforeChild.id ? ctx.afterHomes.has(beforeChild.id) : false;
    // A node that turned up elsewhere was already reported as a move.
    if (!stillPresent) changes.push({ kind: 'removed', path: `${path}.${beforeChild.name}` });
  }
}

function groupChildren(children: readonly TreeNode[]): Map<string, TreeNode> {
  const grouped = new Map<string, TreeNode>();
  const seenNames = new Map<string, number>();
  for (const child of children) {
    if (child.id) {
      grouped.set(`id:${child.id}`, child);
      continue;
    }
    const occurrence = seenNames.get(child.name) ?? 0;
    seenNames.set(child.name, occurrence + 1);
    grouped.set(`name:${child.name}#${occurrence}`, child);
  }
  return grouped;
}

function findById(node: TreeNode, id: string): TreeNode | undefined {
  if (node.id === id) return node;
  for (const child of node.children ?? []) {
    const found = findById(child, id);
    if (found) return found;
  }
  return undefined;
}

/** Structural equality, with floats compared inside a tolerance at every depth. */
export function equalValues(a: unknown, b: unknown, epsilon: number): boolean {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') {
    if (Number.isNaN(a) && Number.isNaN(b)) return true;
    return Math.abs(a - b) <= epsilon;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((value, index) => equalValues(value, b[index], epsilon));
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const left = a as Record<string, unknown>;
    const right = b as Record<string, unknown>;
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    // Vector3 and CFrame arrive as nested objects, so the tolerance has to
    // reach them too — comparing them exactly is how a rounded position
    // becomes a reported change.
    return [...keys].every((key) => equalValues(left[key], right[key], epsilon));
  }
  return false;
}

/** A short human summary. Counts first, because the shape of a diff is the first question. */
export function summarizeDiff(diff: TreeDiff): string {
  if (diff.identical) return 'Identical.';
  const counts = new Map<ChangeKind, number>();
  for (const change of diff.changes) counts.set(change.kind, (counts.get(change.kind) ?? 0) + 1);
  const parts = [...counts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([kind, n]) => `${n} ${kind}`);
  const skipped = diff.unchangedSubtrees.length > 0 ? `; ${diff.unchangedSubtrees.length} subtree(s) unchanged` : '';
  return `${parts.join(', ')}${skipped}.`;
}
