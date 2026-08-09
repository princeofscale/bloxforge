// An append-only journal of the three protocol events the `list_changed`
// question turns on, written only when a probe run asks for it.
//
// The question the roadmap needs answered per host is not "does the client
// refresh" — every client in the table refreshes — but "did the model, in the
// turn it was already in, become able to call a tool that did not exist when
// that turn started". Those are different measurements, and a UI that updates
// is evidence for neither.
//
// What this can see, precisely: when a tools/list was served and what was in
// it, when a tools/list_changed went out, and when a tool that had just been
// added was first called. That covers refresh latency and stale-call rate.
//
// ponytail: what it cannot see is a turn boundary — the server has no notion of
// one, and neither does a stdio proxy without provider traces. So `probe-mark`
// lets the operator stamp the journal between turns, which is honest but manual.
// Upgrade path: a host that exposes a request trace can stamp them itself.
//
// Off unless `BLOXFORGE_LIST_CHANGED_PROBE` names a file. Nothing is written,
// no path is touched, and no behaviour changes without it — a diagnostic that
// is on by default is a diagnostic nobody can trust the timings of.
import { appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

export type ProbeEventKind = 'list_served' | 'list_changed' | 'tool_call' | 'mark';

export interface ProbeEvent {
  t: number;
  kind: ProbeEventKind;
  /** Bumped on every list_changed, so an event can be tied to a tool set. */
  generation: number;
  /** Stable hash of the advertised tool names, for `list_served`. */
  listHash?: string;
  count?: number;
  tool?: string;
  /** True when this tool was not advertised in the previous generation. */
  newlyAdvertised?: boolean;
  ok?: boolean;
  label?: string;
}

let journalPath: string | undefined;
let generation = 0;
let previouslyAdvertised = new Set<string>();
let currentlyAdvertised = new Set<string>();

/** Resolved once per process: the probe is a run mode, not a runtime toggle. */
export function initProbeJournal(env: NodeJS.ProcessEnv = process.env): void {
  const configured = env.BLOXFORGE_LIST_CHANGED_PROBE;
  journalPath = configured && configured.trim() !== '' ? configured : undefined;
  generation = 0;
  previouslyAdvertised = new Set();
  currentlyAdvertised = new Set();
}

export function isProbeEnabled(): boolean {
  return journalPath !== undefined;
}

function write(event: ProbeEvent): void {
  if (!journalPath) return;
  try {
    appendFileSync(journalPath, `${JSON.stringify(event)}\n`);
  } catch {
    // A probe that takes the server down with it measures nothing. The run is
    // supervised by an operator who will notice an empty journal.
  }
}

export function recordListServed(names: readonly string[]): void {
  if (!journalPath) return;
  currentlyAdvertised = new Set(names);
  write({
    t: Date.now(),
    kind: 'list_served',
    generation,
    // Sorted before hashing: MCP 2026-07-28 wants a deterministic order for
    // caching, but a probe that reported "the list changed" because the server
    // reordered it would be measuring its own serialization.
    listHash: createHash('sha256').update([...names].sort().join('\n')).digest('hex').slice(0, 16),
    count: names.length,
  });
}

export function recordListChanged(): void {
  if (!journalPath) return;
  previouslyAdvertised = currentlyAdvertised;
  generation += 1;
  write({ t: Date.now(), kind: 'list_changed', generation });
}

export function recordToolCall(tool: string, ok: boolean): void {
  if (!journalPath) return;
  write({
    t: Date.now(),
    kind: 'tool_call',
    generation,
    tool,
    // The canary property: this tool was absent from the list the host held
    // before the most recent change. Calling it proves the model saw the new
    // set, which is the thing a UI refresh does not prove.
    newlyAdvertised: generation > 0 && !previouslyAdvertised.has(tool),
    ok,
  });
}

/** Operator stamp — a turn boundary the server cannot observe for itself. */
export function recordMark(label: string): void {
  if (!journalPath) return;
  write({ t: Date.now(), kind: 'mark', generation, label });
}
