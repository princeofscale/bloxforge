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
      largeData: largeString
    };

    await request(app)
      .post('/ready')
      .send(body)
      .expect(200);
  });
});
