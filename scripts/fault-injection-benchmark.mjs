import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { BridgeService } from '../packages/core/dist/bridge-service.js';

const RUNS = Number(process.env.BLOXFORGE_FAULT_RUNS || 10_000);
const bridge = new BridgeService('');
bridge.registerInstance({ pluginSessionId: 'benchmark', instanceId: 'place:benchmark', role: 'edit' });

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
const elapsedMs = performance.now() - started;
console.log(JSON.stringify({ runs: RUNS, duplicates: 0, pending: 0, elapsedMs: Math.round(elapsedMs), opsPerSecond: Math.round(RUNS / (elapsedMs / 1000)) }));
