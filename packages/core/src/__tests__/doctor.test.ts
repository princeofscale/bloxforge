import * as os from 'os';
import { checkNodeVersion, collectDoctorChecks, formatDoctorReport, generateDiagnosticReport, DoctorCheck } from '../doctor.js';

describe('checkNodeVersion', () => {
  it('passes for Node 18 and above', () => {
    expect(checkNodeVersion('v18.0.0').status).toBe('ok');
    expect(checkNodeVersion('v20.11.1').status).toBe('ok');
  });
  it('fails for Node below 18', () => {
    const check = checkNodeVersion('v16.20.0');
    expect(check.status).toBe('fail');
    expect(check.detail).toMatch(/18/);
  });
});

describe('formatDoctorReport', () => {
  it('renders a status symbol for each check and an overall summary', () => {
    const checks: DoctorCheck[] = [
      { name: 'Node version', status: 'ok', detail: 'v20.0.0' },
      { name: 'Plugin installed', status: 'warn', detail: 'not found' },
      { name: 'Studio reachable', status: 'fail', detail: 'no response' },
    ];
    const report = formatDoctorReport(checks);
    expect(report).toContain('Node version');
    expect(report).toContain('Plugin installed');
    expect(report).toContain('Studio reachable');
    // Overall worst-status summary should reflect the failure.
    expect(report).toMatch(/fail|problem|FAIL/i);
  });

  it('reports all-clear when every check is ok', () => {
    const report = formatDoctorReport([{ name: 'X', status: 'ok', detail: 'fine' }]);
    expect(report).toMatch(/ok|pass|all/i);
  });
});

describe('collectDoctorChecks', () => {
  it('reports lazy mode, plugin version, protocol version, and mismatches from health', async () => {
    const checks = await collectDoctorChecks({
      version: '2.20.2',
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({
          pluginConnected: true,
          instanceCount: 1,
          lazyTools: true,
          activeToolCount: 9,
          loadedToolsets: ['core'],
          serverVersion: '2.20.2',
          protocolVersion: 1,
          versionMismatch: true,
          protocolMismatch: true,
          instances: [{
            pluginVersion: '2.20.1',
            pluginVariant: 'main',
            pluginProtocolVersion: 0,
            serverProtocolVersion: 1,
            versionMismatch: true,
            protocolMismatch: true,
          }],
        }),
      } as Response),
    });

    expect(checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Lazy tool loading', status: 'ok', detail: expect.stringContaining('default path') }),
      expect.objectContaining({ name: 'Studio plugin version', status: 'warn', detail: expect.stringContaining('2.20.1') }),
      expect.objectContaining({ name: 'Protocol version', status: 'warn', detail: expect.stringContaining('0') }),
    ]));
  });

  it('reports details from the instance that actually mismatches', async () => {
    const checks = await collectDoctorChecks({
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({
          pluginConnected: true,
          versionMismatch: true,
          protocolMismatch: true,
          instances: [
            { pluginVersion: '3.0.0', pluginProtocolVersion: 1 },
            { pluginVersion: '2.20.2', pluginProtocolVersion: 0, versionMismatch: true, protocolMismatch: true },
          ],
        }),
      } as Response),
    });

    expect(checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Studio plugin version', detail: expect.stringContaining('2.20.2') }),
      expect.objectContaining({ name: 'Protocol version', detail: expect.stringContaining('plugin protocol 0') }),
    ]));
  });

  it('passes a bounded abort signal to an injected health fetch', async () => {
    const fetchImpl = jest.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return { ok: false, status: 503 } as Response;
    }) as unknown as typeof fetch;

    await collectDoctorChecks({ fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('generateDiagnosticReport', () => {
  it('includes live session failures and per-tool statistics without exposing the home path', async () => {
    const fetchImpl = async () => ({
      ok: true,
      json: async () => ({
        pluginConnected: false,
        session: {
          totalCalls: 3,
          failures: 1,
          byTool: [{ toolName: 'execute_luau', calls: 3, failures: 1, averageDurationMs: 12.6 }],
        },
      }),
    } as Response);

    const report = await generateDiagnosticReport({ version: '3.0.0-rc.1', fetchImpl });
    expect(report).toContain('Failed Calls: 1');
    expect(report).toContain('execute_luau: 3 calls, 1 failures, avg 13ms');
    expect(report).not.toContain(os.homedir());
  });

  it('reports when the server is down', async () => {
    const report = await generateDiagnosticReport({
      fetchImpl: async () => { throw new Error('connection refused'); },
    });

    expect(report).toContain('MCP server is not currently running on this port.');
  });
});
