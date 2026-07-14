import { BridgeService, RequestFence } from '../bridge-service.js';

describe('Protocol V3 Fencing', () => {
  let bridge: BridgeService;

  beforeEach(() => {
    bridge = new BridgeService();
    bridge.registerInstance({
      pluginSessionId: 'p1',
      instanceId: 'place:1',
      role: 'edit',
      protocolVersion: 3,
    });
  });

  afterEach(() => {
    bridge.clearAllPendingRequests();
  });

  test('Valid fence accepted', () => {
    const promise = bridge.sendRequest('/api/test', { data: true }, 'place:1', 'edit');
    promise.catch(() => {});
    
    const delivered = bridge.getPendingRequestForSession('p1');
    expect(delivered).toBeDefined();

    const fence: RequestFence = {
      serverEpoch: delivered!.serverEpoch,
      pluginSessionId: delivered!.pluginSessionId,
      deliveryAttempt: delivered!.deliveryAttempt,
      leaseToken: delivered!.leaseToken
    };

    const ack = bridge.acknowledgeFencedRequest(delivered!.requestId, fence);
    expect(ack).toBe(true);

    const res = bridge.resolveFencedRequest(delivered!.requestId, { result: 'ok' }, fence);
    expect(res).toBe(true);
  });

  test('Stale server epoch rejected', () => {
    const promise = bridge.sendRequest('/api/test', { data: true }, 'place:1', 'edit');
    promise.catch(() => {});
    const delivered = bridge.getPendingRequestForSession('p1')!;

    const fence: RequestFence = {
      serverEpoch: 'wrong-epoch',
      pluginSessionId: delivered.pluginSessionId,
      deliveryAttempt: delivered.deliveryAttempt,
      leaseToken: delivered.leaseToken
    };

    expect(bridge.acknowledgeFencedRequest(delivered.requestId, fence)).toBe(false);
  });

  test('Wrong plugin session rejected', () => {
    const promise = bridge.sendRequest('/api/test', { data: true }, 'place:1', 'edit');
    promise.catch(() => {});
    const delivered = bridge.getPendingRequestForSession('p1')!;

    const fence: RequestFence = {
      serverEpoch: delivered.serverEpoch,
      pluginSessionId: 'p2',
      deliveryAttempt: delivered.deliveryAttempt,
      leaseToken: delivered.leaseToken
    };

    expect(bridge.resolveFencedRequest(delivered.requestId, { result: 'ok' }, fence)).toBe(false);
  });

  test('Mismatched delivery attempt rejected', () => {
    const promise = bridge.sendRequest('/api/test', { data: true }, 'place:1', 'edit');
    promise.catch(() => {});
    const delivered = bridge.getPendingRequestForSession('p1')!;

    const fence: RequestFence = {
      serverEpoch: delivered.serverEpoch,
      pluginSessionId: delivered.pluginSessionId,
      deliveryAttempt: delivered.deliveryAttempt + 1,
      leaseToken: delivered.leaseToken
    };

    expect(bridge.resolveFencedRequest(delivered.requestId, { result: 'ok' }, fence)).toBe(false);
  });

  test('Empty lease token rejected', () => {
    const promise = bridge.sendRequest('/api/test', { data: true }, 'place:1', 'edit');
    promise.catch(() => {});
    const delivered = bridge.getPendingRequestForSession('p1')!;

    const fence: RequestFence = {
      serverEpoch: delivered.serverEpoch,
      pluginSessionId: delivered.pluginSessionId,
      deliveryAttempt: delivered.deliveryAttempt,
      leaseToken: ''
    };

    expect(bridge.resolveFencedRequest(delivered.requestId, { result: 'ok' }, fence)).toBe(false);
  });

  test('Fenced reject works', () => {
    const promise = bridge.sendRequest('/api/test', { data: true }, 'place:1', 'edit');
    promise.catch(() => {});
    const delivered = bridge.getPendingRequestForSession('p1')!;

    const fence: RequestFence = {
      serverEpoch: delivered.serverEpoch,
      pluginSessionId: delivered.pluginSessionId,
      deliveryAttempt: delivered.deliveryAttempt,
      leaseToken: delivered.leaseToken
    };

    expect(bridge.rejectFencedRequest(delivered.requestId, new Error('Test error'), fence)).toBe(true);
  });

  test('Double-resolve with same fence rejected', () => {
    const promise = bridge.sendRequest('/api/test', { data: true }, 'place:1', 'edit');
    promise.catch(() => {});
    const delivered = bridge.getPendingRequestForSession('p1')!;

    const fence: RequestFence = {
      serverEpoch: delivered.serverEpoch,
      pluginSessionId: delivered.pluginSessionId,
      deliveryAttempt: delivered.deliveryAttempt,
      leaseToken: delivered.leaseToken
    };

    expect(bridge.resolveFencedRequest(delivered.requestId, { result: 'ok' }, fence)).toBe(true);
    expect(bridge.resolveFencedRequest(delivered.requestId, { result: 'ok' }, fence)).toBe(false);
  });

  test('Requeued work after reconnect', () => {
    bridge.registerInstance({
      pluginSessionId: 'p1',
      instanceId: 'place:1',
      role: 'edit',
      protocolVersion: 3,
    });
    const promise = bridge.sendRequest('/api/some-endpoint', { data: true }, 'place:1', 'edit');
    promise.catch(() => {});
    const delivered1 = bridge.getPendingRequestForSession('p1')!;
    
    // Simulate long-poll dropping
    bridge.releasePendingRequestsForSession('p1');
    
    // Simulate new long-poll picking up the work
    const delivered2 = bridge.getPendingRequestForSession('p1');
    expect(delivered2).toBeDefined();
    expect(delivered2!.requestId).toBe(delivered1.requestId);
    expect(delivered2!.pluginSessionId).toBe('p1');
    expect(delivered2!.deliveryAttempt).toBeGreaterThan(delivered1.deliveryAttempt);
    expect(delivered2!.leaseToken).not.toBe(delivered1.leaseToken);
  });
});
