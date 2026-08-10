// Which camera poses are worth rendering.
//
// Roadmap B3, camera selection. A fixed ring around the centre is the obvious
// approach and it is the wrong one for an interior: it photographs walls. The
// roadmap says to prioritise junctions, dead ends, objectives and high
// betweenness — every one of which the semantic graph from B1 already computes,
// so this reads them rather than re-deriving a second, disagreeing notion of
// "important".
//
// Six canonical views first, then greedy additions by new coverage, stopping
// when the next camera would add less than 5% — a budget, not a discovery: each
// view costs a screenshot, an upload and a judge call.

import type { SemanticGraph } from '../scene/semantic-graph.js';

export const CANONICAL_VIEWS = [
  'spawn_eye_level',
  'reverse_goal',
  'route_junction_a',
  'route_junction_b',
  'route_junction_c',
  'elevated_overview',
] as const;

export type CanonicalView = (typeof CANONICAL_VIEWS)[number];

/** Below this marginal gain, another camera is not worth its cost. */
export const MARGINAL_GAIN_FLOOR = 0.05;

export interface CameraPose {
  id: string;
  /** The zone this pose looks at, when it is tied to one. */
  zone?: string;
  /** Why it was chosen — carried so a later reader can disagree with it. */
  rationale: string;
  /** Semantic nodes this pose is expected to cover. */
  covers: string[];
}

export interface CameraPlan {
  poses: CameraPose[];
  /** Share of interesting nodes covered by the chosen poses. */
  coverage: number;
  /** Nodes no chosen pose covers, named rather than left implicit. */
  uncovered: string[];
  stoppedBecause: 'marginal-gain' | 'budget' | 'covered-everything';
}

/**
 * The nodes a review should be able to see, most important first.
 *
 * Importance is taken from the graph's own numbers rather than invented here:
 * objectives and spawns are given, dead ends and bottlenecks are the graph's
 * interpretations, and the betweenness share orders the rest.
 */
export function interestingNodes(graph: SemanticGraph): { id: string; why: string; weight: number }[] {
  const weights = new Map<string, { why: string; weight: number }>();
  const bump = (id: string, why: string, weight: number) => {
    const existing = weights.get(id);
    if (!existing || weight > existing.weight) weights.set(id, { why, weight });
  };

  for (const id of graph.facts.objectives) bump(id, 'objective', 1);
  for (const id of graph.facts.spawns) bump(id, 'spawn', 0.9);
  // Interpretations, so their confidence rides along: a dead end guessed at 0.4
  // should not outrank a measured objective.
  const deadEnds = graph.interpretations.deadEnds;
  for (const id of deadEnds.value) bump(id, `dead end (confidence ${deadEnds.confidence})`, 0.5 + deadEnds.confidence * 0.3);

  const bottlenecks = graph.interpretations.bottlenecks;
  for (const portalId of bottlenecks.value) {
    const portal = graph.facts.portals.find((p) => p.id === portalId);
    if (!portal) continue;
    const share = graph.facts.betweenness[portalId] ?? 0;
    bump(portal.from, `approach to bottleneck ${portalId} (${(share * 100).toFixed(0)}% of routes)`, 0.4 + share * 0.3);
    bump(portal.to, `far side of bottleneck ${portalId}`, 0.4 + share * 0.25);
  }

  return [...weights.entries()]
    .map(([id, v]) => ({ id, ...v }))
    .sort((a, b) => b.weight - a.weight || a.id.localeCompare(b.id));
}

/**
 * Choose poses greedily by new coverage.
 *
 * `coverageOf` says which nodes a candidate pose can see — a raycast or
 * visibility question this module deliberately does not answer, because
 * pretending to know it from the portal graph alone would be the false
 * precision the whole of B3 is about.
 */
export function planCameras(
  graph: SemanticGraph,
  coverageOf: (zone: string) => string[],
  budget = 12,
): CameraPlan {
  if (budget < CANONICAL_VIEWS.length) {
    throw new Error(`camera budget ${budget} is below the ${CANONICAL_VIEWS.length} canonical views`);
  }
  const interesting = interestingNodes(graph);
  const wanted = new Set(interesting.map((n) => n.id));
  if (wanted.size === 0) {
    return { poses: [], coverage: 0, uncovered: [], stoppedBecause: 'covered-everything' };
  }

  const poses: CameraPose[] = [];
  const covered = new Set<string>();

  // The canonical six, in order, tied to the highest-weight nodes available.
  for (let i = 0; i < CANONICAL_VIEWS.length && i < interesting.length; i++) {
    const node = interesting[i];
    const sees = coverageOf(node.id);
    poses.push({
      id: CANONICAL_VIEWS[i],
      zone: node.id,
      rationale: `canonical view at ${node.id}: ${node.why}`,
      covers: sees,
    });
    for (const id of sees) covered.add(id);
  }

  let stoppedBecause: CameraPlan['stoppedBecause'] = 'covered-everything';
  while (poses.length < budget) {
    const remaining = [...wanted].filter((id) => !covered.has(id));
    if (remaining.length === 0) break;

    let best: { zone: string; gain: number; sees: string[] } | undefined;
    for (const node of interesting) {
      if (poses.some((p) => p.zone === node.id)) continue;
      const sees = coverageOf(node.id);
      const gain = sees.filter((id) => wanted.has(id) && !covered.has(id)).length / wanted.size;
      if (!best || gain > best.gain) best = { zone: node.id, gain, sees };
    }
    if (!best || best.gain < MARGINAL_GAIN_FLOOR) {
      stoppedBecause = 'marginal-gain';
      break;
    }
    poses.push({
      id: `greedy_${poses.length + 1}`,
      zone: best.zone,
      rationale: `adds ${(best.gain * 100).toFixed(0)}% new coverage`,
      covers: best.sees,
    });
    for (const id of best.sees) covered.add(id);
  }
  if (poses.length >= budget && [...wanted].some((id) => !covered.has(id))) stoppedBecause = 'budget';

  const uncovered = [...wanted].filter((id) => !covered.has(id)).sort();
  return {
    poses,
    coverage: Math.round(((wanted.size - uncovered.length) / wanted.size) * 100) / 100,
    // Named, not summarised away: "82% covered" reads as success, and the
    // 18% is where a reviewer would have found something.
    uncovered,
    stoppedBecause,
  };
}
