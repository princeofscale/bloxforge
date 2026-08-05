import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { BridgeService } from '../packages/core/dist/bridge-service.js';
import { RequestJournal } from '../packages/core/dist/request-journal.js';

const RUNS = Number(process.env.BLOXFORGE_FAULT_RUNS || 10_000);
global.gc?.();
const heapBefore = process.memoryUsage().heapUsed;
const timeoutResourcesBefore = process.getActiveResourcesInfo?.().filter((name) => name === 'Timeout').length ?? 0;
const bridge = new BridgeService('');
// protocolVersion is required: the bridge refuses a plugin below the minimum
// supported protocol. Omitting it registered nothing, and the first symptom was
// "request 0 was not delivered" 10,000 lines later — so the registration is
// asserted here rather than inferred from a delivery failure.
const registration = bridge.registerInstance({
  pluginSessionId: 'benchmark',
  instanceId: 'place:benchmark',
  role: 'edit',
  protocolVersion: 3,
});
assert(registration?.ok, `benchmark instance did not register: ${registration?.error?.message ?? 'unknown reason'}`);

const started = performance.now();
for (let index = 0; index < RUNS; index++) {
  const result = bridge.sendRequest('/api/delete-object', { index }, 'place:benchmark', 'edit');
  const first = bridge.getPendingRequestForSession('benchmark');
  assert(first, `request ${index} was not delivered`);

  if (index % 100 === 0) {
    bridge.releasePendingRequest(first.requestId);
    const redelivery = bridge.getPendingRequestForSession('benchmark');
    assert.equal(redelivery?.requestId, first.requestId, `request ${index} changed id on redelivery`);
  }

  assert(bridge.acknowledgeRequest(first.requestId), `request ${index} was not acknowledged`);
  bridge.resolveRequest(first.requestId, { success: true, index });
  bridge.resolveRequest(first.requestId, { success: true, index });
  assert.deepEqual(await result, { success: true, index });
  assert.equal(bridge.getRequestStatus(first.requestId)?.state, 'completed');
}

assert.equal(bridge.getPendingRequestCount(), 0, 'pending requests leaked');
const diagnostics = bridge.getTransportDiagnostics();
assert.equal(diagnostics.completed, RUNS, 'completed counter drifted');
assert.equal(diagnostics.deliveryRetries, Math.ceil(RUNS / 100), 'redelivery counter drifted');
assert.equal(diagnostics.timeouts, 0, 'unexpected timeouts');
assert.equal(diagnostics.outcomeUnknown, 0, 'unexpected unknown outcomes');
assert.equal(diagnostics.cancelled, 0, 'unexpected cancellations');
assert.equal(diagnostics.latencySampleCount, Math.min(RUNS, 1024), 'latency samples are not bounded');
assert(diagnostics.statusCount <= 1000, `request status history grew to ${diagnostics.statusCount}`);

global.gc?.();
const heapGrowthBytes = process.memoryUsage().heapUsed - heapBefore;
assert(heapGrowthBytes < 32 * 1024 * 1024, `heap grew by ${heapGrowthBytes} bytes`);
const timeoutResourcesAfter = process.getActiveResourcesInfo?.().filter((name) => name === 'Timeout').length ?? 0;
assert(timeoutResourcesAfter <= timeoutResourcesBefore, 'request timers leaked');

const journalDirectory = mkdtempSync(join(tmpdir(), 'bloxforge-fault-journal-'));
const journalPath = join(journalDirectory, 'journal.json');
let journalBytes;
try {
  const now = Date.now();
  new RequestJournal(journalPath).save(
    Array.from({ length: RUNS }, (_, index) => ({
      requestId: `benchmark-${index}`,
      state: 'completed',
      serverEpoch: bridge.serverEpoch,
      deliveryAttempt: 1,
      updatedAt: now - index,
    })),
    [],
  );
  journalBytes = statSync(journalPath).size;
  assert(journalBytes < 2 * 1024 * 1024, 'compacted journal exceeded 2 MiB');
} finally {
  rmSync(journalDirectory, { recursive: true, force: true });
}

const elapsedMs = performance.now() - started;
console.log(JSON.stringify({
  runs: RUNS,
  duplicates: diagnostics.completed - RUNS,
  pending: diagnostics.queueDepth,
  statusCount: diagnostics.statusCount,
  latencySampleCount: diagnostics.latencySampleCount,
  heapGrowthBytes,
  journalBytes,
  elapsedMs: Math.round(elapsedMs),
  opsPerSecond: Math.round(RUNS / (elapsedMs / 1000)),
}));
