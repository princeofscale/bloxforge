import { buildSemanticGraph, type SceneFacts } from '../scene/semantic-graph.js';
import { CANONICAL_VIEWS, interestingNodes, MARGINAL_GAIN_FLOOR, planCameras } from '../vision/camera-plan.js';
import { disposeFinding, rankByPairwise, REPEAT_THRESHOLD, type VisionFinding } from '../vision/finding-policy.js';

const finding = (over: Partial<VisionFinding> = {}): VisionFinding => ({
  id: 'f1',
  rubric: 'clutter',
  target: { path: 'game.Workspace.Lobby.Crates' },
  repeatRate: 1,
  deterministicRecheck: 'passed',
  evidence: ['nine crates within four studs of the spawn'],
  runs: 10,
  ...over,
});

describe('vision finding policy', () => {
  it('lets a localized, re-checked, reproducible finding become a plan', () => {
    const verdict = disposeFinding(finding());
    expect(verdict.disposition).toBe('auto_fixable');
    // "May become a plan", not "was applied": the plan still faces every check
    // any other plan does.
    expect(verdict.reasons.join(' ')).toMatch(/localized to game.Workspace.Lobby.Crates/);
  });

  it('discards a finding that points at nothing', () => {
    // No evidence means nothing to re-check and nothing for a person to look
    // at — only an assertion.
    expect(disposeFinding(finding({ evidence: [] })).disposition).toBe('discarded');
  });

  it('discards a finding a deterministic check disagreed with', () => {
    const verdict = disposeFinding(finding({ deterministicRecheck: 'failed' }));
    expect(verdict.disposition).toBe('discarded');
    expect(verdict.reasons.join(' ')).toMatch(/disagreed/);
  });

  it('demotes an unlocalized finding to a warning rather than dropping it', () => {
    const verdict = disposeFinding(finding({ target: undefined }));
    expect(verdict.disposition).toBe('warning');
    expect(verdict.reasons.join(' ')).toMatch(/not localized/);
  });

  it('demotes a finding no deterministic check can confirm', () => {
    expect(disposeFinding(finding({ deterministicRecheck: 'unavailable' })).disposition).toBe('warning');
  });

  it('will not read a repeat rate off a single run', () => {
    // One run gives 1.0 or 0.0 and means neither.
    const verdict = disposeFinding(finding({ runs: 1, repeatRate: 1 }));
    expect(verdict.disposition).toBe('warning');
    expect(verdict.reasons.join(' ')).toMatch(/is not a repeat rate/);
  });

  it('holds the reproducibility bar exactly where the roadmap puts it', () => {
    expect(REPEAT_THRESHOLD).toBe(0.8);
    expect(disposeFinding(finding({ repeatRate: 0.8 })).disposition).toBe('auto_fixable');
    expect(disposeFinding(finding({ repeatRate: 0.79 })).disposition).toBe('warning');
  });
});

describe('pairwise ranking', () => {
  it('orders by wins rather than scoring each candidate', () => {
    const result = rankByPairwise(['a', 'b', 'c'], [
      { winner: 'b', loser: 'a' }, { winner: 'b', loser: 'c' }, { winner: 'c', loser: 'a' },
    ]);
    expect(result.order).toEqual(['b', 'c', 'a']);
    expect(result.wins).toEqual({ a: 0, b: 2, c: 1 });
  });

  it('reports a judge that contradicted itself instead of averaging it away', () => {
    // The average of an unstable comparison looks exactly like a confident one.
    const result = rankByPairwise(['a', 'b'], [
      { winner: 'a', loser: 'b' }, { winner: 'b', loser: 'a' },
    ]);
    expect(result.inconsistentPairs).toBe(1);
  });

  it('refuses a comparison naming something that was not offered', () => {
    expect(() => rankByPairwise(['a'], [{ winner: 'a', loser: 'ghost' }])).toThrow(/was not offered/);
    expect(() => rankByPairwise(['a'], [{ winner: 'a', loser: 'a' }])).toThrow(/cannot beat itself/);
  });
});

describe('camera planning', () => {
  const facts: SceneFacts = {
    sourceRevision: 3,
    zones: [
      { id: 'spawn', floorArea: 200 }, { id: 'hall', floorArea: 600 },
      { id: 'east', floorArea: 300 }, { id: 'west', floorArea: 300 },
      { id: 'vault', floorArea: 150 }, { id: 'closet', floorArea: 40 },
    ],
    portals: [
      { id: 'p1', from: 'spawn', to: 'hall', width: 8, clearance: 12, verticalDelta: 0, cost: 1 },
      { id: 'p2', from: 'hall', to: 'east', width: 8, clearance: 12, verticalDelta: 0, cost: 1 },
      { id: 'p3', from: 'hall', to: 'west', width: 8, clearance: 12, verticalDelta: 0, cost: 1 },
      { id: 'p4', from: 'east', to: 'vault', width: 6, clearance: 12, verticalDelta: 0, cost: 1 },
      { id: 'p5', from: 'west', to: 'vault', width: 6, clearance: 12, verticalDelta: 0, cost: 1 },
      { id: 'p6', from: 'hall', to: 'closet', width: 4, clearance: 10, verticalDelta: 0, cost: 1 },
    ],
    spawns: ['spawn'],
    objectives: ['vault'],
  };
  const graph = buildSemanticGraph(facts);
  /** Each pose sees its own zone and whatever it shares a portal with. */
  const coverageOf = (zone: string) => [
    zone,
    ...facts.portals.filter((p) => p.from === zone).map((p) => p.to),
    ...facts.portals.filter((p) => p.to === zone).map((p) => p.from),
  ];

  it('takes its notion of important from the graph rather than inventing one', () => {
    const nodes = interestingNodes(graph);
    const ids = nodes.map((n) => n.id);
    expect(ids).toContain('vault');
    expect(ids).toContain('spawn');
    expect(ids).toContain('closet');
    // An objective is measured; a dead end is interpreted, and its confidence
    // rides along so a shaky guess cannot outrank a given fact.
    expect(nodes[0].id).toBe('vault');
    expect(nodes.find((n) => n.id === 'closet')!.why).toMatch(/dead end \(confidence/);
  });

  it('starts with the canonical six and names why each was chosen', () => {
    const plan = planCameras(graph, coverageOf);
    expect(plan.poses.slice(0, 6).map((p) => p.id)).toEqual([...CANONICAL_VIEWS].slice(0, plan.poses.length));
    for (const pose of plan.poses) expect(pose.rationale).not.toBe('');
  });

  it('names what no camera covers instead of reporting only the percentage', () => {
    // "82% covered" reads as success; the 18% is where a reviewer would have
    // found something.
    const blind = planCameras(graph, () => []);
    expect(blind.coverage).toBe(0);
    expect(blind.uncovered.length).toBeGreaterThan(0);
    expect(blind.stoppedBecause).toBe('marginal-gain');
  });

  it('stops adding cameras once the next one earns too little', () => {
    const plan = planCameras(graph, coverageOf, 12);
    expect(plan.poses.length).toBeLessThanOrEqual(12);
    expect(['marginal-gain', 'covered-everything', 'budget']).toContain(plan.stoppedBecause);
    expect(MARGINAL_GAIN_FLOOR).toBe(0.05);
  });

  it('refuses a budget that cannot hold the canonical views', () => {
    expect(() => planCameras(graph, coverageOf, 3)).toThrow(/below the 6 canonical views/);
  });

  it('plans nothing, rather than a ring, when there is nothing interesting', () => {
    const empty = buildSemanticGraph({
      sourceRevision: 1, zones: [{ id: 'a', floorArea: 1 }], portals: [], spawns: [], objectives: [],
    });
    expect(planCameras(empty, coverageOf).poses).toEqual([]);
  });
});
