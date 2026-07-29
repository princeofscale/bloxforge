import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { RequestJournal, type CompletionReceipt } from '../request-journal.js';
import type { RequestStatus } from '../bridge-service.js';

const status = (
  requestId: string,
  state: RequestStatus['state'],
  updatedAt: number,
): RequestStatus & { requestId: string } => ({
  requestId,
  state,
  serverEpoch: 'epoch',
  deliveryAttempt: 0,
  updatedAt,
});

describe('RequestJournal durability and bounds', () => {
  let directory: string;
  let file: string;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bloxforge-request-journal-'));
    file = path.join(directory, 'journal.json');
  });

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  test('compacts terminal statuses while preserving every active request', () => {
    const now = Date.now();
    const journal = new RequestJournal(file);
    const statuses = Array.from({ length: 1100 }, (_, index) =>
      status(`terminal-${index}`, 'completed', now - index));
    statuses.push(status('active-old', 'started', now - 2 * 60 * 60 * 1000));
    const pending = [{
      id: 'active-old',
      endpoint: '/api/delete-object',
      data: {},
      targetInstanceId: 'place:1',
      targetRole: 'edit',
      timestamp: now - 2 * 60 * 60 * 1000,
      state: 'started' as const,
      deliveryAttempt: 1,
    }];

    journal.save(statuses, pending);
    const loaded = journal.load()!;
    expect(loaded.statuses).toHaveLength(1001);
    expect(loaded.statuses).toContainEqual(expect.objectContaining({
      requestId: 'active-old',
      state: 'started',
    }));
    if (process.platform !== 'win32') {
      expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    }
  });

  test('prunes expired terminal statuses and bounds completion receipts', () => {
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now);
    const journal = new RequestJournal(file);
    const receipts: CompletionReceipt[] = Array.from({ length: 300 }, (_, index) => ({
      requestId: `receipt-${index}`,
      completedAt: now - index,
    }));

    journal.save([
      status('expired', 'completed', now - 2 * 60 * 60 * 1000),
      status('fresh', 'completed', now),
    ], [], receipts);
    const loaded = journal.load()!;
    expect(loaded.statuses.map((entry) => entry.requestId)).toEqual(['fresh']);
    expect(loaded.completionReceipts).toHaveLength(200);
    jest.restoreAllMocks();
  });

  test('keeps the last atomic snapshot when a stale temporary file exists', () => {
    const journal = new RequestJournal(file);
    journal.save([status('stable', 'completed', Date.now())], []);
    fs.writeFileSync(`${file}.interrupted.tmp`, '{"version":2');

    expect(journal.load()?.statuses[0].requestId).toBe('stable');
  });

  test('backs up a corrupt main snapshot', () => {
    fs.writeFileSync(file, '{"version":2');
    expect(new RequestJournal(file).load()).toBeUndefined();
    expect(fs.readdirSync(directory).some((entry) => entry.startsWith('journal.json.corrupt.'))).toBe(true);
  });
});
