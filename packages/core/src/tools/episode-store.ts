// In-memory store of recent playtest episodes (Track D). Episodes produced by
// run_playtest_episode are addressable via roblox://playtest/episode/{id}, listable,
// and summarizable across turns — so the agent can reference / compare an episode
// without re-running it. Capped ring buffer so a long session stays bounded. The
// onChange hook lets the server push resources/updated notifications (Track G3).

export interface StoredEpisode {
  episodeId: string;
  createdAt: number;
  verdict?: unknown;
  mode?: unknown;
  [k: string]: unknown;
}

export interface EpisodeSummaryRow {
  episodeId: string;
  createdAt: number;
  verdict: unknown;
  mode: unknown;
}

export class EpisodeStore {
  private readonly episodes = new Map<string, StoredEpisode>();
  private readonly order: string[] = [];
  private readonly listeners = new Set<(episodeId: string) => void>();

  constructor(private readonly cap = 50) {}

  /** Register a callback fired whenever an episode is added (each MCP session wires
   *  one to push resources/updated). Returns an unsubscribe fn for session teardown. */
  addListener(cb: (episodeId: string) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  add(ep: StoredEpisode): void {
    this.episodes.set(ep.episodeId, ep);
    this.order.push(ep.episodeId);
    while (this.order.length > this.cap) {
      const evicted = this.order.shift();
      if (evicted !== undefined) this.episodes.delete(evicted);
    }
    for (const cb of this.listeners) cb(ep.episodeId);
  }

  get(episodeId: string): StoredEpisode | undefined {
    return this.episodes.get(episodeId);
  }

  /** Newest-first lightweight index (for the episode-list resource). */
  list(): EpisodeSummaryRow[] {
    const rows: EpisodeSummaryRow[] = [];
    for (const id of this.order) {
      const e = this.episodes.get(id);
      if (e) rows.push({ episodeId: e.episodeId, createdAt: e.createdAt, verdict: e.verdict, mode: e.mode });
    }
    return rows.reverse();
  }
}
