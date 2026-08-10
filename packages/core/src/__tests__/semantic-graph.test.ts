import {
  BOTTLENECK_SHARE,
  buildSemanticGraph,
  INTERPRETATION_ALGORITHM_VERSION,
  portalBetweenness,
  type Portal,
  type SceneFacts,
} from '../scene/semantic-graph.js';

const portal = (id: string, from: string, to: string, over: Partial<Portal> = {}): Portal => ({
  id, from, to, width: 8, clearance: 12, verticalDelta: 0, cost: 1, ...over,
});

const facts = (over: Partial<SceneFacts> = {}): SceneFacts => ({
  sourceRevision: 7,
  zones: [{ id: 'lobby', floorArea: 400 }, { id: 'hall', floorArea: 600 }, { id: 'vault', floorArea: 200 }],
  portals: [portal('p1', 'lobby', 'hall'), portal('p2', 'hall', 'vault')],
  spawns: ['lobby'],
  objectives: ['vault'],
  ...over,
});

describe('portalBetweenness', () => {
  it('gives every portal on the only route a full share', () => {
    const score = portalBetweenness(facts());
    expect(score.get('p1')).toBe(1);
    expect(score.get('p2')).toBe(1);
  });

  it('splits the share between two equal-cost routes', () => {
    // lobby -> hall -> vault and lobby -> side -> vault, both cost 2.
    const score = portalBetweenness(facts({
      zones: [
        { id: 'lobby', floorArea: 400 }, { id: 'hall', floorArea: 600 },
        { id: 'side', floorArea: 300 }, { id: 'vault', floorArea: 200 },
      ],
      portals: [
        portal('p1', 'lobby', 'hall'), portal('p2', 'hall', 'vault'),
        portal('p3', 'lobby', 'side'), portal('p4', 'side', 'vault'),
      ],
    }));
    expect(score.get('p1')).toBeCloseTo(0.5, 3);
    expect(score.get('p3')).toBeCloseTo(0.5, 3);
  });

  it('keeps a shared segment at full share when the alternatives rejoin', () => {
    // Both routes must cross p0 first; only the second leg is a choice.
    const score = portalBetweenness(facts({
      zones: [
        { id: 'spawn', floorArea: 100 }, { id: 'lobby', floorArea: 400 },
        { id: 'hall', floorArea: 600 }, { id: 'side', floorArea: 300 }, { id: 'vault', floorArea: 200 },
      ],
      portals: [
        portal('p0', 'spawn', 'lobby'),
        portal('p1', 'lobby', 'hall'), portal('p2', 'hall', 'vault'),
        portal('p3', 'lobby', 'side'), portal('p4', 'side', 'vault'),
      ],
      spawns: ['spawn'],
    }));
    expect(score.get('p0')).toBeCloseTo(1, 3);
    expect(score.get('p1')).toBeCloseTo(0.5, 3);
  });

  it('ignores a cheaper route that does not exist and scores nothing without pairs', () => {
    expect([...portalBetweenness(facts({ objectives: [] })).values()]).toEqual([0, 0]);
  });

  it('refuses a cost that is zero, negative or not a number', () => {
    // A free edge makes every route through it shortest, and the share stops
    // distinguishing anything. NaN slipped through a `cost <= 0` test, because
    // `NaN <= 0` is false, and then poisoned every distance it touched.
    for (const cost of [0, -1, NaN, Infinity]) {
      expect(() => portalBetweenness(facts({ portals: [portal('p1', 'lobby', 'hall', { cost })] })))
        .toThrow(/finite and positive/);
    }
  });

  it('refuses a graph it cannot resolve rather than answering partially', () => {
    const bad = (over: Partial<SceneFacts>) => () => portalBetweenness(facts(over));
    expect(bad({ portals: [portal('p1', 'nowhere', 'hall')] })).toThrow(/unknown zone nowhere/);
    expect(bad({ portals: [portal('p1', 'lobby', 'nowhere')] })).toThrow(/unknown zone nowhere/);
    expect(bad({ spawns: ['nowhere'] })).toThrow(/spawn names unknown zone/);
    expect(bad({ objectives: ['nowhere'] })).toThrow(/objective names unknown zone/);
    expect(bad({ zones: [{ id: 'lobby', floorArea: 1 }, { id: 'lobby', floorArea: 2 }] })).toThrow(/declared twice/);
    expect(bad({ portals: [portal('p1', 'lobby', 'hall'), portal('p1', 'hall', 'vault')] })).toThrow(/declared twice/);
  });
});

describe('buildSemanticGraph', () => {
  it('keeps measured facts and concluded interpretations in separate shapes', () => {
    const graph = buildSemanticGraph(facts());
    expect(graph.facts.zones).toHaveLength(3);
    expect(graph.facts.betweenness.p1).toBe(1);
    for (const value of Object.values(graph.interpretations)) {
      expect(value.algorithmVersion).toBe(INTERPRETATION_ALGORITHM_VERSION);
      expect(value.sourceRevision).toBe(7);
      expect(value.evidence.length).toBeGreaterThan(0);
      // Never certain: an interpretation claiming 1 is a fact in disguise.
      expect(value.confidence).toBeLessThan(1);
      expect(value.confidence).toBeGreaterThan(0);
    }
  });

  it('calls a degree-one zone with no objective a dead end', () => {
    const graph = buildSemanticGraph(facts({
      zones: [...facts().zones, { id: 'closet', floorArea: 50 }],
      portals: [...facts().portals, portal('p3', 'hall', 'closet')],
    }));
    expect(graph.interpretations.deadEnds.value).toEqual(['closet']);
    expect(graph.interpretations.deadEnds.confidence).toBeCloseTo(0.8, 2);
  });

  it('lowers confidence for a way out the graph cannot see', () => {
    const base = facts().zones;
    const withPortal = (over: Partial<Portal>) => buildSemanticGraph(facts({
      zones: [...base, { id: 'closet', floorArea: 50 }],
      portals: [...facts().portals, portal('p3', 'hall', 'closet', over)],
    })).interpretations.deadEnds;

    expect(withPortal({ teleport: true }).confidence).toBeLessThan(0.5);
    expect(withPortal({ verticalDelta: 20 }).confidence).toBeLessThanOrEqual(0.5);
    expect(withPortal({ teleport: true }).evidence.join(' ')).toMatch(/teleport/);
  });

  it('reports a room reachable only through a one-way portal, and is more sure of it', () => {
    // Directed adjacency gives this closet zero outgoing edges, so a degree
    // test over the adjacency map skipped the most dead-end-shaped thing in
    // the graph. Candidacy counts incident portals instead.
    const graph = buildSemanticGraph(facts({
      zones: [...facts().zones, { id: 'closet', floorArea: 50 }],
      portals: [...facts().portals, portal('p3', 'hall', 'closet', { oneWay: true })],
    }));
    expect(graph.interpretations.deadEnds.value).toEqual(['closet']);
    // A one-way portal restricts direction; it does not hide a route.
    expect(graph.interpretations.deadEnds.confidence).toBeGreaterThanOrEqual(0.8);
    expect(graph.interpretations.deadEnds.evidence.join(' ')).toMatch(/one-way into closet, so nothing walks back out/);
  });

  it('says spawns as well as objectives are excluded when nothing is a dead end', () => {
    expect(buildSemanticGraph(facts()).interpretations.deadEnds.evidence.join(' '))
      .toMatch(/is a spawn or an objective/);
  });

  it('does not call the objective zone a dead end', () => {
    // The vault has one portal and is the goal; that is a destination, not a
    // mistake, and reporting it would train an agent to ignore the finding.
    expect(buildSemanticGraph(facts()).interpretations.deadEnds.value).toEqual([]);
  });

  it('reports a bottleneck only above the share threshold', () => {
    const single = buildSemanticGraph(facts());
    expect(single.interpretations.bottlenecks.value).toEqual(['p1', 'p2']);

    const split = buildSemanticGraph(facts({
      zones: [
        { id: 'lobby', floorArea: 400 }, { id: 'hall', floorArea: 600 },
        { id: 'side', floorArea: 300 }, { id: 'vault', floorArea: 200 },
      ],
      portals: [
        portal('p1', 'lobby', 'hall'), portal('p2', 'hall', 'vault'),
        portal('p3', 'lobby', 'side'), portal('p4', 'side', 'vault'),
      ],
    }));
    // Each leg carries half the routes, under the threshold.
    expect(split.interpretations.bottlenecks.value).toEqual([]);
    expect(BOTTLENECK_SHARE).toBeGreaterThan(0.5);
  });

  it('says plainly that one spawn/objective pair proves nothing about bottlenecks', () => {
    const one = buildSemanticGraph(facts());
    expect(one.interpretations.bottlenecks.confidence).toBeLessThanOrEqual(0.3);
    expect(one.interpretations.bottlenecks.evidence.join(' ')).toMatch(/only one spawn\/objective pair/);
  });

  it('scores nothing, and says so, when there are no spawns', () => {
    const graph = buildSemanticGraph(facts({ spawns: [] }));
    expect(graph.interpretations.unreachableObjectives.confidence).toBeLessThanOrEqual(0.05);
    expect(graph.interpretations.unreachableObjectives.evidence.join(' ')).toMatch(/not measured from anywhere/);
  });

  it('finds an objective no walkable portal reaches', () => {
    const graph = buildSemanticGraph(facts({
      zones: [...facts().zones, { id: 'island', floorArea: 100 }],
      objectives: ['vault', 'island'],
    }));
    expect(graph.interpretations.unreachableObjectives.value).toEqual(['island']);
  });

  it('does not treat a one-way portal as a way back', () => {
    const graph = buildSemanticGraph(facts({
      portals: [portal('p1', 'lobby', 'hall'), portal('p2', 'hall', 'vault', { oneWay: true })],
      spawns: ['vault'],
      objectives: ['lobby'],
    }));
    expect(graph.interpretations.unreachableObjectives.value).toEqual(['lobby']);
  });
});
