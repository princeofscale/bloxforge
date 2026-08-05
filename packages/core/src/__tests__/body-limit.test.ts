import request from 'supertest';
import { createHttpServer } from '../http-server.js';
import { RobloxStudioTools } from '../tools/index.js';
import { BridgeService } from '../bridge-service.js';

describe('HTTP Body Limit', () => {
  let bridge: BridgeService;
  let tools: RobloxStudioTools;

  beforeEach(() => {
    bridge = new BridgeService();
    tools = new RobloxStudioTools(bridge);
  });

  afterEach(() => {
    bridge.clearAllPendingRequests();
    delete process.env.MCP_HTTP_BODY_LIMIT;
  });

  test('Default body limit allows normal requests', async () => {
    const app = createHttpServer(tools, bridge);
    const body = {
      pluginSessionId: 'session-1',
      instanceId: 'place:test',
      role: 'edit',
      placeId: 0,
      placeName: 'TestPlace',
      dataModelName: 'TestPlace',
      isRunning: false,
      protocolVersion: 3,
    };

    await request(app)
      .post('/ready')
      .send(body)
      .expect(200);
  });

  test('Custom body limit via env var rejects oversized body', async () => {
    process.env.MCP_HTTP_BODY_LIMIT = '1kb';
    const app = createHttpServer(tools, bridge);

    // Create a 2KB payload
    const largeString = 'a'.repeat(2048);
    const body = {
      pluginSessionId: 'session-1',
      instanceId: 'place:test',
      role: 'edit',
      largeData: largeString
    };

    await request(app)
      .post('/ready')
      .send(body)
      .expect(413);
  });

  test('Custom body limit allows requests under limit', async () => {
    process.env.MCP_HTTP_BODY_LIMIT = '5kb';
    const app = createHttpServer(tools, bridge);

    // Create a 2KB payload
    const largeString = 'a'.repeat(2048);
    const body = {
      pluginSessionId: 'session-1',
      instanceId: 'place:test',
      role: 'edit',
      protocolVersion: 3,
      largeData: largeString
    };

    await request(app)
      .post('/ready')
      .send(body)
      .expect(200);
  });

  test.each([
    ['application/x-www-form-urlencoded', 'pluginSessionId=session-1&instanceId=place%3Atest&role=edit'],
    ['text/plain', JSON.stringify({ pluginSessionId: 'session-1', instanceId: 'place:test', role: 'edit' })],
  ])('rejects %s machine-control bodies', async (contentType, body) => {
    const app = createHttpServer(tools, bridge);
    await request(app)
      .post('/ready')
      .set('Content-Type', contentType)
      .send(body)
      .expect(415);
  });

  test('rejects missing content type and malformed JSON', async () => {
    const app = createHttpServer(tools, bridge);
    await request(app).post('/ready').send().expect(415);
    await request(app)
      .post('/ready')
      .set('Content-Type', 'application/json')
      .send('{"pluginSessionId":')
      .expect(400);
  });

  test('rejects browser-originated control requests', async () => {
    const app = createHttpServer(tools, bridge);
    await request(app)
      .post('/ready')
      .set('Origin', 'https://attacker.example')
      .send({ pluginSessionId: 'session-1', instanceId: 'place:test', role: 'edit' })
      .expect(403);
  });
});
