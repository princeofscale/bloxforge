import request from 'supertest';
import { createHttpServer } from '../http-server.js';
import { RobloxStudioTools } from '../tools/index.js';
import { BridgeService } from '../bridge-service.js';
import { Application } from 'express';

const READY_BODY = {
  pluginSessionId: 'session-1',
  instanceId: 'place:test',
  role: 'edit',
  placeId: 0,
  placeName: 'TestPlace',
  dataModelName: 'TestPlace',
  isRunning: false,
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
    
    bridge = new BridgeService();
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
});
