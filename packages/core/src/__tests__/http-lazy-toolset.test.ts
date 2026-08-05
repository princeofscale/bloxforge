import request from 'supertest';
import { BridgeService } from '../bridge-service.js';
import { createHttpServer } from '../http-server.js';
import { RobloxStudioTools } from '../tools/index.js';
import { TOOL_DEFINITIONS } from '../tools/definitions.js';
import { ToolRegistry } from '../tools/tool-pipeline.js';
import { CORE_TOOLS } from '../tools/tool-catalog.js';

// applyToolset — the only thing that calls registry.activate — lives on the
// stdio server. Over the Streamable HTTP transport, load_toolset reported
// "loaded: [scene], count: 74", the very next tools/list still returned the 29
// core tools, and the response's client_hint blamed the host's schema-refresh
// step for something the server had simply never done. The tools were callable
// blind the whole time, so nothing failed loudly.

const rpc = (app: ReturnType<typeof createHttpServer>, sessionId: string | undefined, body: unknown) => {
  const req = request(app)
    .post('/mcp')
    .set('accept', 'application/json, text/event-stream')
    .set('content-type', 'application/json');
  if (sessionId) req.set('mcp-session-id', sessionId);
  return req.send(body as object);
};

// The transport answers as SSE; pull the single data frame back out.
const decode = (text: string) => {
  const line = text.split('\n').find((l) => l.startsWith('data: '));
  return JSON.parse(line ? line.slice(6) : text);
};

describe('load_toolset over the Streamable HTTP transport', () => {
  let bridge: BridgeService;
  let app: ReturnType<typeof createHttpServer>;
  let sessionId: string | undefined;

  beforeEach(async () => {
    bridge = new BridgeService('');
    const tools = new RobloxStudioTools(bridge);
    const registry = new ToolRegistry();
    registry.enableLazy(CORE_TOOLS as unknown as string[]);
    app = createHttpServer(tools, bridge, undefined, {
      name: 'bloxforge-test',
      version: '0.0.0',
      tools: TOOL_DEFINITIONS,
    }, registry);

    const init = await rpc(app, undefined, {
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } },
    });
    sessionId = init.headers['mcp-session-id'];
    await rpc(app, sessionId, { jsonrpc: '2.0', method: 'notifications/initialized', params: {} });
  });

  afterEach(() => {
    bridge.clearAllPendingRequests();
  });

  const listToolNames = async (): Promise<string[]> => {
    const res = await rpc(app, sessionId, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    return decode(res.text).result.tools.map((t: { name: string }) => t.name);
  };

  it('advertises the newly loaded domain on the next tools/list', async () => {
    const before = await listToolNames();
    expect(before).not.toContain('get_file_tree');

    await rpc(app, sessionId, {
      jsonrpc: '2.0', id: 3, method: 'tools/call',
      params: { name: 'load_toolset', arguments: { toolsets: ['scene'] } },
    });

    const after = await listToolNames();
    expect(after).toContain('get_file_tree');
    expect(after.length).toBeGreaterThan(before.length);
  });

  it('does not expand the list when the request is rejected', async () => {
    const before = await listToolNames();
    const res = await rpc(app, sessionId, {
      jsonrpc: '2.0', id: 4, method: 'tools/call',
      params: { name: 'load_toolset', arguments: { toolsets: 'scene' } },
    });
    expect(decode(res.text).result.isError).toBe(true);
    expect(await listToolNames()).toEqual(before);
  });
});
