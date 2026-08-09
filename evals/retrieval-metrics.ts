// Retrieval and selection metrics for the frozen tool corpus.
//
// Separate from `metrics.ts` on purpose: everything there reads a recorded
// model run, so it costs provider budget and needs Studio connected. These
// score a ranking directly, which means the corpus can gate CI without either.
// That is the whole reason the corpus exists — the roadmap makes every later
// claim about tokens or quality pass through it, and a benchmark you cannot
// afford to run is a benchmark that stops being run.

/** One ranked answer to one corpus query: tool names, best first. */
export type Ranking = readonly string[];

export interface RecallResult {
  /** Share of cases whose gold tool appears in the top k. */
  recallAtK: Record<number, number>;
  /** Share of cases whose gold tool is ranked first. */
  top1: number;
  /** Mean reciprocal rank; 0 for a case where no gold tool is ranked at all. */
  mrr: number;
  cases: number;
}

/** Rank of the first gold tool in `ranking`, 1-based, or 0 when absent. */
export function goldRank(ranking: Ranking, gold: readonly string[]): number {
  const wanted = new Set(gold);
  for (let i = 0; i < ranking.length; i++) {
    if (wanted.has(ranking[i])) return i + 1;
  }
  return 0;
}

export function scoreRankings(
  results: readonly { ranking: Ranking; gold: readonly string[] }[],
  ks: readonly number[] = [1, 3, 5, 8],
): RecallResult {
  const ranks = results.map((r) => goldRank(r.ranking, r.gold));
  const n = ranks.length || 1;
  const recallAtK: Record<number, number> = {};
  for (const k of ks) recallAtK[k] = ranks.filter((r) => r > 0 && r <= k).length / n;
  return {
    recallAtK,
    top1: ranks.filter((r) => r === 1).length / n,
    mrr: ranks.reduce((sum, r) => sum + (r > 0 ? 1 / r : 0), 0) / n,
    cases: ranks.length,
  };
}

/**
 * Levenshtein distance over tool names, for multi-step cases.
 *
 * Edit distance rather than set overlap because order is the thing being
 * graded: reading a script before replacing it and replacing it before reading
 * it are the same set and not the same trajectory.
 */
export function sequenceEditDistance(actual: readonly string[], gold: readonly string[]): number {
  const prev = Array.from({ length: gold.length + 1 }, (_, j) => j);
  for (let i = 1; i <= actual.length; i++) {
    const row = [i];
    for (let j = 1; j <= gold.length; j++) {
      row[j] = actual[i - 1] === gold[j - 1]
        ? prev[j - 1]
        : 1 + Math.min(prev[j], row[j - 1], prev[j - 1]);
    }
    prev.splice(0, prev.length, ...row);
  }
  return prev[gold.length];
}

/**
 * Percentile bootstrap confidence interval for the mean of `samples`.
 *
 * The roadmap asks for a 95% interval on every published proportion, and it is
 * the difference between "recall went from 0.78 to 0.81" and "recall moved
 * inside its own noise". `seed` keeps it reproducible: an interval that shifts
 * between two runs of the same data is not evidence of anything.
 */
export function bootstrapCI(
  samples: readonly number[],
  { iterations = 2000, level = 0.95, seed = 1 } = {},
): { mean: number; low: number; high: number } {
  // A published interval computed from bad options is worse than none: with
  // `iterations: 0` the percentile lookup reads off the end of an empty array
  // and both bounds come back `undefined`, which prints as an interval and
  // compares as neither wider nor narrower than anything.
  if (!Number.isInteger(iterations) || iterations <= 0) {
    throw new RangeError(`bootstrapCI: iterations must be a positive integer, got ${iterations}`);
  }
  if (!Number.isFinite(level) || level <= 0 || level >= 1) {
    throw new RangeError(`bootstrapCI: level must be strictly between 0 and 1, got ${level}`);
  }
  const n = samples.length;
  const mean = n === 0 ? 0 : samples.reduce((a, b) => a + b, 0) / n;
  if (n === 0) return { mean: 0, low: 0, high: 0 };

  // mulberry32: small, seeded, and good enough for resampling. Math.random
  // would make the published interval unreproducible.
  let state = seed >>> 0;
  const rand = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const means: number[] = [];
  for (let it = 0; it < iterations; it++) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += samples[Math.floor(rand() * n)];
    means.push(sum / n);
  }
  means.sort((a, b) => a - b);
  const tail = (1 - level) / 2;
  return {
    mean,
    low: means[Math.floor(tail * iterations)],
    high: means[Math.min(iterations - 1, Math.ceil((1 - tail) * iterations) - 1)],
  };
}

/**
 * Vocabulary overlap between a query and the text a lexical retriever indexes.
 *
 * The corpus's own integrity depends on this. A "positive" query written by
 * paraphrasing a tool's `whenToUse` measures how well the retriever matches
 * itself, and it scores beautifully while predicting nothing about a real user
 * who has never read the tool list. `corpus-check.ts` fails a positive case
 * whose overlap is above the threshold, so the corpus cannot quietly drift into
 * being a mirror.
 */
export function vocabularyOverlap(query: string, indexed: string): number {
  const tokens = (s: string) => new Set(
    s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4),
  );
  const q = tokens(query);
  if (q.size === 0) return 0;
  const target = tokens(indexed);
  let hit = 0;
  for (const w of q) if (target.has(w)) hit++;
  return hit / q.size;
}
