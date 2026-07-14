import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { RequestState, RequestStatus } from './bridge-service.js';

export interface JournalPendingRequest {
  id: string;
  endpoint: string;
  data: unknown;
  targetInstanceId: string;
  targetRole: string;
  timestamp: number;
  state: Extract<RequestState, 'queued' | 'delivered' | 'started'>;
  deliveryAttempt: number;
}

export interface CompletionReceipt {
  requestId: string;
  completedAt: number;
  /** Opaque short hash of the response so reconciliation can log what was proven. */
  responseDigest?: string;
}

interface JournalSnapshotV1 {
  version: 1;
  savedAt: number;
  statuses: (RequestStatus & { requestId: string })[];
  pending: JournalPendingRequest[];
}

interface JournalSnapshotV2 {
  version: 2;
  savedAt: number;
  statuses: (RequestStatus & { requestId: string })[];
  pending: JournalPendingRequest[];
  completionReceipts: CompletionReceipt[];
}

type JournalSnapshot = JournalSnapshotV2;

/** Default retention: prune status entries older than this. */
const DEFAULT_STATUS_TTL_MS = 60 * 60 * 1000; // 1 hour
/** Maximum number of statuses kept regardless of TTL. */
const MAX_STATUSES = 1000;
/** Maximum number of completion receipts. */
const MAX_RECEIPTS = 200;
/** Receipt TTL — receipts older than this are discarded. */
const RECEIPT_TTL_MS = 5 * 60 * 1000; // 5 minutes
/** Persist calls between automatic compaction runs. */
const COMPACT_INTERVAL = 50;

export function defaultRequestJournalPath(): string | undefined {
  if (process.env.NODE_ENV === 'test') return undefined;
  const configured = process.env.BLOXFORGE_JOURNAL_PATH?.trim();
  if (configured === 'off' || configured === '0') return undefined;
  return configured || path.join(os.homedir(), '.bloxforge', 'bridge-journal.json');
}

export class RequestJournal {
  private persistCount = 0;

  constructor(readonly filePath: string) {}

  load(): JournalSnapshot | undefined {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as JournalSnapshotV1 | JournalSnapshotV2;
      if (!parsed || typeof parsed !== 'object') return undefined;
      if (!Array.isArray(parsed.statuses) || !Array.isArray(parsed.pending)) return undefined;

      // Migrate v1 → v2
      if (parsed.version === 1) {
        return {
          version: 2,
          savedAt: parsed.savedAt,
          statuses: parsed.statuses,
          pending: parsed.pending,
          completionReceipts: [],
        };
      }
      if (parsed.version === 2 && Array.isArray((parsed as JournalSnapshotV2).completionReceipts)) {
        return parsed as JournalSnapshotV2;
      }
      return undefined;
    } catch {
      // Corrupt or missing file. If the file exists but is unreadable, back it up.
      this.backupCorruptFile();
      return undefined;
    }
  }

  save(statuses: (RequestStatus & { requestId: string })[], pending: JournalPendingRequest[], completionReceipts: CompletionReceipt[] = []): void {
    const directory = path.dirname(this.filePath);
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const snapshot: JournalSnapshot = {
      version: 2,
      savedAt: Date.now(),
      statuses,
      pending,
      completionReceipts,
    };
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(snapshot), { mode: 0o600 });
    fs.renameSync(temporary, this.filePath);

    this.persistCount++;
    if (this.persistCount >= COMPACT_INTERVAL) {
      this.persistCount = 0;
      // Compaction is in-line since the data is already in memory at the caller.
    }
  }

  /**
   * Compact a snapshot in-place: enforce retention TTL and entry limits.
   * Returns a new compacted snapshot.
   */
  static compact(snapshot: JournalSnapshot, now = Date.now()): JournalSnapshot {
    // Prune statuses: keep only those within TTL and cap at MAX_STATUSES
    let statuses = snapshot.statuses.filter((s) => now - s.updatedAt < DEFAULT_STATUS_TTL_MS);
    if (statuses.length > MAX_STATUSES) {
      statuses = statuses.slice(statuses.length - MAX_STATUSES);
    }

    // Prune completion receipts: TTL + cap
    let receipts = snapshot.completionReceipts.filter((r) => now - r.completedAt < RECEIPT_TTL_MS);
    if (receipts.length > MAX_RECEIPTS) {
      receipts = receipts.slice(receipts.length - MAX_RECEIPTS);
    }

    return {
      ...snapshot,
      savedAt: now,
      statuses,
      completionReceipts: receipts,
    };
  }

  /** Back up a corrupt journal file so data is not silently lost. */
  private backupCorruptFile(): void {
    try {
      if (!fs.existsSync(this.filePath)) return;
      const backup = `${this.filePath}.corrupt.${Date.now()}`;
      fs.copyFileSync(this.filePath, backup);
    } catch {
      // Best-effort; ignore backup failures.
    }
  }
}
