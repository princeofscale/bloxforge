import request from 'supertest';
import { createHttpServer } from '../http-server.js';
import { RobloxStudioTools } from '../tools/index.js';
import { BridgeService } from '../bridge-service.js';
import { Application } from 'express';
import WebSocket from 'ws';
import { listenWithRetry } from '../http-server.js';

const READY_BODY = {
  pluginSessionId: 'session-1',
  instanceId: 'place:test',
  role: 'edit',
  placeId: 0,
  placeName: 'TestPlace',
  dataModelName: 'TestPlace',
  isRunning: false,
};

describe('HTTP Server', () => {
  let app: Application & any;
  let bridge: BridgeService;
  let tools: RobloxStudioTools;

  beforeEach(() => {
    bridge = new BridgeService();
    tools = new RobloxStudioTools(bridge);
    app = createHttpServer(tools, bridge);
  });

  afterEach(() => {
    bridge.clearAllPendingRequests();
  });

  describe('Health Check', () => {
    test('returns health status', async () => {
      const response = await request(app).get('/health').expect(200);
      expect(response.body).toMatchObject({
        status: 'ok',
        service: 'bloxforge',
        pluginConnected: false,
        mcpServerActive: false,
      });
    });
  });

  describe('Dashboard', () => {
    test('serves the dashboard HTML page', async () => {
      const response = await request(app).get('/dashboard').expect(200);
      expect(response.text).toContain('BloxForge dashboard');
      expect(response.headers['content-type']).toMatch(/html/);
    });

    test('serves payload-free live dashboard data', async () => {
      const response = await request(app).get('/dashboard/data').expect(200);
      expect(response.body).toMatchObject({ pluginConnected: false, instanceCount: 0 });
      expect(response.body).not.toHaveProperty('operations');
    });
  });

  describe('Plugin Connection Management', () => {
    test('plugin ready notification', async () => {
      const response = await request(app).post('/ready').send(READY_BODY).expect(200);
      expect(response.body).toMatchObject({ success: true, assignedRole: 'edit', instanceId: 'place:test' });
      expect(app.isPluginConnected()).toBe(true);
    });

    test('plugin ready records version metadata and exposes mismatch status', async () => {
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const versionedApp = createHttpServer(
        tools,
        bridge,
        undefined,
        { name: 'bloxforge', version: '2.0.0', tools: [] },
      );
      try {
        await request(versionedApp).post('/ready').send({
          ...READY_BODY,
          pluginVersion: '1.9.0',
          pluginVariant: 'main',
          protocolVersion: 0,
        }).expect(200);
        await request(versionedApp).post('/ready').send({
          ...READY_BODY,
          pluginVersion: '1.9.0',
          pluginVariant: 'main',
          protocolVersion: 0,
        }).expect(200);

        const health = await request(versionedApp).get('/health').expect(200);
        expect(health.body).toMatchObject({
          serverVersion: '2.0.0',
          versionMismatch: true,
          protocolVersion: 3,
          protocolMismatch: true,
        });
        expect(health.body.instances[0]).toMatchObject({
          pluginVersion: '1.9.0',
          pluginVariant: 'main',
          pluginProtocolVersion: 0,
          serverProtocolVersion: 3,
          serverVersion: '2.0.0',
          versionMismatch: true,
          protocolMismatch: true,
        });
        expect(errorSpy.mock.calls.some(call => call[0].includes('[version-mismatch]'))).toBe(true);
        expect(errorSpy.mock.calls.some(call => call[0].includes('[protocol-mismatch]'))).toBe(true);
      } finally {
        errorSpy.mockRestore();
      }
    });

    test('health exposes lazy and session recorder state', async () => {
      const versionedApp = createHttpServer(
        tools,
        bridge,
        undefined,
        { name: 'bloxforge', version: '2.0.0', tools: [] },
      );
      const health = await request(versionedApp).get('/health').expect(200);
      expect(health.body).toMatchObject({
        lazyTools: true,
        activeToolCount: expect.any(Number),
        loadedToolsets: expect.any(Array),
        session: {
          totalCalls: 0,
          failures: 0,
          recent: [],
        },
      });
    });

    test('rejects /ready without required fields', async () => {
      const response = await request(app).post('/ready').send({ role: 'client' }).expect(400);
      expect(response.body).toMatchObject({
        success: false,
        error: 'missing_ready_fields',
        message: '/ready missing required field(s): pluginSessionId, instanceId',
        missingFields: ['pluginSessionId', 'instanceId'],
        request: { role: 'client' },
      });
    });

    test('replaces a stale edit session on /ready', async () => {
      await request(app).post('/ready').send(READY_BODY).expect(200);
      const replacement = await request(app)
        .post('/ready')
        .send({ ...READY_BODY, pluginSessionId: 'session-2' })
        .expect(200);
      expect(replacement.body.sessionToken).toEqual(expect.any(String));
      expect(bridge.getInstances()).toHaveLength(1);
      expect(bridge.getInstances()[0].pluginSessionId).toBe('session-2');
    });

    test('plugin disconnect by pluginSessionId', async () => {
      await request(app).post('/ready').send(READY_BODY).expect(200);
      expect(app.isPluginConnected()).toBe(true);
      const response = await request(app).post('/disconnect').send({ pluginSessionId: 'session-1' }).expect(200);
      expect(response.body).toEqual({ success: true });
      expect(app.isPluginConnected()).toBe(false);
      const health = await request(app).get('/health').expect(200);
      expect(health.body.recentDisconnects[0]).toMatchObject({
        pluginSessionId: 'session-1',
        reason: 'plugin_request',
      });
    });

    test('logs mismatch warnings again after a session disconnects and reconnects', async () => {
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const versionedApp = createHttpServer(
        tools,
        bridge,
        undefined,
        { name: 'bloxforge', version: '2.0.0', tools: [] },
      );
      const mismatchedReady = {
        ...READY_BODY,
        pluginVersion: '1.9.0',
        protocolVersion: 0,
      };

      try {
        await request(versionedApp).post('/ready').send(mismatchedReady).expect(200);
        await request(versionedApp).post('/disconnect').send({ pluginSessionId: 'session-1' }).expect(200);
        await request(versionedApp).post('/ready').send(mismatchedReady).expect(200);

        expect(errorSpy.mock.calls.filter(call => call[0].includes('[version-mismatch]'))).toHaveLength(2);
        expect(errorSpy.mock.calls.filter(call => call[0].includes('[protocol-mismatch]'))).toHaveLength(2);
      } finally {
        errorSpy.mockRestore();
      }
    });

    test('disconnect rejects pending requests targeting that tuple', async () => {
      await request(app).post('/ready').send(READY_BODY).expect(200);
      const p1 = bridge.sendRequest('/api/file-tree', {}, 'place:test', 'edit');
      const p2 = bridge.sendRequest('/api/place-info', {}, 'place:test', 'edit');
      p1.catch(() => {});
      p2.catch(() => {});
      expect(bridge.getPendingRequest('place:test', 'edit')).toBeTruthy();
      await request(app).post('/disconnect').send({ pluginSessionId: 'session-1' }).expect(200);
      expect(bridge.getPendingRequest('place:test', 'edit')).toBeNull();
    });

    test('stale instance detection via unregister', () => {
      bridge.registerInstance({ pluginSessionId: 'stale-1', instanceId: 'place:s', role: 'edit' });
      expect(app.isPluginConnected()).toBe(true);
      bridge.unregisterInstance('stale-1');
      expect(app.isPluginConnected()).toBe(false);
    });
  });

  describe('WebSocket bridge stream', () => {
    test('accepts the plugin bearer token and resolves a streamed request', async () => {
      const ready = await request(app).post('/ready').send({
        ...READY_BODY,
        pluginSessionId: 'stream-1',
        instanceId: 'place:stream',
      }).expect(200);
      const originalNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      const { server } = await listenWithRetry(app, '127.0.0.1', 0, 1);
      process.env.NODE_ENV = originalNodeEnv;
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('expected TCP server address');
      const socket = new WebSocket(`ws://127.0.0.1:${address.port}/stream?pluginSessionId=stream-1`, {
        headers: { Authorization: `Bearer ${ready.body.sessionToken}` },
      });

      try {
        await new Promise<void>((resolve, reject) => {
          socket.once('open', resolve);
          socket.once('error', reject);
        });
        const response = new Promise<any>((resolve, reject) => {
          socket.once('message', (raw) => {
            const frame = JSON.parse(raw.toString());
            socket.send(JSON.stringify({ type: 'ack', requestId: frame.requestId }));
            socket.send(JSON.stringify({ type: 'response', requestId: frame.requestId, response: { ok: true } }));
            resolve(frame);
          });
          socket.once('error', reject);
        });

        const pending = bridge.sendRequest('/api/delete-object', { source: 'stream' }, 'place:stream', 'edit');
        await expect(response).resolves.toMatchObject({ type: 'request', request: { endpoint: '/api/delete-object' } });
        await expect(pending).resolves.toEqual({ ok: true });
      } finally {
        socket.close();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });

    test('redelivers work when a same-session socket supersedes the old socket', async () => {
      await request(app).post('/ready').send({
        ...READY_BODY,
        pluginSessionId: 'stream-race',
        instanceId: 'place:stream-race',
        protocolVersion: 3,
      }).expect(200);
      const { server } = await listenWithRetry(app, '127.0.0.1', 0, 1);
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('expected TCP server address');
      const url = `ws://127.0.0.1:${address.port}/stream?pluginSessionId=stream-race`;
      const first = new WebSocket(url);
      let second: WebSocket | undefined;

      try {
        await new Promise<void>((resolve, reject) => {
          first.once('open', resolve);
          first.once('error', reject);
        });
        const firstFramePromise = new Promise<any>((resolve, reject) => {
          first.once('message', raw => resolve(JSON.parse(raw.toString())));
          first.once('error', reject);
        });
        const pending = bridge.sendRequest('/api/delete-object', {}, 'place:stream-race', 'edit');
        pending.catch(() => {});
        const firstFrame = await firstFramePromise;
        expect(firstFrame.deliveryAttempt).toBe(1);

        second = new WebSocket(url);
        const secondFramePromise = new Promise<any>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('replacement socket did not receive request')), 2000);
          second!.once('message', raw => {
            clearTimeout(timeout);
            resolve(JSON.parse(raw.toString()));
          });
          second!.once('error', reject);
        });
        await new Promise<void>((resolve, reject) => {
          second!.once('open', resolve);
          second!.once('error', reject);
        });
        const secondFrame = await secondFramePromise;
        expect(secondFrame).toMatchObject({
          requestId: firstFrame.requestId,
          deliveryAttempt: 2,
        });
        second.send(JSON.stringify({
          type: 'response',
          requestId: secondFrame.requestId,
          serverEpoch: secondFrame.serverEpoch,
          deliveryAttempt: secondFrame.deliveryAttempt,
          leaseToken: secondFrame.leaseToken,
          response: { socket: 'replacement' },
        }));
        await expect(pending).resolves.toEqual({ socket: 'replacement' });
      } finally {
        first.close();
        second?.close();
        await new Promise<void>(resolve => server.close(() => resolve()));
      }
    });
  });

  describe('Polling Endpoint', () => {
    test('503 when MCP server is not active', async () => {
      await request(app).post('/ready').send(READY_BODY).expect(200);
      const response = await request(app).get('/poll?pluginSessionId=session-1').expect(503);
      expect(response.body).toMatchObject({
        error: 'MCP server not connected',
        pluginConnected: true,
        mcpConnected: false,
        request: null,
        knownInstance: true,
        versionMismatch: false,
      });
    });

    test('returns pending request when MCP is active and tuple matches', async () => {
      await request(app).post('/ready').send(READY_BODY).expect(200);
      app.setMCPServerActive(true);
      const pending = bridge.sendRequest('/api/delete-object', { data: 'test' }, 'place:test', 'edit');
      pending.catch(() => {});
      const response = await request(app).get('/poll?pluginSessionId=session-1').expect(200);
      expect(response.body).toMatchObject({
        request: { endpoint: '/api/delete-object', data: { data: 'test' } },
        mcpConnected: true,
        pluginConnected: true,
        knownInstance: true,
      });
      expect(response.body.requestId).toBeTruthy();
    });

    test('returns null when no pending request matches the polling plugin', async () => {
      await request(app).post('/ready').send(READY_BODY).expect(200);
      app.setMCPServerActive(true);
      const response = await request(app).get('/poll?pluginSessionId=session-1').expect(200);
      expect(response.body).toMatchObject({ request: null, mcpConnected: true, pluginConnected: true });
    });

    test('knownInstance=false when pluginSessionId is unknown (server restarted)', async () => {
      app.setMCPServerActive(true);
      const response = await request(app).get('/poll?pluginSessionId=unknown-session').expect(200);
      expect(response.body.knownInstance).toBe(false);
      expect(response.body.request).toBeNull();
    });
  });

  describe('Response Handling', () => {
    test('acknowledges delivery and exposes request status', async () => {
      const requestPromise = bridge.sendRequest('/api/delete-object', {}, 'place:test', 'edit');
      requestPromise.catch(() => {});
      const pending = bridge.getPendingRequest('place:test', 'edit')!;

      await request(app).post('/ack').send({ requestId: pending.requestId }).expect(200);
      const status = await request(app).get(`/request/${pending.requestId}/status`).expect(200);

      expect(status.body).toMatchObject({ requestId: pending.requestId, state: 'started' });
      bridge.resolveRequest(pending.requestId, { ok: true });
      await expect(requestPromise).resolves.toEqual({ ok: true });
    });

    test('rejects ack and status lookup for unknown request ids', async () => {
      await request(app).post('/ack').send({ requestId: 'missing' }).expect(404);
      await request(app).get('/request/missing/status').expect(404);
    });

    test('handles successful response', async () => {
      const requestPromise = bridge.sendRequest('/api/delete-object', {}, 'place:test', 'edit');
      const pending = bridge.getPendingRequest('place:test', 'edit');
      const response = await request(app)
        .post('/response')
        .send({ requestId: pending!.requestId, response: { result: 'success' } })
        .expect(200);
      expect(response.body).toEqual({ success: true });
      const result = await requestPromise;
      expect(result).toEqual({ result: 'success' });
      await request(app)
        .post('/response')
        .send({ requestId: pending!.requestId, response: { result: 'duplicate' } })
        .expect(409);
      expect(bridge.getRequestStatus(pending!.requestId)).toMatchObject({ response: { result: 'success' } });
    });

    test('handles error response', async () => {
      const requestPromise = bridge.sendRequest('/api/delete-object', {}, 'place:test', 'edit');
      requestPromise.catch(() => {});
      const pending = bridge.getPendingRequest('place:test', 'edit');
      await request(app)
        .post('/response')
        .send({ requestId: pending!.requestId, error: 'Test error message' })
        .expect(200);
      await expect(requestPromise).rejects.toEqual('Test error message');
    });
  });

  describe('MCP Server State', () => {
    test('tracks activity', async () => {
      app.setMCPServerActive(true);
      expect(app.isMCPServerActive()).toBe(true);
      app.trackMCPActivity();
      expect(app.isMCPServerActive()).toBe(true);
    });

    test('times out after inactivity', () => {
      app.setMCPServerActive(true);
      expect(app.isMCPServerActive()).toBe(true);
      const original = Date.now;
      Date.now = jest.fn(() => original() + 31000);
      expect(app.isMCPServerActive()).toBe(false);
      Date.now = original;
    });
  });

  describe('Status Endpoint', () => {
    test('returns current status', async () => {
      await request(app).post('/ready').send(READY_BODY).expect(200);
      app.setMCPServerActive(true);
      const response = await request(app).get('/status').expect(200);
      expect(response.body).toMatchObject({ pluginConnected: true, mcpServerActive: true });
      expect(response.body.instances).toHaveLength(1);
      expect(response.body.instances[0]).toMatchObject({
        instanceId: 'place:test',
        role: 'edit',
        placeName: 'TestPlace',
      });
    });
  });
});
