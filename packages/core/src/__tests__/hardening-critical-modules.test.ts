import { runBuildExecutor } from '../tools/build-executor.js';
import { MutationTools } from '../tools/mutation-tools.js';
import {
  buildStudioLaunchArgs,
  StudioInstanceManager,
  type ManagedStudioInstance,
} from '../studio-instance-manager.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('build executor hardening', () => {
  const palette = { stone: ['Medium stone grey', 'Concrete'] as [string, string] };

  test('computes deterministic output and bounds', () => {
    const first = runBuildExecutor('part(rng(), 2, 3, 4, 6, 8, "stone")', palette, 123);
    const second = runBuildExecutor('part(rng(), 2, 3, 4, 6, 8, "stone")', palette, 123);
    expect(first).toEqual(second);
    expect(first.partCount).toBe(1);
    expect(first.bounds).toEqual([4.6, 10, 14]);
  });

  test.each([
    ['part(0, 0, 0, 1, 1, 1, "missing")', /palette key/],
    ['part(0, 0, 0, 1, 1, 1, "stone", "Triangle")', /invalid shape/],
    ['part(NaN, 0, 0, 1, 1, 1, "stone")', /finite number/],
    ['', /produced no parts/],
  ])('rejects invalid generator input', (code, expected) => {
    expect(() => runBuildExecutor(code, palette)).toThrow(expected);
  });

  test('enforces the part ceiling before adding another part', () => {
    expect(() => runBuildExecutor(
      'part(0,0,0,1,1,1,"stone"); part(1,0,0,1,1,1,"stone")',
      palette,
      1,
      { maxParts: 1 },
    )).toThrow(/Part limit exceeded/);
  });
});

describe('studio instance lifecycle guards', () => {
  let registryDir: string;

  beforeEach(() => {
    registryDir = mkdtempSync(join(tmpdir(), 'bloxforge-studio-manager-test-'));
  });

  afterEach(() => {
    rmSync(registryDir, { recursive: true, force: true });
  });

  test('validates source-specific launch arguments', () => {
    expect(buildStudioLaunchArgs({
      source: 'published_place',
      placeId: 10,
      universeId: 20,
    })).toEqual(['--task', 'EditPlace', '--placeId', '10', '--universeId', '20']);
    expect(() => buildStudioLaunchArgs({ source: 'local_file' })).toThrow(/local_place_file/);
    expect(() => buildStudioLaunchArgs({ source: 'place_revision', placeId: 1, universeId: 2 })).toThrow(/place_version/);
  });

  test('refuses to stop a PID whose process identity does not match Studio', () => {
    const stopProcess = jest.fn();
    const manager = new StudioInstanceManager({
      registryDir,
      processAdapter: {
        listStudioProcesses: () => [{ Id: 42, Name: 'unrelated-process', Path: '/bin/unrelated' }],
        stopProcess,
        currentBootId: () => 'boot',
      },
    });
    const record: ManagedStudioInstance = {
      source: 'local_file',
      nativeProcessId: 42,
      exe: '/Applications/RobloxStudioBeta',
      args: [],
      launchedAt: Date.now(),
      bootId: 'boot',
    };
    expect(() => manager.close(record)).toThrow(/identity could not be verified/);
    expect(stopProcess).not.toHaveBeenCalled();
  });

  test('stops a verified Studio process exactly once', () => {
    const stopProcess = jest.fn();
    const manager = new StudioInstanceManager({
      registryDir,
      processAdapter: {
        listStudioProcesses: () => [{
          Id: 42,
          Name: 'RobloxStudioBeta',
          Path: '/Applications/RobloxStudioBeta',
        }],
        stopProcess,
        currentBootId: () => 'boot',
      },
    });
    const record: ManagedStudioInstance = {
      source: 'local_file',
      instanceId: 'place:1',
      nativeProcessId: 42,
      exe: '/Applications/RobloxStudioBeta',
      args: [],
      launchedAt: Date.now(),
      bootId: 'boot',
    };
    expect(manager.close(record)).toEqual({ status: 'closed', instanceId: 'place:1' });
    expect(stopProcess).toHaveBeenCalledWith(42);
  });
});

describe('mutation safety gates', () => {
  function runtime(gateResult: { content: Array<{ type: 'text'; text: string }> } | null = null) {
    return {
      callSingle: jest.fn(async () => ({ ok: true })),
      safetyGate: jest.fn(() => gateResult),
      recordOperation: jest.fn(),
      isProtectedPath: jest.fn((_path: string) => false),
    };
  }

  test('does not dispatch a destructive operation when the safety gate blocks it', async () => {
    const blocked = { content: [{ type: 'text' as const, text: 'confirmation required' }] };
    const adapter = runtime(blocked);
    const result = await new MutationTools(adapter).deleteObject('Workspace.Target');
    expect(result).toBe(blocked);
    expect(adapter.callSingle).not.toHaveBeenCalled();
    expect(adapter.recordOperation).not.toHaveBeenCalled();
  });

  test('validates plan and mutation arguments before dispatch', async () => {
    const adapter = runtime();
    const tools = new MutationTools(adapter);
    await expect(tools.applyMutationPlan([])).rejects.toThrow(/non-empty array/);
    await expect(tools.massCreateObjects([])).rejects.toThrow(/Objects array/);
    await expect(tools.massDeleteObjects([])).rejects.toThrow(/Paths array/);
    await expect(tools.setProperty('', 'Name', 'x')).rejects.toThrow(/required/);
    expect(adapter.callSingle).not.toHaveBeenCalled();
  });

  test('mass delete gates on a protected path anywhere in the batch', async () => {
    // assess() takes a single path, so passing paths[0] blindly would let a
    // batch ending in ServerScriptService through the protected-path check.
    const adapter = runtime();
    adapter.isProtectedPath = jest.fn((p: string) => p === 'game.ServerScriptService');
    await new MutationTools(adapter).massDeleteObjects([
      'game.Workspace.A',
      'game.Workspace.B',
      'game.ServerScriptService',
    ]);
    expect(adapter.safetyGate).toHaveBeenCalledWith(
      'bulk_delete',
      expect.stringContaining('3 objects'),
      { count: 3, path: 'game.ServerScriptService' },
      undefined,
    );
  });

  test('mass delete does not dispatch when the gate blocks it', async () => {
    const blocked = { content: [{ type: 'text' as const, text: 'confirmation required' }] };
    const adapter = runtime(blocked);
    const result = await new MutationTools(adapter).massDeleteObjects(['game.Workspace.A']);
    expect(result).toBe(blocked);
    expect(adapter.callSingle).not.toHaveBeenCalled();
    expect(adapter.recordOperation).not.toHaveBeenCalled();
  });
});
