import { BridgeService, resolveRequestTimeout } from '../bridge-service.js';
import { ProxyBridgeService } from '../proxy-bridge-service.js';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

describe('resolveRequestTimeout', () => {
  it('keeps the base timeout for ordinary endpoints', () => {
    expect(resolveRequestTimeout('/api/get-instance-children', 30000)).toBe(30000);
  });

  it('grants a longer floor to heavy execute-luau requests', () => {
    expect(resolveRequestTimeout('/api/execute-luau', 30000)).toBeGreaterThanOrEqual(120000);
  });

  it('never shortens a base that is already larger than the heavy floor', () => {
    expect(resolveRequestTimeout('/api/execute-luau', 300000)).toBe(300000);
  });
});

describe('persistent request journal', () => {
  test('recovers queued requests but fences delivered work as outcome_unknown', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bloxforge-journal-test-'));
    const journal = path.join(directory, 'journal.json');
    const first = new BridgeService(journal);
    const queued = first.sendRequest('/api/delete-object', { path: 'game.Workspace.Part' }, 'place:1', 'edit');
    queued.catch(() => {});
    const queuedId = JSON.parse(fs.readFileSync(journal, 'utf8')).pending[0].id as string;

    const recovered = new BridgeService(journal);
    recovered.registerInstance({ pluginSessionId: 'p2', instanceId: 'place:1', role: 'edit', protocolVersion: 3 });
    expect(recovered.getPendingRequestForSession('p2')?.requestId).toBe(queuedId);

    const delivered = new BridgeService(path.join(directory, 'delivered.json'));
    const deliveredPromise = delivered.sendRequest('/api/delete-object', {}, 'place:2', 'edit');
    deliveredPromise.catch(() => {});
    const attempt = delivered.getPendingRequest('place:2', 'edit')!;
    const restarted = new BridgeService(path.join(directory, 'delivered.json'));
    expect(restarted.getRequestStatus(attempt.requestId)?.state).toBe('outcome_unknown');

    first.clearAllPendingRequests();
    recovered.clearAllPendingRequests();
    delivered.clearAllPendingRequests();
    restarted.clearAllPendingRequests();
    fs.rmSync(directory, { recursive: true, force: true });
  });
});

describe('ProxyBridgeService timeout', () => {
  test('uses the heavy endpoint timeout floor', async () => {
    jest.useFakeTimers();
    const originalFetch = global.fetch;
    global.fetch = jest.fn((input: string | URL | Request, init?: RequestInit) => {
      if (String(input).endsWith('/instances')) {
        return Promise.resolve(new Response(JSON.stringify({ instances: [] }), { status: 200 }));
      }
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      });
    }) as typeof fetch;

    const bridge = new ProxyBridgeService('http://localhost:58741');
    const pending = bridge.sendRequest('/api/execute-luau', {}, 'place:1', 'edit');
    let settled = false;
    pending.finally(() => { settled = true; }).catch(() => {});

    await jest.advanceTimersByTimeAsync(30000);
    expect(settled).toBe(false);
    await jest.advanceTimersByTimeAsync(90000);
    await expect(pending).rejects.toThrow('Proxy request timeout');

    bridge.stop();
    global.fetch = originalFetch;
    jest.useRealTimers();
  });

  test('preserves outcome_unknown details returned by the primary', async () => {
    const originalFetch = global.fetch;
    global.fetch = jest.fn((input: string | URL | Request) => {
      if (String(input).endsWith('/instances')) {
        return Promise.resolve(new Response(JSON.stringify({ instances: [] }), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify({
        error: 'outcome is unknown',
        outcome: 'unknown',
        requestId: 'primary-request-1',
      }), { status: 500 }));
    }) as typeof fetch;

    const bridge = new ProxyBridgeService('http://localhost:58741');
    await expect(bridge.sendRequest('/api/delete-object', {}, 'place:1', 'edit')).rejects.toMatchObject({
      requestId: 'primary-request-1',
      outcome: 'unknown',
    });

    bridge.stop();
    global.fetch = originalFetch;
  });
});

class MirroredBridgeService extends BridgeService {
  constructor(private readonly mirroredInstances: ReturnType<BridgeService['getInstances']>) {
    super();
  }

  override getInstances() {
    return this.mirroredInstances;
  }
}

function register(b: BridgeService, opts: { pluginSessionId: string; instanceId: string; role: string; placeId?: number; placeName?: string }) {
  const res = b.registerInstance({
    pluginSessionId: opts.pluginSessionId,
    instanceId: opts.instanceId,
    role: opts.role,
    placeId: opts.placeId ?? 0,
    placeName: opts.placeName ?? '',
    dataModelName: opts.placeName ?? '',
    isRunning: false,
  });
  if (!res.ok) throw new Error(`registerInstance failed: ${res.error.code}`);
  return res;
}

describe('BridgeService', () => {
  let bridge: BridgeService;

  beforeEach(() => {
    bridge = new BridgeService();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('Request management', () => {
    test('queues a request and returns it on matching poll', async () => {
      register(bridge, { pluginSessionId: 'p1', instanceId: 'place:1', role: 'edit' });
      bridge.sendRequest('/api/test', { hello: 'world' }, 'place:1', 'edit');

      const pending = bridge.getPendingRequest('place:1', 'edit');
      expect(pending).toBeTruthy();
      expect(pending!.request.endpoint).toBe('/api/test');
      expect(pending!.request.data).toEqual({ hello: 'world' });
    });

    test('does not return request to non-matching role', async () => {
      register(bridge, { pluginSessionId: 'p1', instanceId: 'place:1', role: 'edit' });
      register(bridge, { pluginSessionId: 'p2', instanceId: 'place:1', role: 'server' });
      bridge.sendRequest('/api/test', {}, 'place:1', 'edit');

      expect(bridge.getPendingRequest('place:1', 'server')).toBeNull();
      expect(bridge.getPendingRequest('place:1', 'edit')).toBeTruthy();
    });

    test('does not return request to non-matching instanceId', async () => {
      bridge.sendRequest('/api/test', {}, 'place:1', 'edit');
      expect(bridge.getPendingRequest('place:2', 'edit')).toBeNull();
      expect(bridge.getPendingRequest('place:1', 'edit')).toBeTruthy();
    });

    test('does not return the same request twice while response is in flight', async () => {
      bridge.sendRequest('/api/test', { mutates: true }, 'place:1', 'server');

      const first = bridge.getPendingRequest('place:1', 'server');
      expect(first).toBeTruthy();
      expect(bridge.getPendingRequest('place:1', 'server')).toBeNull();

      bridge.resolveRequest(first!.requestId, { ok: true });
      expect(bridge.getPendingRequest('place:1', 'server')).toBeNull();
    });

    test('limits one mutation and four reads per target DataModel', async () => {
      const mutation = bridge.sendRequest('/api/delete-object', {}, 'place:1', 'edit');
      const mutationDelivery = bridge.getPendingRequest('place:1', 'edit')!;
      const queuedMutation = bridge.sendRequest('/api/set-property', {}, 'place:1', 'edit');
      expect(bridge.getPendingRequest('place:1', 'edit')).toBeNull();
      bridge.resolveRequest(mutationDelivery.requestId, { ok: true });
      await expect(mutation).resolves.toEqual({ ok: true });
      bridge.cancelRequest((bridge.getPendingRequest('place:1', 'edit') ?? { requestId: '' }).requestId);
      await expect(queuedMutation).rejects.toThrow(/cancelled/);

      const reads = Array.from({ length: 5 }, (_, index) => bridge.sendRequest(`/api/get-${index}`, {}, 'place:1', 'edit'));
      for (let index = 0; index < 4; index++) expect(bridge.getPendingRequest('place:1', 'edit')).toBeTruthy();
      expect(bridge.getPendingRequest('place:1', 'edit')).toBeNull();
      for (const read of reads) read.catch(() => {});
      bridge.clearAllPendingRequests();
    });

    test('resolves request when response received', async () => {
      const promise = bridge.sendRequest('/api/test', {}, 'place:1', 'edit');
      const pending = bridge.getPendingRequest('place:1', 'edit');
      // Use the public API
      bridge.resolveRequest(pending!.requestId, { ok: true });
      await expect(promise).resolves.toEqual({ ok: true });
      // The promise inside sendRequest is fulfilled — verify by re-querying.
      expect(bridge.getPendingRequest('place:1', 'edit')).toBeNull();
    });

    test('times out request after 30s', async () => {
      const promise = bridge.sendRequest('/api/test', {}, 'place:1', 'edit');
      jest.advanceTimersByTime(31000);
      await expect(promise).rejects.toThrow('Request timeout');
    });

    test('FIFO ordering within (instanceId, role)', async () => {
      bridge.sendRequest('/api/a', { order: 1 }, 'place:1', 'edit');
      jest.advanceTimersByTime(10);
      bridge.sendRequest('/api/b', { order: 2 }, 'place:1', 'edit');
      jest.advanceTimersByTime(10);
      bridge.sendRequest('/api/c', { order: 3 }, 'place:1', 'edit');

      const first = bridge.getPendingRequest('place:1', 'edit');
      expect(first!.request.data.order).toBe(1);
      bridge.resolveRequest(first!.requestId, {});

      const second = bridge.getPendingRequest('place:1', 'edit');
      expect(second!.request.data.order).toBe(2);
    });

    test('notifies a connected plugin as soon as a request is queued', async () => {
      register(bridge, { pluginSessionId: 'p1', instanceId: 'place:1', role: 'edit' });
      const notify = jest.fn();
      bridge.setRequestNotifier(notify);

      const pending = bridge.sendRequest('/api/test', {}, 'place:1', 'edit');

      expect(notify).toHaveBeenCalledWith('p1');
      const delivered = bridge.getPendingRequestForSession('p1');
      expect(delivered).toMatchObject({ request: { endpoint: '/api/test' } });
      bridge.resolveRequest(delivered!.requestId, { ok: true });
      await expect(pending).resolves.toEqual({ ok: true });
    });

    test('releases an undelivered pushed request for polling fallback', async () => {
      register(bridge, { pluginSessionId: 'p1', instanceId: 'place:1', role: 'edit' });
      const pending = bridge.sendRequest('/api/test', {}, 'place:1', 'edit');
      const delivered = bridge.getPendingRequestForSession('p1');

      bridge.releasePendingRequest(delivered!.requestId);

      expect(bridge.getPendingRequest('place:1', 'edit')?.requestId).toBe(delivered!.requestId);
      bridge.resolveRequest(delivered!.requestId, { ok: true });
      await expect(pending).resolves.toEqual({ ok: true });
    });

    test('redelivers the same request id when its delivery lease expires before ack', async () => {
      const pending = bridge.sendRequest('/api/test', {}, 'place:1', 'edit');
      const first = bridge.getPendingRequest('place:1', 'edit');

      jest.advanceTimersByTime(10001);

      expect(bridge.getPendingRequest('place:1', 'edit')?.requestId).toBe(first!.requestId);
      bridge.resolveRequest(first!.requestId, { ok: true });
      await expect(pending).resolves.toEqual({ ok: true });
    });

    test('redelivers an unacknowledged mutation after its lease expires', async () => {
      const pending = bridge.sendRequest('/api/delete-object', {}, 'place:1', 'edit');
      const first = bridge.getPendingRequest('place:1', 'edit');

      jest.advanceTimersByTime(10001);

      expect(bridge.getPendingRequest('place:1', 'edit')?.requestId).toBe(first!.requestId);
      bridge.resolveRequest(first!.requestId, { ok: true });
      await expect(pending).resolves.toEqual({ ok: true });
    });

    test('does not redeliver an acknowledged request', async () => {
      const pending = bridge.sendRequest('/api/test', {}, 'place:1', 'edit');
      const first = bridge.getPendingRequest('place:1', 'edit');

      bridge.acknowledgeRequest(first!.requestId);
      jest.advanceTimersByTime(10001);

      expect(bridge.getPendingRequest('place:1', 'edit')).toBeNull();
      bridge.resolveRequest(first!.requestId, { ok: true });
      await expect(pending).resolves.toEqual({ ok: true });
    });

    test('rejects stale delivery attempts and accepts the current lease fence', async () => {
      bridge.registerInstance({ pluginSessionId: 'p1', instanceId: 'place:1', role: 'edit', protocolVersion: 3 });
      const pending = bridge.sendRequest('/api/delete-object', {}, 'place:1', 'edit');
      const first = bridge.getPendingRequestForSession('p1')!;
      bridge.releasePendingRequest(first.requestId);
      const second = bridge.getPendingRequestForSession('p1')!;

      expect(bridge.resolveFencedRequest(first.requestId, { stale: true }, first)).toBe(false);
      expect(bridge.acknowledgeFencedRequest(second.requestId, second)).toBe(true);
      expect(bridge.resolveFencedRequest(second.requestId, { ok: true }, second)).toBe(true);
      await expect(pending).resolves.toEqual({ ok: true });
      expect(bridge.getTransportDiagnostics()).toMatchObject({ completed: 1, queueDepth: 0 });
    });

    test('reports outcome_unknown with request id on timeout and accepts a late result', async () => {
      const pending = bridge.sendRequest('/api/test', {}, 'place:1', 'edit');
      const delivered = bridge.getPendingRequest('place:1', 'edit')!;
      bridge.acknowledgeRequest(delivered.requestId);

      jest.advanceTimersByTime(30001);

      await expect(pending).rejects.toMatchObject({
        requestId: delivered.requestId,
        outcome: 'unknown',
      });
      expect(bridge.getRequestStatus(delivered.requestId)).toMatchObject({ state: 'outcome_unknown' });

      bridge.resolveRequest(delivered.requestId, { ok: true });
      expect(bridge.getRequestStatus(delivered.requestId)).toMatchObject({
        state: 'completed',
        response: { ok: true },
      });
    });

    test('cancels queued delivery but refuses to cancel after ack', async () => {
      const queued = bridge.sendRequest('/api/test', {}, 'place:1', 'edit');
      const queuedId = bridge.getRequestStatus('missing')?.requestId;
      expect(queuedId).toBeUndefined();
      const delivered = bridge.getPendingRequest('place:1', 'edit')!;
      expect(bridge.cancelRequest(delivered.requestId)).toBe(true);
      await expect(queued).rejects.toThrow(/cancelled/);

      const started = bridge.sendRequest('/api/test', {}, 'place:1', 'edit');
      const startedId = bridge.getPendingRequest('place:1', 'edit')!.requestId;
      bridge.acknowledgeRequest(startedId);
      expect(bridge.cancelRequest(startedId)).toBe(false);
      bridge.resolveRequest(startedId, { ok: true });
      await expect(started).resolves.toEqual({ ok: true });
    });
  });

  describe('registerInstance', () => {
    test('issues a per-plugin session token and rejects mismatches', () => {
      const registration = bridge.registerInstance({ pluginSessionId: 'auth', instanceId: 'place:auth', role: 'edit' });
      if (!registration.ok) throw new Error('expected registration');
      expect(registration.sessionToken).toEqual(expect.any(String));
      expect(bridge.authenticatePlugin('auth', registration.sessionToken)).toBe(true);
      expect(bridge.authenticatePlugin('auth', 'wrong')).toBe(false);
    });

    test('canonicalizes published places when a stale anon id is reported', () => {
      const r = register(bridge, {
        pluginSessionId: 'edit',
        instanceId: 'anon:old-file-id',
        role: 'edit',
        placeId: 12345,
      });

      expect(r.instanceId).toBe('place:12345');
      expect(bridge.getPublicInstances()[0].instanceId).toBe('place:12345');

      const resolved = bridge.resolveTarget({ instance_id: 'anon:old-file-id', target: 'edit' });
      expect(resolved.ok).toBe(true);
      if (!resolved.ok || resolved.mode !== 'single') throw new Error('expected single');
      expect(resolved.targetInstanceId).toBe('place:12345');
      expect(resolved.targetRole).toBe('edit');
    });

    test('metadata updates migrate stale anon edit to the published place id', () => {
      register(bridge, { pluginSessionId: 'edit', instanceId: 'anon:old-file-id', role: 'edit' });
      bridge.updateInstanceMetadata('edit', { placeId: 12345 });
      register(bridge, { pluginSessionId: 'server', instanceId: 'place:12345', role: 'server', placeId: 12345 });

      expect(bridge.getPublicInstances().map((inst) => inst.instanceId).sort()).toEqual(['place:12345', 'place:12345']);

      const editFromPublished = bridge.resolveTarget({ instance_id: 'place:12345', target: 'edit' });
      expect(editFromPublished.ok).toBe(true);
      if (!editFromPublished.ok || editFromPublished.mode !== 'single') throw new Error('expected single');
      expect(editFromPublished.targetInstanceId).toBe('place:12345');
      expect(editFromPublished.targetRole).toBe('edit');

      const serverFromAnon = bridge.resolveTarget({ instance_id: 'anon:old-file-id', target: 'server' });
      expect(serverFromAnon.ok).toBe(true);
      if (!serverFromAnon.ok || serverFromAnon.mode !== 'single') throw new Error('expected single');
      expect(serverFromAnon.targetInstanceId).toBe('place:12345');
      expect(serverFromAnon.targetRole).toBe('server');

      const omittedInstance = bridge.resolveTarget({ target: 'edit' });
      expect(omittedInstance.ok).toBe(true);
      if (!omittedInstance.ok || omittedInstance.mode !== 'single') throw new Error('expected single');
      expect(omittedInstance.targetInstanceId).toBe('place:12345');
      expect(omittedInstance.targetRole).toBe('edit');
    });

    test('migrates pending requests when an anon place becomes published', async () => {
      register(bridge, { pluginSessionId: 'edit', instanceId: 'anon:old-file-id', role: 'edit' });
      const pending = bridge.sendRequest('/api/test', {}, 'anon:old-file-id', 'edit');

      const r = register(bridge, {
        pluginSessionId: 'edit',
        instanceId: 'anon:old-file-id',
        role: 'edit',
        placeId: 12345,
      });
      expect(r.instanceId).toBe('place:12345');

      const polled = bridge.getPendingRequest('place:12345', 'edit');
      expect(polled).toBeTruthy();
      bridge.resolveRequest(polled!.requestId, { ok: true });
      await expect(pending).resolves.toEqual({ ok: true });
    });

    test('routing works for proxy-style bridges that mirror instances via getInstances', () => {
      const mirrored = new MirroredBridgeService([
        {
          pluginSessionId: 'edit',
          instanceId: 'anon:mirrored-place-id',
          role: 'edit',
          placeId: 0,
          placeName: 'MirroredPlace',
          dataModelName: 'MirroredPlace',
          isRunning: false,
          pluginVersion: '2.16.1',
          pluginVariant: 'main',
          pluginProtocolVersion: 1,
          serverVersion: '2.16.1',
          serverProtocolVersion: 2,
          versionMismatch: false,
          protocolMismatch: false,
          lastActivity: Date.now(),
          connectedAt: Date.now(),
        },
      ]);

      const resolved = mirrored.resolveTarget({ instance_id: 'anon:mirrored-place-id', target: 'edit' });
      expect(resolved.ok).toBe(true);
      if (!resolved.ok || resolved.mode !== 'single') throw new Error('expected single');
      expect(resolved.targetInstanceId).toBe('anon:mirrored-place-id');
      expect(resolved.targetRole).toBe('edit');
    });

    test('first client gets client-1', () => {
      const r = register(bridge, { pluginSessionId: 'a', instanceId: 'place:1', role: 'client' });
      expect(r.assignedRole).toBe('client-1');
    });

    test('sequential clients get sequential indices', () => {
      expect(register(bridge, { pluginSessionId: 'a', instanceId: 'place:1', role: 'client' }).assignedRole).toBe('client-1');
      expect(register(bridge, { pluginSessionId: 'b', instanceId: 'place:1', role: 'client' }).assignedRole).toBe('client-2');
      expect(register(bridge, { pluginSessionId: 'c', instanceId: 'place:1', role: 'client' }).assignedRole).toBe('client-3');
    });

    test('client indices are scoped per instance_id', () => {
      expect(register(bridge, { pluginSessionId: 'a', instanceId: 'place:1', role: 'client' }).assignedRole).toBe('client-1');
      expect(register(bridge, { pluginSessionId: 'b', instanceId: 'place:2', role: 'client' }).assignedRole).toBe('client-1');
      expect(register(bridge, { pluginSessionId: 'c', instanceId: 'place:1', role: 'client' }).assignedRole).toBe('client-2');
      expect(register(bridge, { pluginSessionId: 'd', instanceId: 'place:2', role: 'client' }).assignedRole).toBe('client-2');
    });

    test('client refresh preserves assigned role', () => {
      expect(register(bridge, { pluginSessionId: 'a', instanceId: 'place:1', role: 'client' }).assignedRole).toBe('client-1');
      expect(register(bridge, { pluginSessionId: 'b', instanceId: 'place:1', role: 'client' }).assignedRole).toBe('client-2');
      expect(register(bridge, { pluginSessionId: 'a', instanceId: 'place:1', role: 'client' }).assignedRole).toBe('client-1');
      expect(bridge.getInstances()).toHaveLength(2);
    });

    test('disconnecting a middle client fills the hole', () => {
      register(bridge, { pluginSessionId: 'a', instanceId: 'place:1', role: 'client' });
      register(bridge, { pluginSessionId: 'b', instanceId: 'place:1', role: 'client' });
      register(bridge, { pluginSessionId: 'c', instanceId: 'place:1', role: 'client' });
      bridge.unregisterInstance('b');
      expect(register(bridge, { pluginSessionId: 'd', instanceId: 'place:1', role: 'client' }).assignedRole).toBe('client-2');
    });

    test('rejects duplicate (instanceId, role) tuple', () => {
      register(bridge, { pluginSessionId: 'p1', instanceId: 'place:1', role: 'edit' });
      const dup = bridge.registerInstance({
        pluginSessionId: 'p2',
        instanceId: 'place:1',
        role: 'edit',
      });
      expect(dup.ok).toBe(false);
      if (dup.ok) return;
      expect(dup.error.code).toBe('duplicate_instance_role');
      expect(dup.error.existing.instanceId).toBe('place:1');
      expect(dup.error.existing.role).toBe('edit');
    });

    test('rejects duplicate explicit client role within the same instance_id', () => {
      register(bridge, { pluginSessionId: 'p1', instanceId: 'place:1', role: 'client' });
      const dup = bridge.registerInstance({
        pluginSessionId: 'p2',
        instanceId: 'place:1',
        role: 'client-1',
      });
      expect(dup.ok).toBe(false);
      if (dup.ok) return;
      expect(dup.error.code).toBe('duplicate_instance_role');
      expect(dup.error.existing.role).toBe('client-1');
    });

    test('re-registering same pluginSessionId is allowed (refresh)', () => {
      register(bridge, { pluginSessionId: 'p1', instanceId: 'place:1', role: 'edit' });
      const refresh = bridge.registerInstance({
        pluginSessionId: 'p1',
        instanceId: 'place:1',
        role: 'edit',
      });
      expect(refresh.ok).toBe(true);
      expect(bridge.getInstances()).toHaveLength(1);
    });

    test('two edit plugins of different places coexist', () => {
      register(bridge, { pluginSessionId: 'p1', instanceId: 'place:1', role: 'edit' });
      const r = bridge.registerInstance({
        pluginSessionId: 'p2',
        instanceId: 'place:2',
        role: 'edit',
      });
      expect(r.ok).toBe(true);
      expect(bridge.getInstances()).toHaveLength(2);
    });
  });

  describe('resolveTarget', () => {
    test('omitted/omitted with single instance auto-routes', () => {
      register(bridge, { pluginSessionId: 'p1', instanceId: 'place:1', role: 'edit' });
      const r = bridge.resolveTarget({});
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.mode).toBe('single');
      if (r.mode !== 'single') return;
      expect(r.targetInstanceId).toBe('place:1');
      expect(r.targetRole).toBe('edit');
    });

    test('omitted/omitted with multiple instances errors multiple_instances_connected', () => {
      register(bridge, { pluginSessionId: 'p1', instanceId: 'place:1', role: 'edit' });
      register(bridge, { pluginSessionId: 'p2', instanceId: 'place:2', role: 'edit' });
      const r = bridge.resolveTarget({});
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.error.code).toBe('multiple_instances_connected');
      expect(r.error.data.count).toBe(2);
      expect(r.error.data.instances).toHaveLength(2);
    });

    test('target=role with multiple matching instances errors ambiguous_target', () => {
      register(bridge, { pluginSessionId: 'p1', instanceId: 'place:1', role: 'edit' });
      register(bridge, { pluginSessionId: 'p2', instanceId: 'place:2', role: 'edit' });
      const r = bridge.resolveTarget({ target: 'edit' });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.error.code).toBe('ambiguous_target');
      expect(r.error.message).toContain('multiple Studio places are connected');
      expect(r.error.message).toContain('Pass instance_id');
      expect(r.error.data.count).toBe(2);
    });

    test('instance_id picks the place', () => {
      register(bridge, { pluginSessionId: 'p1', instanceId: 'place:1', role: 'edit' });
      register(bridge, { pluginSessionId: 'p2', instanceId: 'place:2', role: 'edit' });
      const r = bridge.resolveTarget({ instance_id: 'place:2' });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.mode).toBe('single');
      if (r.mode !== 'single') return;
      expect(r.targetInstanceId).toBe('place:2');
      expect(r.targetRole).toBe('edit');
    });

    test('unknown instance_id errors unrecognized_instance_id with full list', () => {
      register(bridge, { pluginSessionId: 'p1', instanceId: 'place:1', role: 'edit' });
      const r = bridge.resolveTarget({ instance_id: 'place:does-not-exist' });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.error.code).toBe('unrecognized_instance_id');
      expect(r.error.data.instances).toHaveLength(1);
      expect(r.error.data.instances[0].instanceId).toBe('place:1');
    });

    test('instance_id with role picks (instance, role) tuple', () => {
      register(bridge, { pluginSessionId: 'p1', instanceId: 'place:1', role: 'edit' });
      register(bridge, { pluginSessionId: 'p2', instanceId: 'place:1', role: 'server' });
      register(bridge, { pluginSessionId: 'p3', instanceId: 'place:1', role: 'client' });
      const r = bridge.resolveTarget({ instance_id: 'place:1', target: 'server' });
      expect(r.ok).toBe(true);
      if (!r.ok || r.mode !== 'single') throw new Error('expected single');
      expect(r.targetRole).toBe('server');
    });

    test('instance_id with client role picks that place client even when another place has same client role', () => {
      register(bridge, { pluginSessionId: 'p1', instanceId: 'place:1', role: 'client' });
      register(bridge, { pluginSessionId: 'p2', instanceId: 'place:2', role: 'client' });
      const r = bridge.resolveTarget({ instance_id: 'place:2', target: 'client-1' });
      expect(r.ok).toBe(true);
      if (!r.ok || r.mode !== 'single') throw new Error('expected single');
      expect(r.targetInstanceId).toBe('place:2');
      expect(r.targetRole).toBe('client-1');
    });

    test('instance_id with role that does not exist on instance errors target_role_not_present_on_instance', () => {
      register(bridge, { pluginSessionId: 'p1', instanceId: 'place:1', role: 'edit' });
      const r = bridge.resolveTarget({ instance_id: 'place:1', target: 'server' });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.error.code).toBe('target_role_not_present_on_instance');
    });

    test('instance_id without role on multi-role instance prefers edit', () => {
      register(bridge, { pluginSessionId: 'p1', instanceId: 'place:1', role: 'edit' });
      register(bridge, { pluginSessionId: 'p2', instanceId: 'place:1', role: 'server' });
      const r = bridge.resolveTarget({ instance_id: 'place:1' });
      expect(r.ok).toBe(true);
      if (!r.ok || r.mode !== 'single') throw new Error('expected single');
      expect(r.targetRole).toBe('edit');
    });

    test('instance_id without role on multi-role no-edit instance errors target_role_required', () => {
      register(bridge, { pluginSessionId: 'p1', instanceId: 'place:1', role: 'server' });
      register(bridge, { pluginSessionId: 'p2', instanceId: 'place:1', role: 'client' });
      const r = bridge.resolveTarget({ instance_id: 'place:1' });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.error.code).toBe('target_role_required');
    });

    test('target=all with single instance fans out across its roles', () => {
      register(bridge, { pluginSessionId: 'p1', instanceId: 'place:1', role: 'edit' });
      register(bridge, { pluginSessionId: 'p2', instanceId: 'place:1', role: 'server' });
      register(bridge, { pluginSessionId: 'p3', instanceId: 'place:1', role: 'client' });
      const r = bridge.resolveTarget({ target: 'all' });
      expect(r.ok).toBe(true);
      if (!r.ok || r.mode !== 'fanout') throw new Error('expected fanout');
      expect(r.targets).toHaveLength(3);
      const roles = r.targets.map((t) => t.targetRole).sort();
      expect(roles).toEqual(['client-1', 'edit', 'server']);
      r.targets.forEach((t) => expect(t.targetInstanceId).toBe('place:1'));
    });

    test('target=all with multiple instances errors multiple_instances_connected', () => {
      register(bridge, { pluginSessionId: 'p1', instanceId: 'place:1', role: 'edit' });
      register(bridge, { pluginSessionId: 'p2', instanceId: 'place:2', role: 'edit' });
      const r = bridge.resolveTarget({ target: 'all' });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.error.code).toBe('multiple_instances_connected');
    });

    test('instance_id + target=all fans out only across that instance', () => {
      register(bridge, { pluginSessionId: 'p1', instanceId: 'place:1', role: 'edit' });
      register(bridge, { pluginSessionId: 'p2', instanceId: 'place:1', role: 'server' });
      register(bridge, { pluginSessionId: 'p3', instanceId: 'place:2', role: 'edit' });
      const r = bridge.resolveTarget({ instance_id: 'place:1', target: 'all' });
      expect(r.ok).toBe(true);
      if (!r.ok || r.mode !== 'fanout') throw new Error('expected fanout');
      expect(r.targets).toHaveLength(2);
      r.targets.forEach((t) => expect(t.targetInstanceId).toBe('place:1'));
    });

    test('no instances connected errors with empty list', () => {
      const r = bridge.resolveTarget({});
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.error.code).toBe('unrecognized_instance_id');
      expect(r.error.data.count).toBe(0);
    });
  });

  describe('cleanup', () => {
    test('cleanupOldRequests rejects timed-out requests', async () => {
      const a = bridge.sendRequest('/api/a', {}, 'place:1', 'edit');
      const b = bridge.sendRequest('/api/b', {}, 'place:1', 'edit');
      jest.advanceTimersByTime(31000);
      bridge.cleanupOldRequests();
      await expect(a).rejects.toThrow('Request timeout');
      await expect(b).rejects.toThrow('Request timeout');
    });

    test('clearAllPendingRequests rejects everything', async () => {
      const a = bridge.sendRequest('/api/a', {}, 'place:1', 'edit');
      bridge.clearAllPendingRequests();
      await expect(a).rejects.toThrow('Connection closed');
    });

    test('unregisterInstance rejects requests targeting the removed (instanceId, role)', async () => {
      register(bridge, { pluginSessionId: 'p1', instanceId: 'place:1', role: 'edit' });
      const req = bridge.sendRequest('/api/test', {}, 'place:1', 'edit');
      bridge.unregisterInstance('p1');
      await expect(req).rejects.toThrow(/disconnected/);
    });

    test('unregisterInstance marks delivered work as outcome_unknown', async () => {
      register(bridge, { pluginSessionId: 'p1', instanceId: 'place:1', role: 'edit' });
      const req = bridge.sendRequest('/api/delete-object', {}, 'place:1', 'edit');
      const delivered = bridge.getPendingRequest('place:1', 'edit')!;
      bridge.acknowledgeRequest(delivered.requestId);
      bridge.unregisterInstance('p1');
      await expect(req).rejects.toMatchObject({ requestId: delivered.requestId, outcome: 'unknown' });
      expect(bridge.getRequestStatus(delivered.requestId)).toMatchObject({ state: 'outcome_unknown' });
    });

    test('unregisterInstance leaves requests alone if another plugin still holds the tuple', async () => {
      // Two plugins both registering the same (instance, role) would be
      // duplicate_instance_role and rejected — this test exercises the case
      // where role differs.
      register(bridge, { pluginSessionId: 'p1', instanceId: 'place:1', role: 'edit' });
      register(bridge, { pluginSessionId: 'p2', instanceId: 'place:1', role: 'server' });
      const editReq = bridge.sendRequest('/api/test', {}, 'place:1', 'edit');
      const serverReq = bridge.sendRequest('/api/test', {}, 'place:1', 'server');

      bridge.unregisterInstance('p2'); // remove server plugin
      // edit request should still be pending (edit plugin still here)
      const stillPending = bridge.getPendingRequest('place:1', 'edit');
      expect(stillPending).toBeTruthy();

      // server request should have been rejected
      await expect(serverReq).rejects.toThrow(/disconnected/);

      // Clean up the edit request to avoid hanging promise.
      bridge.resolveRequest(stillPending!.requestId, {});
      await editReq;
    });

    describe('cleanupStaleInstances (TTL-based reaping)', () => {
      test('keeps instances below the TTL', () => {
        bridge.staleInstanceMs = 10000; // 10s
        register(bridge, { pluginSessionId: 'fresh', instanceId: 'place:1', role: 'edit' });
        jest.advanceTimersByTime(5000); // 5s < 10s
        bridge.cleanupStaleInstances();
        expect(bridge.getInstances()).toHaveLength(1);
      });

      test('reaps instances past the TTL', () => {
        bridge.staleInstanceMs = 10000; // 10s
        register(bridge, { pluginSessionId: 'stale', instanceId: 'place:1', role: 'edit' });
        jest.advanceTimersByTime(15000); // 15s > 10s
        bridge.cleanupStaleInstances();
        expect(bridge.getInstances()).toHaveLength(0);
        expect(bridge.getRecentDisconnects()[0]).toMatchObject({
          pluginSessionId: 'stale',
          reason: 'stale_timeout',
        });
      });

      test('activity refresh (poll) resets the TTL clock', () => {
        bridge.staleInstanceMs = 10000; // 10s
        register(bridge, { pluginSessionId: 'refreshed', instanceId: 'place:1', role: 'edit' });
        jest.advanceTimersByTime(7000); // 7s
        bridge.updateInstanceActivity('refreshed'); // poll refreshes lastActivity
        jest.advanceTimersByTime(7000); // 14s since register, but 7s since activity
        bridge.cleanupStaleInstances();
        expect(bridge.getInstances()).toHaveLength(1);
      });

      test('reaping a stale instance rejects its pending requests as disconnected', async () => {
        bridge.staleInstanceMs = 10000; // 10s
        register(bridge, { pluginSessionId: 'gone', instanceId: 'place:1', role: 'edit' });
        const req = bridge.sendRequest('/api/test', {}, 'place:1', 'edit');
        jest.advanceTimersByTime(15000); // 15s > 10s
        bridge.cleanupStaleInstances();
        await expect(req).rejects.toThrow(/disconnected/);
      });

      test('default TTL is 90s (tolerates Studio throttling gaps)', () => {
        expect(bridge.staleInstanceMs).toBeGreaterThanOrEqual(90000);
      });
    });
  });
});
