// The scene as two layers, never one.
//
// Roadmap B1. Facts are things measured: zones, portals, spawns, objectives,
// widths, clearances. Interpretations are things concluded: this is a dead end,
// this is the main route, this edge is a bottleneck. They live in separate
// shapes because they have separate warrants, and a response that returns them
// in the same shape invites an agent to act on a guess with the confidence it
// would give a measurement.
//
// This is the same correction `get_spatial_layout` needed for its inferred
// floor, generalised: every interpretation carries a confidence, the evidence
// behind it, the algorithm version that produced it and the revision it was
// computed from. A conclusion with no evidence and no version cannot be
// re-checked later, which means it can only be believed or ignored.

/** Bumped when any interpretation rule changes, so old conclusions are dateable. */
export const INTERPRETATION_ALGORITHM_VERSION = '1.0.0';

export interface Zone {
  id: string;
  /** Floor area in square studs — a fact, measured from the geometry. */
  floorArea: number;
}

export interface Portal {
  id: string;
  from: string;
  to: string;
  /** Narrowest horizontal gap, in studs. */
  width: number;
  /** Headroom, in studs. */
  clearance: number;
  /** Positive means `to` is above `from`. */
  verticalDelta: number;
  /** Traversal cost. Smaller is easier; never zero, or path counting degenerates. */
  cost: number;
  /** A portal that can only be crossed one way — a drop, a one-way door. */
  oneWay?: boolean;
  /** Crossed by teleporting rather than walking. */
  teleport?: boolean;
}

export interface SceneFacts {
  sourceRevision: number;
  zones: Zone[];
  portals: Portal[];
  spawns: string[];
  objectives: string[];
}

export interface Interpretation<T> {
  value: T;
  /** Never 1: an interpretation that claims certainty is a fact in disguise. */
  confidence: number;
  evidence: string[];
  algorithmVersion: string;
  sourceRevision: number;
}

function interpret<T>(value: T, confidence: number, evidence: string[], sourceRevision: number): Interpretation<T> {
  return {
    value,
    confidence: Math.max(0.05, Math.min(0.95, Math.round(confidence * 100) / 100)),
    evidence,
    algorithmVersion: INTERPRETATION_ALGORITHM_VERSION,
    sourceRevision,
  };
}

interface Adjacency {
  to: string;
  portal: Portal;
}

function adjacency(facts: SceneFacts): Map<string, Adjacency[]> {
  const out = new Map<string, Adjacency[]>();
  for (const zone of facts.zones) out.set(zone.id, []);
  for (const portal of facts.portals) {
    if (portal.cost <= 0) {
      // A zero-cost edge makes every path through it free, so shortest-path
      // counting stops distinguishing routes and the bottleneck score collapses.
      throw new Error(`portal ${portal.id} has cost ${portal.cost}; costs must be positive`);
    }
    out.get(portal.from)?.push({ to: portal.to, portal });
    if (!portal.oneWay) out.get(portal.to)?.push({ to: portal.from, portal });
  }
  return out;
}

/**
 * Shortest-path counts from one source, by cost.
 *
 * Returns the distance to each zone and how many distinct shortest routes reach
 * it — the σ of the bottleneck definition. Dijkstra rather than BFS because the
 * edges carry a cost; ties are what make σ interesting, so equal-cost routes are
 * counted rather than collapsed.
 */
function shortestPaths(adj: Map<string, Adjacency[]>, source: string) {
  const dist = new Map<string, number>();
  const sigma = new Map<string, number>();
  const predecessors = new Map<string, { from: string; portalId: string }[]>();
  for (const id of adj.keys()) {
    dist.set(id, Infinity);
    sigma.set(id, 0);
    predecessors.set(id, []);
  }
  if (!dist.has(source)) return { dist, sigma, predecessors };
  dist.set(source, 0);
  sigma.set(source, 1);

  // A linear scan for the minimum: these graphs are zones, not road networks,
  // and a heap here would be more code for a list that is rarely past dozens.
  // ponytail: O(n^2). Swap in a binary heap if a place ever has thousands of
  // zones, which would mean the zone segmentation upstream is wrong anyway.
  const unvisited = new Set(adj.keys());
  while (unvisited.size > 0) {
    let current: string | undefined;
    let best = Infinity;
    for (const id of unvisited) {
      const d = dist.get(id)!;
      if (d < best) { best = d; current = id; }
    }
    if (current === undefined || best === Infinity) break;
    unvisited.delete(current);

    for (const { to, portal } of adj.get(current) ?? []) {
      const candidate = best + portal.cost;
      const known = dist.get(to)!;
      if (candidate < known - 1e-9) {
        dist.set(to, candidate);
        sigma.set(to, sigma.get(current)!);
        predecessors.set(to, [{ from: current, portalId: portal.id }]);
      } else if (Math.abs(candidate - known) <= 1e-9) {
        sigma.set(to, sigma.get(to)! + sigma.get(current)!);
        predecessors.get(to)!.push({ from: current, portalId: portal.id });
      }
    }
  }
  return { dist, sigma, predecessors };
}

/**
 * Edge betweenness restricted to spawn×objective pairs.
 *
 * `b(e) = (1/|S||G|) Σ σ_sg(e)/σ_sg` — the share of shortest spawn-to-objective
 * routes that pass through each portal. A portal at 1.0 is on every route from
 * every spawn to every objective, which is the shape of a corridor that closing
 * would cut the level in half.
 *
 * A fact-flavoured number over facts, so it is returned as a fact. What it
 * *means* — "this is a bottleneck worth fixing" — is the interpretation, and it
 * is kept separate.
 */
export function portalBetweenness(facts: SceneFacts): Map<string, number> {
  const adj = adjacency(facts);
  const score = new Map<string, number>();
  for (const portal of facts.portals) score.set(portal.id, 0);

  const pairs = facts.spawns.length * facts.objectives.length;
  if (pairs === 0) return score;

  for (const spawn of facts.spawns) {
    const { dist, sigma, predecessors } = shortestPaths(adj, spawn);
    for (const goal of facts.objectives) {
      const total = sigma.get(goal) ?? 0;
      if (total === 0 || !Number.isFinite(dist.get(goal) ?? Infinity)) continue;

      // Walk back from the goal accumulating how many of the shortest routes
      // use each portal. `through` counts routes reaching a node from the goal
      // side, so a portal's share is (routes into its head) x (routes out of
      // its tail) / total.
      const through = new Map<string, number>();
      const order: string[] = [];
      const seen = new Set<string>();
      const stack = [goal];
      while (stack.length > 0) {
        const node = stack.pop()!;
        if (seen.has(node)) continue;
        seen.add(node);
        order.push(node);
        for (const p of predecessors.get(node) ?? []) stack.push(p.from);
      }
      through.set(goal, 1);
      // Deepest-first: a node's contribution is known only once every node that
      // depends on it has been counted.
      order.sort((a, b) => (dist.get(b) ?? 0) - (dist.get(a) ?? 0));
      for (const node of order) {
        const downstream = through.get(node) ?? 0;
        if (downstream === 0) continue;
        const nodeSigma = sigma.get(node) ?? 0;
        if (nodeSigma === 0) continue;
        for (const { from, portalId } of predecessors.get(node) ?? []) {
          // `share` is already the fraction of this pair's shortest routes that
          // use the edge: `through` starts at 1 at the goal and the predecessor
          // weights sum to 1 at every node. Dividing by `total` again — which an
          // earlier draft did, reading σ_sg(e)/σ_sg literally as two steps —
          // halves every score on a two-route graph and looks plausible.
          const share = (sigma.get(from)! / nodeSigma) * downstream;
          score.set(portalId, (score.get(portalId) ?? 0) + share);
          through.set(from, (through.get(from) ?? 0) + share);
        }
      }
    }
  }

  for (const [id, value] of score) score.set(id, Math.round((value / pairs) * 1000) / 1000);
  return score;
}

export interface SemanticGraph {
  facts: SceneFacts & { betweenness: Record<string, number> };
  interpretations: {
    deadEnds: Interpretation<string[]>;
    bottlenecks: Interpretation<string[]>;
    unreachableObjectives: Interpretation<string[]>;
  };
}

/** A portal share above this is treated as a candidate bottleneck. */
export const BOTTLENECK_SHARE = 0.6;

export function buildSemanticGraph(facts: SceneFacts): SemanticGraph {
  const betweenness = portalBetweenness(facts);
  const adj = adjacency(facts);
  const rev = facts.sourceRevision;

  // --- dead ends
  // A spawn or an objective with one portal is a normal level shape — an
  // entrance corridor, a vault at the end of one. Reporting them would put two
  // false findings in front of every real one, and a finding list that is
  // mostly noise is one an agent learns to skip.
  const terminals = new Set([...facts.objectives, ...facts.spawns]);
  const deadEnds: string[] = [];
  const deadEndEvidence: string[] = [];
  let confidenceFloor = 0.8;
  for (const zone of facts.zones) {
    const edges = adj.get(zone.id) ?? [];
    if (edges.length !== 1 || terminals.has(zone.id)) continue;
    deadEnds.push(zone.id);
    const only = edges[0].portal;
    deadEndEvidence.push(`${zone.id} has one portal (${only.id}) and holds no objective`);
    // The roadmap names three things that make degree-1 unreliable, and each
    // one is a way out that the portal graph does not model.
    if (only.teleport) {
      confidenceFloor = Math.min(confidenceFloor, 0.4);
      deadEndEvidence.push(`${only.id} is a teleport, so the graph may not model every way out of ${zone.id}`);
    }
    if (only.oneWay) {
      confidenceFloor = Math.min(confidenceFloor, 0.5);
      deadEndEvidence.push(`${only.id} is one-way, so ${zone.id} may be exited by a route this graph does not hold`);
    }
    if (Math.abs(only.verticalDelta) > 4) {
      confidenceFloor = Math.min(confidenceFloor, 0.5);
      deadEndEvidence.push(`${only.id} has a ${only.verticalDelta} stud vertical delta, which a jump or a drop may bypass`);
    }
  }
  if (deadEnds.length === 0) deadEndEvidence.push('every zone has more than one portal, or holds an objective');

  // --- bottlenecks
  const bottlenecks = [...betweenness.entries()]
    .filter(([, share]) => share >= BOTTLENECK_SHARE)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([id]) => id);
  const bottleneckEvidence = bottlenecks.length === 0
    ? [`no portal carries ${BOTTLENECK_SHARE * 100}% or more of the shortest spawn-to-objective routes`]
    : bottlenecks.map((id) => `${id} carries ${(betweenness.get(id)! * 100).toFixed(0)}% of shortest spawn-to-objective routes`);
  // Only as good as the spawn and objective sets it was given: with one spawn
  // and one objective every portal on the single route scores 1.0 and none of
  // them is news.
  const pairCount = facts.spawns.length * facts.objectives.length;
  const bottleneckConfidence = pairCount === 0 ? 0.05 : pairCount === 1 ? 0.3 : 0.8;
  if (pairCount === 0) bottleneckEvidence.push('no spawn/objective pairs were given, so nothing was measured');
  else if (pairCount === 1) bottleneckEvidence.push('only one spawn/objective pair: every portal on the one route scores 1.0');

  // --- unreachable objectives: a fact-adjacent conclusion, but still one this
  // graph can be wrong about for the same reasons dead ends can.
  const reachable = new Set<string>();
  for (const spawn of facts.spawns) {
    const { dist } = shortestPaths(adj, spawn);
    for (const [id, d] of dist) if (Number.isFinite(d)) reachable.add(id);
  }
  const unreachable = facts.objectives.filter((id) => !reachable.has(id));

  return {
    facts: { ...facts, betweenness: Object.fromEntries(betweenness) },
    interpretations: {
      deadEnds: interpret(deadEnds, confidenceFloor, deadEndEvidence, rev),
      bottlenecks: interpret(bottlenecks, bottleneckConfidence, bottleneckEvidence, rev),
      unreachableObjectives: interpret(
        unreachable,
        facts.spawns.length === 0 ? 0.05 : 0.9,
        facts.spawns.length === 0
          ? ['no spawns were given, so reachability was not measured from anywhere']
          : [`reachability measured from ${facts.spawns.length} spawn(s) over walkable portals only`],
        rev,
      ),
    },
  };
}
