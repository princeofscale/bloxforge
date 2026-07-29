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
  protocolVersion: 3,
};

describe('Authentication E2E', () => {
  let app: Application & any;
  let bridge: BridgeService;
  let tools: RobloxStudioTools;

  beforeEach(() => {
    // Tests run with NODE_ENV='test', but http-server.ts has:
    // const requirePluginAuth = process.env.NODE_ENV !== 'test';
    // To actually test auth, we must mock process.env.NODE_ENV
    process.env.NODE_ENV = 'production';

    bridge = new BridgeService('');
    tools = new RobloxStudioTools(bridge);
    app = createHttpServer(tools, bridge);
    app.setMCPServerActive(true);
  });

  afterEach(() => {
    process.env.NODE_ENV = 'test';
    bridge.clearAllPendingRequests();
  });

  test('Plugin registration assigns session token', async () => {
    const response = await request(app)
      .post('/ready')
      .send(READY_BODY)
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.sessionToken).toBeDefined();
    expect(typeof response.body.sessionToken).toBe('string');
  });

  test('Authenticated poll succeeds', async () => {
    // Register
    const readyRes = await request(app).post('/ready').send(READY_BODY).expect(200);
    const token = readyRes.body.sessionToken;

    // Poll with token
    await request(app)
      .get('/poll')
      .query({ pluginSessionId: 'session-1' })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
  });

  test('Unauthenticated poll on authenticated instance rejected', async () => {
    // Register
    await request(app).post('/ready').send(READY_BODY).expect(200);

    // Poll without token
    const res = await request(app)
      .get('/poll')
      .query({ pluginSessionId: 'session-1' })
      .expect(401);

    expect(res.body.error).toBe('invalid_session_token');
  });

  test('Invalid token rejected', async () => {
    // Register
    await request(app).post('/ready').send(READY_BODY).expect(200);

    // Poll with wrong token
    const res = await request(app)
      .get('/poll')
      .query({ pluginSessionId: 'session-1' })
      .set('Authorization', `Bearer wrong-token`)
      .expect(401);

    expect(res.body.error).toBe('invalid_session_token');
  });

  test.each([
    ['/disconnect', { pluginSessionId: 'session-1' }],
    ['/reconcile', { pluginSessionId: 'session-1', serverEpoch: 'wrong', receipts: [] }],
    ['/ack', { pluginSessionId: 'session-1', requestId: 'missing' }],
    ['/response', { pluginSessionId: 'session-1', requestId: 'missing', response: {} }],
  ])('protects plugin transport route %s', async (path, body) => {
    const ready = await request(app).post('/ready').send(READY_BODY).expect(200);
    await request(app).post(path).send(body).expect(401);
    await request(app)
      .post(path)
      .set('Authorization', `Bearer ${ready.body.sessionToken}`)
      .send(body)
      .expect((res) => {
        expect(res.status).not.toBe(401);
      });
  });

  test('Authenticated disconnect revokes the registration and its token', async () => {
    const readyRes = await request(app).post('/ready').send(READY_BODY).expect(200);
    const token = readyRes.body.sessionToken;

    await request(app)
      .post('/disconnect')
      .set('Authorization', `Bearer ${token}`)
      .send({ pluginSessionId: 'session-1' })
      .expect(200);

    expect(bridge.getInstances()).toHaveLength(0);
    expect(bridge.authenticatePlugin('session-1', token)).toBe(false);
  });

  test('Refreshing ready rotates the token', async () => {
    const first = await request(app).post('/ready').send(READY_BODY).expect(200);
    const second = await request(app).post('/ready').send(READY_BODY).expect(200);

    await request(app)
      .get('/poll')
      .query({ pluginSessionId: 'session-1' })
      .set('Authorization', `Bearer ${first.body.sessionToken}`)
      .expect(401);

    await request(app)
      .get('/poll')
      .query({ pluginSessionId: 'session-1' })
      .set('Authorization', `Bearer ${second.body.sessionToken}`)
      .expect(200);
  });

  test('WebSocket stream accepts the Studio Authorization header', async () => {
    const ready = await request(app).post('/ready').send(READY_BODY).expect(200);
    const { server } = await listenWithRetry(app, '127.0.0.1', 0, 1);
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('expected TCP server address');

    const socket = new WebSocket(
      `ws://127.0.0.1:${address.port}/stream?pluginSessionId=session-1`,
      { headers: { Authorization: `Bearer ${ready.body.sessionToken}` } },
    );

    try {
      await expect(new Promise<void>((resolve, reject) => {
        socket.once('open', resolve);
        socket.once('error', reject);
      })).resolves.toBeUndefined();
    } finally {
      socket.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test('WebSocket stream rejects a missing Studio token', async () => {
    await request(app).post('/ready').send(READY_BODY).expect(200);
    const { server } = await listenWithRetry(app, '127.0.0.1', 0, 1);
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('expected TCP server address');
    const socket = new WebSocket(`ws://127.0.0.1:${address.port}/stream?pluginSessionId=session-1`);

    try {
      await expect(new Promise<number>((resolve, reject) => {
        socket.once('unexpected-response', (_request, response) => resolve(response.statusCode ?? 0));
        socket.once('open', () => reject(new Error('unauthenticated socket opened')));
        socket.once('error', reject);
      })).resolves.toBe(401);
    } finally {
      socket.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
