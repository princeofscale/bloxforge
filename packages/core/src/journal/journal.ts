// The place journal: what was done to this place, in order, and against what.
//
// Roadmap B5. An append-only record is what makes drift detectable at all —
// without a baseline there is no third side to compare against, and "the scene
// differs from my plan" cannot be told apart from "the scene differs from my
// plan because I changed it last time".

import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const JOURNAL_SCHEMA_VERSION = 1;
export const JOURNAL_RELATIVE_PATH = join('.bloxforge', 'place-journal.jsonl');

export interface JournalPath {
  id: string;
  /** Digest of the instance before the stage ran; absent when it was created. */
  pre?: string;
  /** Digest after; absent when it was removed. */
  post?: string;
}

export interface JournalEntry {
  schemaVersion: number;
  placeId: string;
  baselineDigest: string;
  revision: number;
  stage: string;
  intent: string;
  styleProfileHash?: string;
  generator?: { id: string; version: string; seed: number | string; paramsHash: string };
  planHash: string;
  paths: JournalPath[];
  acceptance: { contract: string; result: 'passed' | 'failed' | 'unknown' };
  warnings: string[];
}

export class JournalError extends Error {}

/**
 * Where a journal may live.
 *
 * The roadmap is explicit that a Studio-only place must *choose*, because the
 * two available surfaces are not interchangeable and swapping one for the other
 * silently would be a lie about where the user's history lives:
 *
 * - plugin settings are machine-local — the record vanishes on another machine,
 *   and a teammate opening the same place sees a place with no history;
 * - DataModel metadata is shared with the place, which means writing history
 *   *modifies the artefact being recorded*.
 *
 * So there is no default. A place with no Rojo project on disk gets an error
 * naming both options rather than a silently chosen one.
 */
export type JournalSurface =
  | { kind: 'repository'; root: string }
  | { kind: 'plugin-settings' }
  | { kind: 'datamodel' };

export function journalPathFor(surface: JournalSurface): string {
  if (surface.kind !== 'repository') {
    throw new JournalError(
      `the ${surface.kind} surface is not a file and has no path; only a repository journal is written to disk`,
    );
  }
  return join(surface.root, JOURNAL_RELATIVE_PATH);
}

const REQUIRED: readonly (keyof JournalEntry)[] = [
  'schemaVersion', 'placeId', 'baselineDigest', 'revision', 'stage', 'intent', 'planHash', 'paths', 'acceptance',
];

/** Reject an entry that cannot serve as a baseline, before it becomes one. */
export function validateEntry(entry: JournalEntry): void {
  for (const key of REQUIRED) {
    if (entry[key] === undefined || entry[key] === null) {
      throw new JournalError(`journal entry is missing ${String(key)}`);
    }
  }
  if (entry.schemaVersion !== JOURNAL_SCHEMA_VERSION) {
    // Fail closed rather than read an older shape optimistically: a baseline
    // read wrong is worse than no baseline, because drift detection would
    // report confident nonsense instead of declining.
    throw new JournalError(
      `journal entry is schemaVersion ${entry.schemaVersion}, this build writes and reads ${JOURNAL_SCHEMA_VERSION}`,
    );
  }
  if (!Number.isInteger(entry.revision) || entry.revision < 0) {
    throw new JournalError(`revision must be a non-negative integer, got ${entry.revision}`);
  }
  const seen = new Set<string>();
  for (const p of entry.paths) {
    if (!p.id) throw new JournalError('every journal path needs an id');
    if (seen.has(p.id)) throw new JournalError(`journal entry names ${p.id} twice`);
    seen.add(p.id);
    if (p.pre === undefined && p.post === undefined) {
      throw new JournalError(`${p.id} has neither a pre nor a post digest, so it records nothing`);
    }
  }
}

/** Append one entry. Never rewrites, never reorders. */
export function appendEntry(surface: JournalSurface, entry: JournalEntry): void {
  validateEntry(entry);
  const path = journalPathFor(surface);
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(entry)}\n`);
}

/**
 * Read the journal.
 *
 * A torn last line is tolerated and reported, because an append can be
 * interrupted; anything else malformed is not, because a journal that quietly
 * skips entries it could not parse is a baseline with holes in it that reports
 * itself as complete.
 */
export function readJournal(surface: JournalSurface): { entries: JournalEntry[]; truncatedTail: boolean } {
  const path = journalPathFor(surface);
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return { entries: [], truncatedTail: false };
  }
  const lines = raw.split('\n');
  const trailingNewline = lines[lines.length - 1] === '';
  if (trailingNewline) lines.pop();

  const entries: JournalEntry[] = [];
  let truncatedTail = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '') continue;
    try {
      const entry = JSON.parse(line) as JournalEntry;
      validateEntry(entry);
      entries.push(entry);
    } catch (error) {
      const isLast = i === lines.length - 1 && !trailingNewline;
      if (isLast) {
        truncatedTail = true;
        break;
      }
      throw new JournalError(
        `${path}:${i + 1} is unreadable and is not the last line — refusing to treat a journal with a hole in it as a baseline: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return { entries, truncatedTail };
}

/** The most recent entry for a stage, which is what drift compares against. */
export function latestFor(entries: readonly JournalEntry[], stage: string): JournalEntry | undefined {
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].stage === stage) return entries[i];
  }
  return undefined;
}
