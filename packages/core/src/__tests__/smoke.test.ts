import { BridgeService } from '../bridge-service.js';
import { createHttpServer, TOOL_HANDLERS } from '../http-server.js';
import { RobloxStudioTools } from '../tools/index.js';
import request from 'supertest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const READY = {
  pluginSessionId: 'session-1',
  instanceId: 'place:test',
  role: 'edit',
  placeId: 0,
  placeName: 'TestPlace',
  dataModelName: 'TestPlace',
  isRunning: false,
};

const ZERO_NETWORK_STATE = {
  InboundNetworkMinDelayMs: 0,
  OutboundNetworkMinDelayMs: 0,
  InboundNetworkJitterMs: 0,
  OutboundNetworkJitterMs: 0,
  InboundNetworkLossPercent: 0,
  OutboundNetworkLossPercent: 0,
};

const DIRTY_NETWORK_STATE = {
  InboundNetworkMinDelayMs: 50,
  OutboundNetworkMinDelayMs: 50,
  InboundNetworkJitterMs: 10,
  OutboundNetworkJitterMs: 10,
  InboundNetworkLossPercent: 0.5,
  OutboundNetworkLossPercent: 0.5,
};

describe('Smoke', () => {
  test('source does not force playtest shutdown with brittle fallbacks', () => {
    const cwd = process.cwd();
    const repoRoot = fs.existsSync(path.join(cwd, 'studio-plugin')) ? cwd : path.resolve(cwd, '../..');
    const guardedFiles = [
      path.join(repoRoot, 'packages/core/src/tools/index.ts'),
      path.join(repoRoot, 'studio-plugin/src/modules/ClientBroker.ts'),
      path.join(repoRoot, 'studio-plugin/src/modules/Communication.ts'),
      path.join(repoRoot, 'studio-plugin/src/modules/handlers/TestHandlers.ts'),
    ];

    for (const file of guardedFiles) {
      const source = fs.readFileSync(file, 'utf8');
      expect(source).not.toMatch(/RunService\s*[:.]\s*Stop\s*\(/);
      expect(source).not.toContain('/api/force-stop-runtime');
      expect(source).not.toContain('runtime_runservice_stop');
      expect(source).not.toContain('windows_shift_f5');
      expect(source).not.toContain('WScript.Shell');
      expect(source).not.toContain('SendKeys');
      expect(source).not.toContain('powershell.exe');
    }
  });

  test('script edit handlers preserve literal backslash escapes in script source', () => {
    const cwd = process.cwd();
    const repoRoot = fs.existsSync(path.join(cwd, 'studio-plugin')) ? cwd : path.resolve(cwd, '../..');
    const source = fs.readFileSync(path.join(repoRoot, 'studio-plugin/src/modules/handlers/ScriptHandlers.ts'), 'utf8');
    expect(source).not.toContain('gsub("\\\\n", "\\n")');
    expect(source).toContain('function normalizeEscapes(s: string): string');
  });

  test('BridgeService instantiable', () => {
    const bridge = new BridgeService();
    expect(bridge).toBeDefined();
    expect(bridge.getPendingRequest('place:nope', 'edit')).toBeNull();
  });

  test('HTTP server starts and responds to health check', async () => {
    const bridge = new BridgeService();
    const tools = new RobloxStudioTools(bridge);
    const app = createHttpServer(tools, bridge);

    const response = await request(app).get('/health').expect(200);
    expect(response.body.status).toBe('ok');
    expect(response.body.service).toBe('bloxforge');
  });

  test('clearAllPendingRequests rejects all pending', async () => {
    const bridge = new BridgeService();
    const p1 = bridge.sendRequest('/test1', {}, 'place:test', 'edit');
    const p2 = bridge.sendRequest('/test2', {}, 'place:test', 'edit');
    expect(bridge.getPendingRequest('place:test', 'edit')).toBeTruthy();
    bridge.clearAllPendingRequests();
    expect(bridge.getPendingRequest('place:test', 'edit')).toBeNull();
    await expect(p1).rejects.toThrow('Connection closed');
    await expect(p2).rejects.toThrow('Connection closed');
  });

  test('Disconnect rejects pending requests for that (instanceId, role)', async () => {
    const bridge = new BridgeService();
    const tools = new RobloxStudioTools(bridge);
    const app = createHttpServer(tools, bridge);

    await request(app).post('/ready').send(READY).expect(200);
    const pending = bridge.sendRequest('/test', {}, 'place:test', 'edit');
    pending.catch(() => {});
    await request(app).post('/disconnect').send({ pluginSessionId: 'session-1' }).expect(200);
    await expect(pending).rejects.toThrow(/disconnected/);
  });

  test('Connection state lifecycle', async () => {
    const bridge = new BridgeService();
    const tools = new RobloxStudioTools(bridge);
    const app = createHttpServer(tools, bridge) as any;
    expect(app.isPluginConnected()).toBe(false);
    await request(app).post('/ready').send(READY).expect(200);
    expect(app.isPluginConnected()).toBe(true);
    await request(app).post('/disconnect').send({ pluginSessionId: 'session-1' }).expect(200);
    expect(app.isPluginConnected()).toBe(false);
  });

  test('start_playtest rejects numPlayers', async () => {
    const bridge = new BridgeService();
    const tools = new RobloxStudioTools(bridge);
    await expect(tools.startPlaytest('play', 1)).rejects.toThrow(/multiplayer_test_start/);
  });

  test('client broker forwards script profiler captures to client peers', () => {
    const cwd = process.cwd();
    const repoRoot = fs.existsSync(path.join(cwd, 'studio-plugin')) ? cwd : path.resolve(cwd, '../..');
    const source = fs.readFileSync(path.join(repoRoot, 'studio-plugin/src/modules/ClientBroker.ts'), 'utf8');
    expect(source).toContain('"/api/capture-script-profiler"');
    expect(source).toContain('payload.endpoint === "/api/capture-script-profiler"');
  });

  test('breakpoints decorates response with resolved target role', async () => {
    const bridge = new BridgeService();
    const tools = new RobloxStudioTools(bridge);
    bridge.registerInstance(READY);
    bridge.registerInstance({
      pluginSessionId: 'server-1',
      instanceId: 'place:test',
      role: 'server',
      placeId: 0,
      placeName: 'TestPlace',
      dataModelName: 'Game',
      isRunning: true,
    });

    const resultPromise = tools.breakpoints('set', {
      script_path: 'game.ServerScriptService.Main',
      line: 12,
      log_message: '"probe"',
    }, 'server', 'place:test');

    const pending = bridge.getPendingRequest('place:test', 'server');
    expect(pending?.request).toMatchObject({
      endpoint: '/api/breakpoints',
      data: {
        action: 'set',
        script_path: 'game.ServerScriptService.Main',
        line: 12,
        log_message: '"probe"',
        __mcp_instance_id: 'place:test',
        __mcp_target_role: 'server',
      },
    });
    bridge.resolveRequest(pending!.requestId, { ok: true, breakpoint: { line: 12 } });

    const result = await resultPromise;
    const body = JSON.parse(result.content[0].text);
    expect(body).toEqual({ target: 'server', ok: true, breakpoint: { line: 12 } });
  });

  test('capture_script_profiler routes to one runtime peer and writes raw json to output_path', async () => {
    const bridge = new BridgeService();
    const tools = new RobloxStudioTools(bridge);
    bridge.registerInstance(READY);
    bridge.registerInstance({
      pluginSessionId: 'client-1',
      instanceId: 'place:test',
      role: 'client-1',
      placeId: 0,
      placeName: 'TestPlace',
      dataModelName: 'Game',
      isRunning: true,
    });
    const outputPath = path.join(os.tmpdir(), `rsmcp-script-profiler-${Date.now()}.json`);

    const resultPromise = tools.captureScriptProfiler('client-1', {
      duration_ms: 250,
      output_path: outputPath,
    }, 'place:test');

    const pending = bridge.getPendingRequest('place:test', 'client-1');
    expect(pending?.request).toMatchObject({
      endpoint: '/api/capture-script-profiler',
      data: {
        duration_ms: 250,
        __mcp_include_raw_json: true,
        __mcp_instance_id: 'place:test',
        __mcp_target_role: 'client-1',
      },
    });
    bridge.resolveRequest(pending!.requestId, {
      ok: true,
      raw_json: '{"Version":2}',
      top_functions: [],
      counts: { functions: 0, nodes: 0, categories: 0 },
    });

    const result = await resultPromise;
    const body = JSON.parse(result.content[0].text);
    expect(body).toEqual({
      target: 'client-1',
      ok: true,
      output_path: path.resolve(outputPath),
      top_functions: [],
      counts: { functions: 0, nodes: 0, categories: 0 },
    });
    expect(fs.readFileSync(outputPath, 'utf8')).toBe('{"Version":2}');
    fs.rmSync(outputPath, { force: true });
  });

  test('start_playtest play mode waits for fresh server and client peers', async () => {
    const bridge = new BridgeService();
    const tools = new RobloxStudioTools(bridge);
    bridge.registerInstance(READY);

    const resultPromise = tools.startPlaytest('play');
    const pending = bridge.getPendingRequest('place:test', 'edit');
    expect(pending).toBeTruthy();
    bridge.resolveRequest(pending!.requestId, { success: true, message: 'started' });

    let settled = false;
    void resultPromise.then(() => {
      settled = true;
    }, () => {
      settled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(settled).toBe(false);

    bridge.registerInstance({
      pluginSessionId: 'server-1',
      instanceId: 'place:test',
      role: 'server',
      placeId: 0,
      placeName: 'TestPlace',
      dataModelName: 'TestPlace',
      isRunning: true,
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(settled).toBe(false);

    bridge.registerInstance({
      pluginSessionId: 'client-1',
      instanceId: 'place:test',
      role: 'client-1',
      placeId: 0,
      placeName: 'TestPlace',
      dataModelName: 'TestPlace',
      isRunning: true,
    });

    const result = await resultPromise;
    const body = JSON.parse(result.content[0].text);
    expect(body).toMatchObject({
      success: true,
      runtimeReady: true,
      timedOut: false,
    });
    expect(body.roles).toContain('server');
    expect(body.roles).toContain('client-1');
  });

  test('start_playtest run mode waits only for a fresh server peer', async () => {
    const bridge = new BridgeService();
    const tools = new RobloxStudioTools(bridge);
    bridge.registerInstance(READY);

    const resultPromise = tools.startPlaytest('run');
    const pending = bridge.getPendingRequest('place:test', 'edit');
    expect(pending).toBeTruthy();
    bridge.resolveRequest(pending!.requestId, { success: true, message: 'started' });

    let settled = false;
    void resultPromise.then(() => {
      settled = true;
    }, () => {
      settled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(settled).toBe(false);

    bridge.registerInstance({
      pluginSessionId: 'server-1',
      instanceId: 'place:test',
      role: 'server',
      placeId: 0,
      placeName: 'TestPlace',
      dataModelName: 'TestPlace',
      isRunning: true,
    });

    const result = await resultPromise;
    const body = JSON.parse(result.content[0].text);
    expect(body).toMatchObject({
      success: true,
      runtimeReady: true,
      timedOut: false,
    });
    expect(body.roles).toContain('server');
    expect(body.roles).not.toContain('client-1');
  });

  test('stop_playtest waits for runtime peers to disconnect', async () => {
    const bridge = new BridgeService();
    const tools = new RobloxStudioTools(bridge);
    bridge.registerInstance(READY);
    bridge.registerInstance({
      pluginSessionId: 'server-1',
      instanceId: 'place:test',
      role: 'server',
      placeId: 0,
      placeName: 'TestPlace',
      dataModelName: 'TestPlace',
      isRunning: true,
    });
    bridge.registerInstance({
      pluginSessionId: 'client-1',
      instanceId: 'place:test',
      role: 'client',
      placeId: 0,
      placeName: 'TestPlace',
      dataModelName: 'TestPlace',
      isRunning: true,
    });

    const resultPromise = tools.stopPlaytest();
    const pending = bridge.getPendingRequest('place:test', 'edit');
    expect(pending).toBeTruthy();
    bridge.resolveRequest(pending!.requestId, { success: true, message: 'stopping' });

    let settled = false;
    void resultPromise.then(() => {
      settled = true;
    }, () => {
      settled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(settled).toBe(false);

    bridge.unregisterInstance('server-1');
    bridge.unregisterInstance('client-1');

    const result = await resultPromise;
    const body = JSON.parse(result.content[0].text);
    expect(body).toMatchObject({
      success: true,
      runtimeStopped: true,
      timedOut: false,
    });
    expect(body.roles).toEqual(['edit']);
  });

  test('stop_playtest is a no-op when no playtest is active', async () => {
    const bridge = new BridgeService();
    const tools = new RobloxStudioTools(bridge);
    bridge.registerInstance(READY);

    const result = await tools.stopPlaytest();

    expect(JSON.parse(result.content[0].text)).toEqual({
      success: true,
      alreadyStopped: true,
      runtimeStopped: true,
      roles: ['edit'],
    });
    expect(bridge.getPendingRequestCount()).toBe(0);
  });

  test('simulate_keyboard_input forwards holdDuration alias through the tool handler', async () => {
    const bridge = new BridgeService();
    const tools = new RobloxStudioTools(bridge);
    bridge.registerInstance(READY);
    bridge.registerInstance({
      pluginSessionId: 'client-1',
      instanceId: 'place:test',
      role: 'client',
      placeId: 0,
      placeName: 'TestPlace',
      dataModelName: 'TestPlace',
      isRunning: true,
    });

    const resultPromise = TOOL_HANDLERS.simulate_keyboard_input(tools, {
      keyCode: 'E',
      action: 'tap',
      holdDuration: 1.2,
      target: 'client-1',
    });

    const pending = bridge.getPendingRequest('place:test', 'client-1');
    expect(pending?.request).toMatchObject({
      endpoint: '/api/simulate-keyboard-input',
      data: { keyCode: 'E', action: 'tap', holdDuration: 1.2 },
    });
    bridge.resolveRequest(pending!.requestId, { success: true, keyCode: 'E', duration: 1.2 });

    const result = await resultPromise;
    expect(JSON.parse(result.content[0].text)).toMatchObject({ success: true, duration: 1.2 });
  });

  test('capture_screenshot reports logical viewport conversion when physical pixels differ', async () => {
    const bridge = new BridgeService();
    const tools = new RobloxStudioTools(bridge);
    bridge.registerInstance(READY);

    const resultPromise = tools.captureScreenshot(
      undefined,
      'png',
      undefined,
      { x: 1, y: 2, z: 3 },
      { x: 0, y: 0, z: 0 },
    );
    const pending = bridge.getPendingRequest('place:test', 'edit');
    expect(pending?.request.endpoint).toBe('/api/capture-screenshot');
    expect(pending?.request.data).toEqual({
      cameraPosition: { x: 1, y: 2, z: 3 },
      lookAt: { x: 0, y: 0, z: 0 },
    });
    bridge.resolveRequest(pending!.requestId, {
      success: true,
      width: 150,
      height: 100,
      viewportW: 100,
      viewportH: 80,
      data: Buffer.alloc(150 * 100 * 4).toString('base64'),
    });

    const result = await resultPromise;
    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toContain('Screenshot 150x100px');
    expect(result.content[0].text).toContain('logical viewport 100x80');
    expect(result.content[0].text).toContain('simulate_mouse_input');
    expect(result.content[0].text).toContain('x = imageX / 1.5000');
    expect(result.content[0].text).toContain('y = imageY / 1.2500');
  });

  test('stop_playtest reports stuck teardown when runtime peers do not disconnect', async () => {
    const bridge = new BridgeService();
    const tools = new RobloxStudioTools(bridge);
    bridge.registerInstance(READY);
    bridge.registerInstance({
      pluginSessionId: 'server-1',
      instanceId: 'place:test',
      role: 'server',
      placeId: 0,
      placeName: 'TestPlace',
      dataModelName: 'TestPlace',
      isRunning: true,
    });
    bridge.registerInstance({
      pluginSessionId: 'client-1',
      instanceId: 'place:test',
      role: 'client',
      placeId: 0,
      placeName: 'TestPlace',
      dataModelName: 'TestPlace',
      isRunning: true,
    });
    (tools as any)._waitForRuntimeRoles = async () => ({
      ok: false,
      roles: ['edit', 'server', 'client-1'],
      timedOut: true,
    });

    const resultPromise = tools.stopPlaytest();
    const pending = bridge.getPendingRequest('place:test', 'edit');
    expect(pending).toBeTruthy();
    bridge.resolveRequest(pending!.requestId, { success: true, message: 'Playtest stopped.' });

    const result = await resultPromise;
    const body = JSON.parse(result.content[0].text);
    expect(body).toMatchObject({
      success: false,
      error: 'Playtest teardown did not complete.',
      runtimeStopped: false,
      timedOut: true,
      stopSignalAccepted: true,
      roles: ['edit', 'server', 'client-1'],
      runtimeRoles: ['server', 'client-1'],
    });
    expect(body.message).toContain('did not disconnect');
    expect(body.possibleCause).toContain('BindToClose');
    expect(body.possibleCause).toContain('No runtime hard-stop or synthetic keyboard fallback');
    expect(body.fallbacks).toBeUndefined();
  });

  test('stop_playtest treats EndTest already-called acknowledgement as teardown in progress', async () => {
    const bridge = new BridgeService();
    const tools = new RobloxStudioTools(bridge);
    bridge.registerInstance(READY);
    bridge.registerInstance({
      pluginSessionId: 'server-1',
      instanceId: 'place:test',
      role: 'server',
      placeId: 0,
      placeName: 'TestPlace',
      dataModelName: 'TestPlace',
      isRunning: true,
    });
    (tools as any).runtimeTools._waitForRuntimeRoles = async () => ({
      ok: true,
      roles: ['edit'],
      timedOut: false,
    });

    const resultPromise = tools.stopPlaytest();
    const pending = bridge.getPendingRequest('place:test', 'edit');
    expect(pending).toBeTruthy();
    bridge.resolveRequest(pending!.requestId, {
      success: true,
      alreadyEnded: true,
      message: 'StudioTestService:EndTest was already issued; teardown is in progress.',
    });

    const result = await resultPromise;
    const body = JSON.parse(result.content[0].text);
    expect(body).toMatchObject({
      success: true,
      alreadyEnded: true,
      runtimeStopped: true,
      timedOut: false,
      roles: ['edit'],
    });
  });

  test('multiplayer_test_end treats EndTest already-called as already ended', async () => {
    const bridge = new BridgeService();
    const tools = new RobloxStudioTools(bridge);
    bridge.registerInstance(READY);
    bridge.registerInstance({
      pluginSessionId: 'server-1',
      instanceId: 'place:test',
      role: 'server',
      placeId: 0,
      placeName: 'TestPlace',
      dataModelName: 'TestPlace',
      isRunning: true,
    });
    (tools as any).runtimeTools._waitForMultiplayerEditDone = async () => true;
    (tools as any).runtimeTools._waitForRuntimeRoles = async () => ({
      ok: true,
      roles: ['edit'],
      timedOut: false,
    });
    (tools as any).runtimeTools._buildMultiplayerState = async () => ({
      instanceId: 'place:test',
      phase: 'idle',
    });

    const resultPromise = tools.multiplayerTestEnd(undefined, 5);
    const pending = bridge.getPendingRequest('place:test', 'server');
    expect(pending).toBeTruthy();
    bridge.resolveRequest(pending!.requestId, {
      error: 'EndTest can only be called once',
    });

    const result = await resultPromise;
    const body = JSON.parse(result.content[0].text);
    expect(body).toMatchObject({
      success: true,
      alreadyEnded: true,
      ended: true,
      editDone: true,
      timedOut: false,
      roles: ['edit'],
      state: { instanceId: 'place:test', phase: 'idle' },
    });
  });

  test('stop_playtest reports edit request failure when runtime peers remain', async () => {
    const bridge = new BridgeService();
    const tools = new RobloxStudioTools(bridge);
    bridge.registerInstance(READY);
    bridge.registerInstance({
      pluginSessionId: 'server-1',
      instanceId: 'place:test',
      role: 'server',
      placeId: 0,
      placeName: 'TestPlace',
      dataModelName: 'TestPlace',
      isRunning: true,
    });

    const resultPromise = tools.stopPlaytest();
    const pending = bridge.getPendingRequest('place:test', 'edit');
    expect(pending).toBeTruthy();
    bridge.rejectRequest(pending!.requestId, new Error('edit peer timed out'));

    const result = await resultPromise;
    const body = JSON.parse(result.content[0].text);
    expect(body).toMatchObject({
      success: false,
      error: 'Playtest teardown did not complete.',
      message: 'Edit stop request failed, and runtime peers are still connected.',
      runtimeStopped: false,
      timedOut: false,
      roles: ['edit', 'server'],
      stopSignalAccepted: false,
      runtimeRoles: ['server'],
    });
    expect(body.detail).toContain('edit peer timed out');
    expect(body.stopRequestError).toContain('edit peer timed out');
    expect(body.fallbacks).toBeUndefined();
  });

  test('stop_playtest accepts stale anon id after publish and waits for runtime peers', async () => {
    const bridge = new BridgeService();
    const tools = new RobloxStudioTools(bridge);
    bridge.registerInstance({
      ...READY,
      pluginSessionId: 'edit-stale',
      instanceId: 'anon:old-file-id',
      placeId: 0,
    });
    bridge.updateInstanceMetadata('edit-stale', { placeId: 12345 });
    bridge.registerInstance({
      pluginSessionId: 'server-1',
      instanceId: 'place:12345',
      role: 'server',
      placeId: 12345,
      placeName: 'TestPlace',
      dataModelName: 'TestPlace',
      isRunning: true,
    });
    bridge.registerInstance({
      pluginSessionId: 'client-1',
      instanceId: 'place:12345',
      role: 'client',
      placeId: 12345,
      placeName: 'TestPlace',
      dataModelName: 'TestPlace',
      isRunning: true,
    });

    const resultPromise = tools.stopPlaytest('anon:old-file-id');
    const pending = bridge.getPendingRequest('place:12345', 'edit');
    expect(pending).toBeTruthy();
    bridge.resolveRequest(pending!.requestId, { success: true, message: 'stopping' });

    let settled = false;
    void resultPromise.then(() => {
      settled = true;
    }, () => {
      settled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(settled).toBe(false);

    bridge.unregisterInstance('server-1');
    bridge.unregisterInstance('client-1');

    const result = await resultPromise;
    const body = JSON.parse(result.content[0].text);
    expect(body).toMatchObject({
      success: true,
      runtimeStopped: true,
      timedOut: false,
    });
    expect(body.roles).toEqual(['edit']);
  });

  test('get_scene_analysis fans out to connected peers', async () => {
    const bridge = new BridgeService();
    const tools = new RobloxStudioTools(bridge);
    bridge.registerInstance(READY);
    bridge.registerInstance({
      pluginSessionId: 'server-1',
      instanceId: 'place:test',
      role: 'server',
      placeId: 0,
      placeName: 'TestPlace',
      dataModelName: 'TestPlace',
      isRunning: true,
    });

    const resultPromise = tools.getSceneAnalysis('script_memory', 'all', 5, false, 'place:test');
    const editPending = bridge.getPendingRequest('place:test', 'edit');
    const serverPending = bridge.getPendingRequest('place:test', 'server');
    expect(editPending?.request).toMatchObject({
      endpoint: '/api/get-scene-analysis',
      data: { mode: 'script_memory', topN: 5, raw: false },
    });
    expect(serverPending?.request).toMatchObject({
      endpoint: '/api/get-scene-analysis',
      data: { mode: 'script_memory', topN: 5, raw: false },
    });

    bridge.resolveRequest(editPending!.requestId, { mode: 'script_memory', peer: 'edit' });
    bridge.resolveRequest(serverPending!.requestId, { mode: 'script_memory', peer: 'server' });

    const result = await resultPromise;
    const body = JSON.parse(result.content[0].text);
    expect(body).toEqual({
      edit: { mode: 'script_memory', peer: 'edit' },
      server: { mode: 'script_memory', peer: 'server' },
    });
  });

  test('set_network_profile fans out to connected clients only', async () => {
    const bridge = new BridgeService();
    const tools = new RobloxStudioTools(bridge);
    bridge.registerInstance(READY);
    bridge.registerInstance({
      pluginSessionId: 'server-1',
      instanceId: 'place:test',
      role: 'server',
      placeId: 0,
      placeName: 'TestPlace',
      dataModelName: 'TestPlace',
      isRunning: true,
    });
    bridge.registerInstance({
      pluginSessionId: 'client-1',
      instanceId: 'place:test',
      role: 'client',
      placeId: 0,
      placeName: 'TestPlace',
      dataModelName: 'TestPlace',
      isRunning: true,
    });
    bridge.registerInstance({
      pluginSessionId: 'client-2',
      instanceId: 'place:test',
      role: 'client',
      placeId: 0,
      placeName: 'TestPlace',
      dataModelName: 'TestPlace',
      isRunning: true,
    });

    const resultPromise = tools.setNetworkProfile('good', 'all-clients', undefined, 'place:test');
    const editPending = bridge.getPendingRequest('place:test', 'edit');
    const serverPending = bridge.getPendingRequest('place:test', 'server');
    const client1Pending = bridge.getPendingRequest('place:test', 'client-1');
    const client2Pending = bridge.getPendingRequest('place:test', 'client-2');

    expect(editPending).toBeNull();
    expect(serverPending).toBeNull();
    expect(client1Pending?.request).toMatchObject({ endpoint: '/api/execute-luau' });
    expect(client2Pending?.request).toMatchObject({ endpoint: '/api/execute-luau' });
    expect(client1Pending?.request.data.code).toContain('NetworkSettings');
    expect(client1Pending?.request.data.code).toContain('InboundNetworkMinDelayMs');
    expect(client1Pending?.request.data.code).toContain('50');
    expect(client1Pending?.request.data.code).toContain('10');

    bridge.resolveRequest(client1Pending!.requestId, {
      success: true,
      returnValue: JSON.stringify({
        profile: 'good',
        applied: { InboundNetworkMinDelayMs: 50 },
        after: { InboundNetworkMinDelayMs: 50 },
      }),
    });
    bridge.resolveRequest(client2Pending!.requestId, {
      success: true,
      returnValue: JSON.stringify({
        profile: 'good',
        applied: { InboundNetworkMinDelayMs: 50 },
        after: { InboundNetworkMinDelayMs: 50 },
      }),
    });

    const result = await resultPromise;
    const body = JSON.parse(result.content[0].text);
    expect(body).toMatchObject({
      profile: 'good',
      target: 'all-clients',
      applied: {
        InboundNetworkMinDelayMs: 50,
        OutboundNetworkMinDelayMs: 50,
        InboundNetworkJitterMs: 10,
        OutboundNetworkJitterMs: 10,
        InboundNetworkLossPercent: 0,
        OutboundNetworkLossPercent: 0,
      },
      targets: {
        'client-1': { profile: 'good', after: { InboundNetworkMinDelayMs: 50 } },
        'client-2': { profile: 'good', after: { InboundNetworkMinDelayMs: 50 } },
      },
    });
  });

  test('set_network_profile rejects non-client targets', async () => {
    const bridge = new BridgeService();
    const tools = new RobloxStudioTools(bridge);
    bridge.registerInstance(READY);

    await expect(tools.setNetworkProfile('good', 'server', undefined, 'place:test')).rejects.toThrow(/client-N|all-clients/);
  });

  test('set_network_profile rejects the tool call when any fanout target fails', async () => {
    const bridge = new BridgeService();
    const tools = new RobloxStudioTools(bridge);
    bridge.registerInstance(READY);
    bridge.registerInstance({
      pluginSessionId: 'client-1',
      instanceId: 'place:test',
      role: 'client',
      placeId: 0,
      placeName: 'TestPlace',
      dataModelName: 'TestPlace',
      isRunning: true,
    });
    bridge.registerInstance({
      pluginSessionId: 'client-2',
      instanceId: 'place:test',
      role: 'client',
      placeId: 0,
      placeName: 'TestPlace',
      dataModelName: 'TestPlace',
      isRunning: true,
    });

    const resultPromise = tools.setNetworkProfile('good', 'all-clients', undefined, 'place:test');
    const client1Pending = bridge.getPendingRequest('place:test', 'client-1');
    const client2Pending = bridge.getPendingRequest('place:test', 'client-2');
    bridge.resolveRequest(client1Pending!.requestId, {
      success: true,
      returnValue: JSON.stringify({
        profile: 'good',
        applied: { InboundNetworkMinDelayMs: 50 },
        after: { InboundNetworkMinDelayMs: 50 },
      }),
    });
    bridge.rejectRequest(client2Pending!.requestId, new Error('client-2 disconnected'));

    await expect(resultPromise).rejects.toThrow(/set_network_profile failed.*client-2.*disconnected/);
  });

  test('set_network_profile rejects packet loss above Roblox engine limit', async () => {
    const bridge = new BridgeService();
    const tools = new RobloxStudioTools(bridge);

    await expect(tools.setNetworkProfile('custom', 'client-1', {
      InboundNetworkLossPercent: 0.5001,
    })).rejects.toThrow(/Roblox engine limits packet loss simulation to 0\.5%/);

    await expect(tools.setNetworkProfile('custom', 'client-1', {
      OutboundNetworkLossPercent: 1,
    })).rejects.toThrow(/Roblox engine limits packet loss simulation to 0\.5%/);
  });

  test('set_network_profile rejects negative network overrides', async () => {
    const bridge = new BridgeService();
    const tools = new RobloxStudioTools(bridge);

    await expect(tools.setNetworkProfile('custom', 'client-1', {
      InboundNetworkMinDelayMs: -1,
    })).rejects.toThrow(/InboundNetworkMinDelayMs.*greater than or equal to 0/);

    await expect(tools.setNetworkProfile('custom', 'client-1', {
      OutboundNetworkJitterMs: -0.1,
    })).rejects.toThrow(/OutboundNetworkJitterMs.*greater than or equal to 0/);

    await expect(tools.setNetworkProfile('custom', 'client-1', {
      InboundNetworkLossPercent: -0.1,
    })).rejects.toThrow(/InboundNetworkLossPercent.*greater than or equal to 0/);
  });

  test('set_network_profile allows packet loss at Roblox engine limit', async () => {
    const bridge = new BridgeService();
    const tools = new RobloxStudioTools(bridge);
    bridge.registerInstance(READY);
    bridge.registerInstance({
      pluginSessionId: 'client-1',
      instanceId: 'place:test',
      role: 'client',
      placeId: 0,
      placeName: 'TestPlace',
      dataModelName: 'TestPlace',
      isRunning: true,
    });

    const resultPromise = tools.setNetworkProfile('custom', 'client-1', {
      InboundNetworkLossPercent: 0.5,
    }, 'place:test');
    const pending = bridge.getPendingRequest('place:test', 'client-1');
    expect(pending?.request).toMatchObject({ endpoint: '/api/execute-luau' });
    expect(pending?.request.data.code).toContain('\\"InboundNetworkLossPercent\\":0.5');
    bridge.resolveRequest(pending!.requestId, {
      success: true,
      returnValue: JSON.stringify({
        profile: 'custom',
        applied: { InboundNetworkLossPercent: 0.5 },
        after: { InboundNetworkLossPercent: 0.5 },
      }),
    });

    const result = await resultPromise;
    const body = JSON.parse(result.content[0].text);
    expect(body.targets['client-1']).toMatchObject({
      applied: { InboundNetworkLossPercent: 0.5 },
      after: { InboundNetworkLossPercent: 0.5 },
    });
  });

  test('get_simulation_state reads edit and connected clients while skipping server', async () => {
    const bridge = new BridgeService();
    const tools = new RobloxStudioTools(bridge);
    bridge.registerInstance(READY);
    bridge.registerInstance({
      pluginSessionId: 'server-1',
      instanceId: 'place:test',
      role: 'server',
      placeId: 0,
      placeName: 'TestPlace',
      dataModelName: 'TestPlace',
      isRunning: true,
    });
    bridge.registerInstance({
      pluginSessionId: 'client-1',
      instanceId: 'place:test',
      role: 'client',
      placeId: 0,
      placeName: 'TestPlace',
      dataModelName: 'TestPlace',
      isRunning: true,
    });

    const resultPromise = tools.getSimulationState('both', 'edit-and-clients', 'place:test');
    const editNetworkPending = bridge.getPendingRequest('place:test', 'edit');
    const clientNetworkPending = bridge.getPendingRequest('place:test', 'client-1');
    const serverPending = bridge.getPendingRequest('place:test', 'server');
    expect(serverPending).toBeNull();
    expect(editNetworkPending?.request).toMatchObject({ endpoint: '/api/execute-luau' });
    expect(clientNetworkPending?.request).toMatchObject({ endpoint: '/api/execute-luau' });
    expect(editNetworkPending?.request.data.code).toContain('NetworkSettings');
    expect(clientNetworkPending?.request.data.code).toContain('NetworkSettings');

    bridge.resolveRequest(editNetworkPending!.requestId, {
      success: true,
      returnValue: JSON.stringify({ success: true, state: ZERO_NETWORK_STATE }),
    });
    bridge.resolveRequest(clientNetworkPending!.requestId, {
      success: true,
      returnValue: JSON.stringify({ success: true, state: DIRTY_NETWORK_STATE }),
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    const editDevicePending = bridge.getPendingRequest('place:test', 'edit');
    const clientDevicePending = bridge.getPendingRequest('place:test', 'client-1');
    expect(editDevicePending?.request).toMatchObject({ endpoint: '/api/execute-luau' });
    expect(clientDevicePending?.request).toMatchObject({ endpoint: '/api/execute-luau' });
    expect(editDevicePending?.request.data.code).toContain('StudioDeviceSimulatorService');
    expect(clientDevicePending?.request.data.code).toContain('StudioDeviceSimulatorService');

    bridge.resolveRequest(editDevicePending!.requestId, {
      success: true,
      returnValue: JSON.stringify({ activeDeviceId: 'default', isSimulating: false }),
    });
    bridge.resolveRequest(clientDevicePending!.requestId, {
      success: true,
      returnValue: JSON.stringify({ activeDeviceId: 'iphone_XR', isSimulating: true, orientation: 'LandscapeRight' }),
    });

    const result = await resultPromise;
    const body = JSON.parse(result.content[0].text);
    expect(body).toMatchObject({
      include: 'both',
      target: 'edit-and-clients',
      roles: {
        edit: {
          network: { success: true, state: ZERO_NETWORK_STATE },
          deviceSimulator: { activeDeviceId: 'default', isSimulating: false },
        },
        'client-1': {
          network: { success: true, state: DIRTY_NETWORK_STATE },
          deviceSimulator: { activeDeviceId: 'iphone_XR', isSimulating: true },
        },
      },
      warnings: [],
    });
    expect(body.roles.server).toBeUndefined();
    expect(body.persistenceNotes).toEqual(expect.arrayContaining([
      expect.stringContaining('Normal Play'),
      expect.stringContaining('StudioTestService'),
    ]));
  });

  test('get_simulation_state respects network-only and device-only includes', async () => {
    const bridge = new BridgeService();
    const tools = new RobloxStudioTools(bridge);
    bridge.registerInstance(READY);

    const networkOnlyPromise = tools.getSimulationState('network', 'edit', 'place:test');
    const networkPending = bridge.getPendingRequest('place:test', 'edit');
    expect(networkPending?.request).toMatchObject({ endpoint: '/api/execute-luau' });
    expect(networkPending?.request.data.code).toContain('NetworkSettings');
    expect(networkPending?.request.data.code).not.toContain('StudioDeviceSimulatorService');
    bridge.resolveRequest(networkPending!.requestId, {
      success: true,
      returnValue: JSON.stringify({ success: true, state: ZERO_NETWORK_STATE }),
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(bridge.getPendingRequest('place:test', 'edit')).toBeNull();
    const networkOnly = JSON.parse((await networkOnlyPromise).content[0].text);
    expect(networkOnly).toMatchObject({
      include: 'network',
      roles: { edit: { network: { state: ZERO_NETWORK_STATE } } },
    });
    expect(networkOnly.roles.edit.deviceSimulator).toBeUndefined();

    const deviceOnlyPromise = tools.getSimulationState('deviceSimulator', 'edit', 'place:test');
    const devicePending = bridge.getPendingRequest('place:test', 'edit');
    expect(devicePending?.request).toMatchObject({ endpoint: '/api/execute-luau' });
    expect(devicePending?.request.data.code).toContain('StudioDeviceSimulatorService');
    expect(devicePending?.request.data.code).not.toContain('NetworkSettings');
    bridge.resolveRequest(devicePending!.requestId, {
      success: true,
      returnValue: JSON.stringify({ activeDeviceId: 'default', isSimulating: false }),
    });

    const deviceOnly = JSON.parse((await deviceOnlyPromise).content[0].text);
    expect(deviceOnly).toMatchObject({
      include: 'deviceSimulator',
      roles: { edit: { deviceSimulator: { activeDeviceId: 'default', isSimulating: false } } },
    });
    expect(deviceOnly.roles.edit.network).toBeUndefined();
  });

  test('reset_simulation_state resets network and device state for edit and clients only', async () => {
    const bridge = new BridgeService();
    const tools = new RobloxStudioTools(bridge);
    bridge.registerInstance(READY);
    bridge.registerInstance({
      pluginSessionId: 'server-1',
      instanceId: 'place:test',
      role: 'server',
      placeId: 0,
      placeName: 'TestPlace',
      dataModelName: 'TestPlace',
      isRunning: true,
    });
    bridge.registerInstance({
      pluginSessionId: 'client-1',
      instanceId: 'place:test',
      role: 'client',
      placeId: 0,
      placeName: 'TestPlace',
      dataModelName: 'TestPlace',
      isRunning: true,
    });

    const resultPromise = tools.resetSimulationState(undefined, undefined, undefined, 'place:test');
    const editNetworkPending = bridge.getPendingRequest('place:test', 'edit');
    const clientNetworkPending = bridge.getPendingRequest('place:test', 'client-1');
    const serverPending = bridge.getPendingRequest('place:test', 'server');
    expect(serverPending).toBeNull();
    expect(editNetworkPending?.request.data.code).toContain('NetworkSettings');
    expect(editNetworkPending?.request.data.code).toContain('ns[key] = value');
    expect(clientNetworkPending?.request.data.code).toContain('NetworkSettings');
    expect(clientNetworkPending?.request.data.code).toContain('ns[key] = value');

    bridge.resolveRequest(editNetworkPending!.requestId, {
      success: true,
      returnValue: JSON.stringify({ success: true, applied: ZERO_NETWORK_STATE, before: DIRTY_NETWORK_STATE, after: ZERO_NETWORK_STATE }),
    });
    bridge.resolveRequest(clientNetworkPending!.requestId, {
      success: true,
      returnValue: JSON.stringify({ success: true, applied: ZERO_NETWORK_STATE, before: DIRTY_NETWORK_STATE, after: ZERO_NETWORK_STATE }),
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    const editDevicePending = bridge.getPendingRequest('place:test', 'edit');
    const clientDevicePending = bridge.getPendingRequest('place:test', 'client-1');
    expect(editDevicePending?.request.data.code).toContain('StopSimulationAsync');
    expect(clientDevicePending?.request.data.code).toContain('StopSimulationAsync');

    bridge.resolveRequest(editDevicePending!.requestId, {
      success: true,
      returnValue: JSON.stringify({
        success: true,
        applied: { stopSimulation: true },
        before: { activeDeviceId: 'iphone_XR', isSimulating: true },
        after: { activeDeviceId: 'default', isSimulating: false },
      }),
    });
    bridge.resolveRequest(clientDevicePending!.requestId, {
      success: true,
      returnValue: JSON.stringify({
        success: true,
        applied: { stopSimulation: true },
        before: { activeDeviceId: 'iphone_XR', isSimulating: true },
        after: { activeDeviceId: 'default', isSimulating: false },
      }),
    });

    const result = await resultPromise;
    const body = JSON.parse(result.content[0].text);
    expect(body).toMatchObject({
      target: 'edit-and-clients',
      network: true,
      deviceSimulator: true,
      roles: {
        edit: {
          network: { after: ZERO_NETWORK_STATE },
          deviceSimulator: { applied: { stopSimulation: true }, after: { activeDeviceId: 'default', isSimulating: false } },
        },
        'client-1': {
          network: { after: ZERO_NETWORK_STATE },
          deviceSimulator: { applied: { stopSimulation: true }, after: { activeDeviceId: 'default', isSimulating: false } },
        },
      },
      warnings: [],
    });
    expect(body.roles.server).toBeUndefined();
  });

  test('reset_simulation_state rejects the tool call when any reset operation fails', async () => {
    const bridge = new BridgeService();
    const tools = new RobloxStudioTools(bridge);
    bridge.registerInstance(READY);

    const resultPromise = tools.resetSimulationState('edit', true, false, 'place:test');
    const pending = bridge.getPendingRequest('place:test', 'edit');
    expect(pending?.request).toMatchObject({ endpoint: '/api/execute-luau' });
    bridge.rejectRequest(pending!.requestId, new Error('network reset boom'));

    await expect(resultPromise).rejects.toThrow(/reset_simulation_state failed.*edit\.network.*network reset boom/);
  });

  test('reset_simulation_state warns but does not fail when all-clients has no clients', async () => {
    const bridge = new BridgeService();
    const tools = new RobloxStudioTools(bridge);
    bridge.registerInstance(READY);

    const result = await tools.resetSimulationState('all-clients', true, false, 'place:test');
    const body = JSON.parse(result.content[0].text);
    expect(body).toMatchObject({
      target: 'all-clients',
      network: true,
      deviceSimulator: false,
      roles: {},
    });
    expect(body.warnings).toEqual([expect.stringContaining('No connected playtest client roles')]);
    expect(bridge.getPendingRequest('place:test', 'edit')).toBeNull();
  });

  test('simulation state tools reject server target and empty reset', async () => {
    const bridge = new BridgeService();
    const tools = new RobloxStudioTools(bridge);
    bridge.registerInstance(READY);

    await expect(tools.getSimulationState('both', 'server', 'place:test')).rejects.toThrow(/edit|client-N|all-clients|edit-and-clients/);
    await expect(tools.resetSimulationState('server', undefined, undefined, 'place:test')).rejects.toThrow(/edit|client-N|all-clients|edit-and-clients/);
    await expect(tools.resetSimulationState('edit', false, false, 'place:test')).rejects.toThrow(/network=true and\/or deviceSimulator=true/);
  });

  test('get_device_simulator_state defaults to the edit peer', async () => {
    const bridge = new BridgeService();
    const tools = new RobloxStudioTools(bridge);
    bridge.registerInstance(READY);

    const resultPromise = tools.getDeviceSimulatorState(undefined, undefined, undefined, 'place:test');
    const pending = bridge.getPendingRequest('place:test', 'edit');
    expect(pending?.request).toMatchObject({ endpoint: '/api/execute-luau' });
    expect(pending?.request.data.code).toContain('StudioDeviceSimulatorService');
    expect(pending?.request.data.code).toContain('GetDeviceAsync');
    expect(pending?.request.data.code).toContain('GetDeviceListAsync');

    bridge.resolveRequest(pending!.requestId, {
      success: true,
      returnValue: JSON.stringify({
        activeDeviceId: 'default',
        isSimulating: false,
        devices: [{ DeviceId: 'iphone_XR' }],
      }),
    });

    const result = await resultPromise;
    const body = JSON.parse(result.content[0].text);
    expect(body).toMatchObject({
      target: 'edit',
      role: 'edit',
      activeDeviceId: 'default',
      isSimulating: false,
      devices: [{ DeviceId: 'iphone_XR' }],
    });
  });

  test('set_device_simulator fans out to connected clients only', async () => {
    const bridge = new BridgeService();
    const tools = new RobloxStudioTools(bridge);
    bridge.registerInstance(READY);
    bridge.registerInstance({
      pluginSessionId: 'server-1',
      instanceId: 'place:test',
      role: 'server',
      placeId: 0,
      placeName: 'TestPlace',
      dataModelName: 'TestPlace',
      isRunning: true,
    });
    bridge.registerInstance({
      pluginSessionId: 'client-1',
      instanceId: 'place:test',
      role: 'client',
      placeId: 0,
      placeName: 'TestPlace',
      dataModelName: 'TestPlace',
      isRunning: true,
    });
    bridge.registerInstance({
      pluginSessionId: 'client-2',
      instanceId: 'place:test',
      role: 'client',
      placeId: 0,
      placeName: 'TestPlace',
      dataModelName: 'TestPlace',
      isRunning: true,
    });

    const resultPromise = tools.setDeviceSimulator('all-clients', 'iphone_XR', 'LandscapeRight', undefined, undefined, undefined, undefined, 'place:test');
    const editPending = bridge.getPendingRequest('place:test', 'edit');
    const serverPending = bridge.getPendingRequest('place:test', 'server');
    const client1Pending = bridge.getPendingRequest('place:test', 'client-1');
    const client2Pending = bridge.getPendingRequest('place:test', 'client-2');

    expect(editPending).toBeNull();
    expect(serverPending).toBeNull();
    expect(client1Pending?.request).toMatchObject({ endpoint: '/api/execute-luau' });
    expect(client2Pending?.request).toMatchObject({ endpoint: '/api/execute-luau' });
    expect(client1Pending?.request.data.code).toContain('StudioDeviceSimulatorService');
    expect(client1Pending?.request.data.code).toContain('SetDeviceAsync');
    expect(client1Pending?.request.data.code).toContain('SetOrientationAsync');

    const payload = {
      success: true,
      applied: { deviceId: 'iphone_XR', orientation: 'LandscapeRight' },
      before: { activeDeviceId: 'default', isSimulating: false },
      after: { activeDeviceId: 'iphone_XR', isSimulating: true },
    };
    bridge.resolveRequest(client1Pending!.requestId, { success: true, returnValue: JSON.stringify(payload) });
    bridge.resolveRequest(client2Pending!.requestId, { success: true, returnValue: JSON.stringify(payload) });

    const result = await resultPromise;
    const body = JSON.parse(result.content[0].text);
    expect(body).toMatchObject({
      target: 'all-clients',
      targets: {
        'client-1': { applied: { deviceId: 'iphone_XR', orientation: 'LandscapeRight' } },
        'client-2': { applied: { deviceId: 'iphone_XR', orientation: 'LandscapeRight' } },
      },
    });
  });

  test('set_device_simulator rejects server target and stopSimulation combinations', async () => {
    const bridge = new BridgeService();
    const tools = new RobloxStudioTools(bridge);
    bridge.registerInstance(READY);

    await expect(tools.setDeviceSimulator('server', 'iphone_XR', undefined, undefined, undefined, undefined, undefined, 'place:test')).rejects.toThrow(/edit|client-N/);
    await expect(tools.setDeviceSimulator('edit', 'iphone_XR', undefined, undefined, undefined, undefined, true, 'place:test')).rejects.toThrow(/stopSimulation=true cannot be combined/);
  });

  test('set_device_simulator rejects the tool call when any fanout target fails', async () => {
    const bridge = new BridgeService();
    const tools = new RobloxStudioTools(bridge);
    bridge.registerInstance(READY);
    bridge.registerInstance({
      pluginSessionId: 'client-1',
      instanceId: 'place:test',
      role: 'client',
      placeId: 0,
      placeName: 'TestPlace',
      dataModelName: 'TestPlace',
      isRunning: true,
    });
    bridge.registerInstance({
      pluginSessionId: 'client-2',
      instanceId: 'place:test',
      role: 'client',
      placeId: 0,
      placeName: 'TestPlace',
      dataModelName: 'TestPlace',
      isRunning: true,
    });

    const resultPromise = tools.setDeviceSimulator('all-clients', 'iphone_XR', undefined, undefined, undefined, undefined, undefined, 'place:test');
    const client1Pending = bridge.getPendingRequest('place:test', 'client-1');
    const client2Pending = bridge.getPendingRequest('place:test', 'client-2');
    bridge.resolveRequest(client1Pending!.requestId, {
      success: true,
      returnValue: JSON.stringify({
        success: true,
        applied: { deviceId: 'iphone_XR' },
        before: { activeDeviceId: 'default', isSimulating: false },
        after: { activeDeviceId: 'iphone_XR', isSimulating: true },
      }),
    });
    bridge.rejectRequest(client2Pending!.requestId, new Error('client-2 simulator failed'));

    await expect(resultPromise).rejects.toThrow(/set_device_simulator failed.*client-2.*simulator failed/);
  });

  test('capture_device_matrix rejects unsupported targets', async () => {
    const bridge = new BridgeService();
    const tools = new RobloxStudioTools(bridge);
    bridge.registerInstance(READY);

    await expect(tools.captureDeviceMatrix([{ deviceId: 'iphone_XR' }], 'server', undefined, undefined, undefined, undefined, 'place:test')).rejects.toThrow(/edit|client-N/);
    await expect(tools.captureDeviceMatrix([{ deviceId: 'iphone_XR' }], 'all-clients', undefined, undefined, undefined, undefined, 'place:test')).rejects.toThrow(/edit|client-N/);
  });

  test('capture_device_matrix rejects active custom device before mutating when restore is enabled', async () => {
    const bridge = new BridgeService();
    const tools = new RobloxStudioTools(bridge);
    bridge.registerInstance(READY);

    const resultPromise = tools.captureDeviceMatrix(
      [{ label: 'phone', deviceId: 'iphone_XR' }],
      'edit',
      'jpeg',
      80,
      0,
      true,
      'place:test',
    );

    const snapshotPending = bridge.getPendingRequest('place:test', 'edit');
    expect(snapshotPending?.request).toMatchObject({ endpoint: '/api/execute-luau' });
    bridge.resolveRequest(snapshotPending!.requestId, {
      success: true,
      returnValue: JSON.stringify({
        activeDeviceId: 'custom_phone',
        isSimulating: true,
        devices: [{ DeviceId: 'iphone_XR', IsCustom: false }],
      }),
    });

    await expect(resultPromise).rejects.toThrow(/cannot safely restore active custom device "custom_phone"/);
    expect(bridge.getPendingRequest('place:test', 'edit')).toBeNull();
  });

  test('capture_device_matrix rejects the tool call when an entry capture fails', async () => {
    const bridge = new BridgeService();
    const tools = new RobloxStudioTools(bridge);
    bridge.registerInstance(READY);

    const resultPromise = tools.captureDeviceMatrix(
      [{ label: 'phone', deviceId: 'iphone_XR' }],
      'edit',
      'jpeg',
      80,
      0,
      true,
      'place:test',
    );

    const snapshotPending = bridge.getPendingRequest('place:test', 'edit');
    bridge.resolveRequest(snapshotPending!.requestId, {
      success: true,
      returnValue: JSON.stringify({ activeDeviceId: 'default', isSimulating: false, devices: [] }),
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    const setPending = bridge.getPendingRequest('place:test', 'edit');
    bridge.resolveRequest(setPending!.requestId, {
      success: true,
      returnValue: JSON.stringify({
        success: true,
        applied: { deviceId: 'iphone_XR' },
        before: { activeDeviceId: 'default', isSimulating: false },
        after: { activeDeviceId: 'iphone_XR', isSimulating: true },
      }),
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    const capturePending = bridge.getPendingRequest('place:test', 'edit');
    expect(capturePending?.request).toMatchObject({ endpoint: '/api/capture-screenshot' });
    bridge.resolveRequest(capturePending!.requestId, { error: 'screenshot boom' });

    await new Promise((resolve) => setTimeout(resolve, 0));
    const restorePending = bridge.getPendingRequest('place:test', 'edit');
    expect(restorePending?.request.data.code).toContain('StopSimulationAsync');
    bridge.resolveRequest(restorePending!.requestId, {
      success: true,
      returnValue: JSON.stringify({
        success: true,
        applied: { stopSimulation: true },
        before: { activeDeviceId: 'iphone_XR', isSimulating: true },
        after: { activeDeviceId: 'default', isSimulating: false },
      }),
    });

    await expect(resultPromise).rejects.toThrow(/capture_device_matrix failed.*phone.*screenshot boom/);
  });

  test('capture_device_matrix rejects the tool call when restore fails', async () => {
    const bridge = new BridgeService();
    const tools = new RobloxStudioTools(bridge);
    bridge.registerInstance(READY);

    const resultPromise = tools.captureDeviceMatrix(
      [{ label: 'phone', deviceId: 'iphone_XR' }],
      'edit',
      'jpeg',
      80,
      0,
      true,
      'place:test',
    );

    const snapshotPending = bridge.getPendingRequest('place:test', 'edit');
    bridge.resolveRequest(snapshotPending!.requestId, {
      success: true,
      returnValue: JSON.stringify({ activeDeviceId: 'default', isSimulating: false, devices: [] }),
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    const setPending = bridge.getPendingRequest('place:test', 'edit');
    bridge.resolveRequest(setPending!.requestId, {
      success: true,
      returnValue: JSON.stringify({
        success: true,
        applied: { deviceId: 'iphone_XR' },
        before: { activeDeviceId: 'default', isSimulating: false },
        after: { activeDeviceId: 'iphone_XR', isSimulating: true },
      }),
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    const capturePending = bridge.getPendingRequest('place:test', 'edit');
    bridge.resolveRequest(capturePending!.requestId, {
      width: 1,
      height: 1,
      data: Buffer.from([0, 0, 0, 255]).toString('base64'),
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    const restorePending = bridge.getPendingRequest('place:test', 'edit');
    expect(restorePending?.request.data.code).toContain('StopSimulationAsync');
    bridge.rejectRequest(restorePending!.requestId, new Error('restore boom'));

    await expect(resultPromise).rejects.toThrow(/capture_device_matrix failed.*restore.*restore boom/);
  });

  test('capture_device_matrix captures entries and restores prior state', async () => {
    const bridge = new BridgeService();
    const tools = new RobloxStudioTools(bridge);
    bridge.registerInstance(READY);

    const resultPromise = tools.captureDeviceMatrix(
      [{ label: 'phone', deviceId: 'iphone_XR' }],
      'edit',
      'jpeg',
      80,
      0,
      true,
      'place:test',
    );

    const snapshotPending = bridge.getPendingRequest('place:test', 'edit');
    expect(snapshotPending?.request).toMatchObject({ endpoint: '/api/execute-luau' });
    bridge.resolveRequest(snapshotPending!.requestId, {
      success: true,
      returnValue: JSON.stringify({ activeDeviceId: 'default', isSimulating: false }),
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    const setPending = bridge.getPendingRequest('place:test', 'edit');
    expect(setPending?.request).toMatchObject({ endpoint: '/api/execute-luau' });
    expect(setPending?.request.data.code).toContain('SetDeviceAsync');
    bridge.resolveRequest(setPending!.requestId, {
      success: true,
      returnValue: JSON.stringify({
        success: true,
        applied: { deviceId: 'iphone_XR' },
        before: { activeDeviceId: 'default', isSimulating: false },
        after: { activeDeviceId: 'iphone_XR', isSimulating: true },
      }),
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    const capturePending = bridge.getPendingRequest('place:test', 'edit');
    expect(capturePending?.request).toMatchObject({ endpoint: '/api/capture-screenshot' });
    bridge.resolveRequest(capturePending!.requestId, {
      width: 1,
      height: 1,
      data: Buffer.from([0, 0, 0, 255]).toString('base64'),
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    const restorePending = bridge.getPendingRequest('place:test', 'edit');
    expect(restorePending?.request).toMatchObject({ endpoint: '/api/execute-luau' });
    expect(restorePending?.request.data.code).toContain('StopSimulationAsync');
    bridge.resolveRequest(restorePending!.requestId, {
      success: true,
      returnValue: JSON.stringify({
        success: true,
        applied: { stopSimulation: true },
        before: { activeDeviceId: 'iphone_XR', isSimulating: true },
        after: { activeDeviceId: 'default', isSimulating: false },
      }),
    });

    const result = await resultPromise;
    const firstContent = result.content[0];
    if (firstContent.type !== 'text') throw new Error('Expected matrix summary text first');
    const summary = JSON.parse(firstContent.text);
    expect(summary).toMatchObject({
      target: 'edit',
      role: 'edit',
      restoreAfter: true,
      entries: [{ label: 'phone', screenshot: { width: 1, height: 1, format: 'jpeg', quality: 80 } }],
      restore: { applied: { stopSimulation: true } },
    });
    expect(result.content.some((item) => item.type === 'image')).toBe(true);
  });
});
