import request from 'supertest';
import { BridgeService } from '../bridge-service.js';
import { createHttpServer } from '../http-server.js';
import { RobloxStudioTools } from '../tools/index.js';

describe('server-client route authorization', () => {
  const token = 'test-server-token';
  let bridge: BridgeService;

  beforeEach(() => {
    process.env.BLOXFORGE_SESSION_TOKEN = token;
    bridge = new BridgeService('');
  });

  afterEach(() => {
    delete process.env.BLOXFORGE_SESSION_TOKEN;
    bridge.clearAllPendingRequests();
  });

  test.each([
    ['get', '/health'],
    ['get', '/status'],
    ['get', '/dashboard'],
    ['get', '/dashboard/data'],
    ['get', '/instances'],
    ['get', '/request/unknown/status'],
  ] as const)('%s %s requires the configured bearer token', async (method, path) => {
    const app = createHttpServer(new RobloxStudioTools(bridge), bridge);
    await request(app)[method](path).expect(401);
    await request(app)[method](path).set('Authorization', `Bearer ${token}`).expect((res) => {
      expect(res.status).not.toBe(401);
    });
  });

  test.each([
    ['/cancel', { requestId: 'unknown' }],
    ['/proxy', {}],
    ['/mcp/example', {}],
  ])('POST %s requires the configured bearer token', async (path, body) => {
    const app = createHttpServer(new RobloxStudioTools(bridge), bridge);
    await request(app).post(path).send(body).expect(401);
    await request(app)
      .post(path)
      .set('Authorization', `Bearer ${token}`)
      .send(body)
      .expect((res) => {
        expect(res.status).not.toBe(401);
      });
  });

  test('protects the Streamable HTTP MCP endpoint', async () => {
    const app = createHttpServer(
      new RobloxStudioTools(bridge),
      bridge,
      new Set(),
      { name: 'test', version: '0.0.0', tools: [] },
    );
    const body = { jsonrpc: '2.0', id: 1, method: 'tools/list' };
    await request(app).post('/mcp').send(body).expect(401);
    await request(app)
      .post('/mcp')
      .set('Authorization', `Bearer ${token}`)
      .send(body)
      .expect((res) => {
        expect(res.status).not.toBe(401);
      });
  });

  test('keeps public localhost diagnostics payload-free', async () => {
    delete process.env.BLOXFORGE_SESSION_TOKEN;
    const app = createHttpServer(new RobloxStudioTools(bridge), bridge);
    const response = await request(app).get('/dashboard/data').expect(200);
    expect(response.body).not.toHaveProperty('operations');
  });
});
