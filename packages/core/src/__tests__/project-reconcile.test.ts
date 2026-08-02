import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { RojoTools } from '../rojo/rojo-tools.js';
import type { RokitTools } from '../toolchain/rokit-tools.js';
import type { WallyTools } from '../toolchain/wally-tools.js';
import { DEFAULT_POLICY, ProjectReconciler, loadPolicy } from '../toolchain/project-reconcile.js';

const collectProjectChecks = jest.fn();
jest.mock('../doctor.js', () => ({
  collectProjectChecks: (...args: unknown[]) => collectProjectChecks(...args),
}));

/**
 * The reconciler owns the *order*, so the tests drive it against recording
 * stand-ins for the three tool classes rather than real Rokit, Wally and Rojo
 * CLIs. Each stand-in mutates the same fixture state its real counterpart would,
 * which is what makes "re-read after every mutation" observable.
 */
class Fixture {
  readonly root: string;
  toolchainHealthy = false;
  packagesInstalled = false;
  lockOk = true;
  lockPresent = true;
  serveStatus: 'running' | 'stopped' | 'exited' = 'stopped';
  installFails = false;
  readonly calls: string[] = [];

  constructor() {
    this.root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bloxforge-reconcile-')));
    fs.writeFileSync(path.join(this.root, 'rokit.toml'), '[tools]\nrojo = "rojo-rbx/rojo@7.7.0"\n');
    fs.writeFileSync(path.join(this.root, 'wally.toml'), '[package]\nname = "a/b"\nversion = "0.1.0"\n');
    fs.writeFileSync(path.join(this.root, 'wally.lock'), '[[package]]\nname = "roblox/roact"\nversion = "1.4.4"\n');
    fs.writeFileSync(
      path.join(this.root, 'default.project.json'),
      JSON.stringify({ name: 'fixture', tree: { $className: 'DataModel' } }),
    );
  }

  cleanup(): void {
    fs.rmSync(this.root, { recursive: true, force: true });
  }

  get rokit(): RokitTools {
    return {
      status: () => {
        this.calls.push('rokit.status');
        return {
          manifestPath: path.join(this.root, 'rokit.toml'),
          legacy: false,
          healthy: this.toolchainHealthy,
          action: this.toolchainHealthy ? 'none' : 'install',
          reasons: this.toolchainHealthy ? [] : ['rojo: no installed shim'],
          tools: [],
        };
      },
      install: () => {
        this.calls.push('rokit.install');
        if (this.installFails) return { tool: 'rokit', available: true, ok: false, error: 'download failed' };
        this.toolchainHealthy = true;
        return { tool: 'rokit', available: true, ok: true, output: 'installed' };
      },
      update: () => {
        this.calls.push('rokit.update');
        return { tool: 'rokit', available: true, ok: true };
      },
    } as unknown as RokitTools;
  }

  get wally(): WallyTools {
    return {
      validateLock: () => {
        this.calls.push('wally.validateLock');
        return {
          root: this.root,
          lockPath: path.join(this.root, 'wally.lock'),
          present: this.lockPresent,
          ok: this.lockOk,
          declared: 1,
          locked: 1,
          missing: [],
          mismatched: [],
          unverifiable: [],
          unresolved: [],
        };
      },
      verifyRojoMapping: () => {
        this.calls.push('wally.verifyRojoMapping');
        return {
          root: this.root,
          projectFile: path.join(this.root, 'default.project.json'),
          packageDirectories: this.packagesInstalled ? ['Packages'] : [],
          mapped: this.packagesInstalled ? ['Packages'] : [],
          unmapped: [],
          ok: this.packagesInstalled,
        };
      },
      installPlan: () => ({ planHash: 'wally-plan-hash' }),
      installApply: (_root?: string, _confirm?: boolean, locked?: boolean, expectedPlanHash?: string) => {
        this.calls.push('wally.installApply(locked=' + locked + ',hash=' + expectedPlanHash + ')');
        if (this.installFails) {
          return { tool: 'wally', available: true, ok: false, error: 'registry unreachable', lockRestored: true };
        }
        this.packagesInstalled = true;
        return { tool: 'wally', available: true, ok: true, lockRestored: false };
      },
      updateApply: () => {
        this.calls.push('wally.updateApply');
        return { tool: 'wally', available: true, ok: true };
      },
    } as unknown as WallyTools;
  }

  get rojo(): RojoTools {
    return {
      serveStatus: () => ({
        projectFile: path.join(this.root, 'default.project.json'),
        status: this.serveStatus,
      }),
      serveStart: async () => {
        this.calls.push('rojo.serveStart');
        this.serveStatus = 'running';
        return {
          projectFile: path.join(this.root, 'default.project.json'),
          host: '127.0.0.1',
          port: 34872,
          status: 'running',
        };
      },
      serveStop: () => {
        this.calls.push('rojo.serveStop');
        this.serveStatus = 'stopped';
        return { stopped: true };
      },
      generateSourcemap: async () => {
        this.calls.push('rojo.generateSourcemap');
        fs.writeFileSync(path.join(this.root, 'sourcemap.json'), '{}');
        return { ok: true, tool: 'rojo', available: true };
      },
      validateProject: async () => {
        this.calls.push('rojo.validateProject');
        return { ok: true, tool: 'rojo', available: true };
      },
    } as unknown as RojoTools;
  }

  reconciler(): ProjectReconciler {
    return new ProjectReconciler(this.rokit, this.wally, this.rojo);
  }
}

describe('project_reconcile', () => {
  let fixture: Fixture;
  const saved = { ...process.env };

  beforeEach(() => {
    fixture = new Fixture();
    process.env.BLOXFORGE_PROJECT_ROOT = fixture.root;
    collectProjectChecks.mockReset();
    collectProjectChecks.mockResolvedValue([{ name: 'Rojo project', status: 'ok', detail: 'fixture' }]);
  });

  afterEach(() => {
    process.env = { ...saved };
    fixture.cleanup();
  });

  // 1. A declared-but-unbuilt project reaches ready in one flow.
  test('takes a clean declared project from ready=false to ready=true in one apply', async () => {
    const reconciler = fixture.reconciler();
    const plan = reconciler.plan(fixture.root);
    expect(plan.ready).toBe(false);
    expect(plan.steps.map((step) => step.id)).toEqual([
      'install-toolchain',
      'install-packages',
      'generate-sourcemap',
      'start-rojo',
    ]);

    const result = await reconciler.apply(fixture.root, undefined, true, plan.planHash);
    expect(result.ok).toBe(true);
    expect(result.ready).toBe(true);
    expect((result.executed as Array<{ id: string }>).map((step) => step.id)).toEqual([
      'install-toolchain',
      'install-packages',
      'generate-sourcemap',
      'start-rojo',
    ]);
  });

  // 2. Running it again changes nothing.
  test('a second apply is a no-op', async () => {
    const reconciler = fixture.reconciler();
    const first = reconciler.plan(fixture.root);
    await reconciler.apply(fixture.root, undefined, true, first.planHash);

    const second = reconciler.plan(fixture.root);
    expect(second.ready).toBe(true);
    expect(second.steps).toEqual([]);
    const result = await reconciler.apply(fixture.root, undefined, true, second.planHash);
    expect(result.noOp).toBe(true);
    expect(result.executed).toEqual([]);
  });

  // 3. An edit between plan and apply invalidates the plan.
  test('refuses a plan hash taken before the manifest changed', async () => {
    const reconciler = fixture.reconciler();
    const plan = reconciler.plan(fixture.root);
    fs.appendFileSync(path.join(fixture.root, 'rokit.toml'), '\n# edited by another agent\n');

    const result = await reconciler.apply(fixture.root, undefined, true, plan.planHash);
    expect(result.ok).toBe(false);
    expect(String(result.error)).toMatch(/changed after project_reconcile_plan ran/);
    expect(fixture.calls).not.toContain('rokit.install');
  });

  test('refuses an apply with no plan hash at all', async () => {
    const result = await fixture.reconciler().apply(fixture.root, undefined, true);
    expect(String(result.error)).toMatch(/expectedPlanHash is required/);
  });

  // 4. Two agents cannot run the same steps at once.
  test('a second concurrent reconcile is blocked by the lease', async () => {
    const held = {
      pid: process.pid,
      runId: 'held-by-another-agent',
      startedAt: new Date().toISOString(),
      projectRoot: fixture.root,
    };
    const lease = path.join(fixture.root, '.bloxforge', 'locks', 'project-reconcile.lock');
    fs.mkdirSync(path.dirname(lease), { recursive: true });
    fs.writeFileSync(lease, JSON.stringify(held));

    const reconciler = fixture.reconciler();
    const plan = reconciler.plan(fixture.root);
    const result = await reconciler.apply(fixture.root, undefined, true, plan.planHash);

    expect(result).toMatchObject({ blocked: true, reason: 'another_reconcile_is_running' });
    expect((result.lease as { runId: string }).runId).toBe('held-by-another-agent');
    expect(fixture.calls).not.toContain('rokit.install');
  });

  test('takes over a lease whose process is gone', async () => {
    const lease = path.join(fixture.root, '.bloxforge', 'locks', 'project-reconcile.lock');
    fs.mkdirSync(path.dirname(lease), { recursive: true });
    // A pid that cannot be running: kill(pid, 0) reports ESRCH, so it is stale.
    fs.writeFileSync(lease, JSON.stringify({
      pid: 0x7ffffff0,
      runId: 'crashed',
      startedAt: '',
      projectRoot: fixture.root,
    }));

    const reconciler = fixture.reconciler();
    const plan = reconciler.plan(fixture.root);
    const result = await reconciler.apply(fixture.root, undefined, true, plan.planHash);
    expect(result.ok).toBe(true);
  });

  // 5. A crash mid-run resumes from the journal.
  test('resumes from the journal instead of repeating a completed step', async () => {
    const reconciler = fixture.reconciler();
    const plan = reconciler.plan(fixture.root);
    const runId = 'resume-me';

    // Stands in for a crash after the toolchain install. The state check still
    // reports the toolchain as unhealthy — a shim that landed somewhere this
    // process cannot see yet is the realistic version of that — so the journal
    // is the only thing that can stop the step from running a second time.
    const journal = path.join(fixture.root, '.bloxforge', 'reconcile', runId + '.json');
    fs.mkdirSync(path.dirname(journal), { recursive: true });
    fs.writeFileSync(journal, JSON.stringify({
      runId,
      status: 'running',
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      planHash: plan.planHash,
      projectRoot: fixture.root,
      completedSteps: ['install-toolchain'],
      currentStep: 'install-packages',
      lastError: null,
    }));

    const result = await reconciler.apply(fixture.root, undefined, true, plan.planHash, runId);
    expect(result.ok).toBe(true);
    expect(fixture.calls).not.toContain('rokit.install');
    expect(fixture.calls).toContain('wally.installApply(locked=true,hash=wally-plan-hash)');
    expect(JSON.parse(fs.readFileSync(journal, 'utf8')).status).toBe('completed');
  });

  // 6. A withheld permission means the operation never happens.
  test('installPinnedTools=false blocks the install rather than performing it', async () => {
    fs.writeFileSync(path.join(fixture.root, 'bloxforge.toml'), '[automation]\ninstallPinnedTools = false\n');
    const reconciler = fixture.reconciler();
    const plan = reconciler.plan(fixture.root);

    expect(plan.steps.find((step) => step.id === 'install-toolchain')).toMatchObject({
      automatic: false,
      blocked: true,
      requires: 'installPinnedTools',
    });

    const result = await reconciler.apply(fixture.root, undefined, true, plan.planHash);
    expect(result).toMatchObject({ blocked: true, reason: 'step_not_permitted_by_policy' });
    expect(fixture.calls).not.toContain('rokit.install');
  });

  test('an unparsable bloxforge.toml falls back to the defaults rather than widening them', () => {
    fs.writeFileSync(path.join(fixture.root, 'bloxforge.toml'), '[automation\nupdateWallyLock = true');
    expect(loadPolicy(fixture.root).policy).toEqual(DEFAULT_POLICY);
  });

  // 7. The default policy never reaches for an update tool.
  test('never calls an update tool under the default policy', async () => {
    fixture.lockOk = false;
    const reconciler = fixture.reconciler();
    const plan = reconciler.plan(fixture.root);
    expect(plan.steps.find((step) => step.id === 'resolve-wally-lock')).toMatchObject({
      blocked: true,
      requires: 'updateWallyLock',
    });

    await reconciler.apply(fixture.root, undefined, true, plan.planHash);
    expect(fixture.calls).not.toContain('wally.updateApply');
    expect(fixture.calls).not.toContain('rokit.update');
  });

  // 8. A failed Wally install stops the run and leaves the lockfile alone.
  test('a failed Wally install stops the run with the lockfile untouched', async () => {
    fixture.toolchainHealthy = true;
    fixture.installFails = true;
    const reconciler = fixture.reconciler();
    const before = fs.readFileSync(path.join(fixture.root, 'wally.lock'));
    const plan = reconciler.plan(fixture.root);

    const result = await reconciler.apply(fixture.root, undefined, true, plan.planHash);
    expect(result.ok).toBe(false);
    expect((result.failedStep as { id: string }).id).toBe('install-packages');
    expect(fs.readFileSync(path.join(fixture.root, 'wally.lock')).equals(before)).toBe(true);
    expect(fixture.calls).not.toContain('rojo.generateSourcemap');
  });

  // 9. Ambiguity asks rather than guesses.
  test('an ambiguous Rojo project blocks and names the candidates', async () => {
    fs.writeFileSync(
      path.join(fixture.root, 'other.project.json'),
      JSON.stringify({ name: 'other', tree: { $className: 'DataModel' } }),
    );
    const reconciler = fixture.reconciler();
    const plan = reconciler.plan(fixture.root);

    expect(plan.ready).toBe(false);
    expect(plan.steps).toEqual([]);
    expect(plan.blockers.join(' ')).toMatch(/Multiple Rojo project files found/);

    const result = await reconciler.apply(fixture.root, undefined, true, plan.planHash);
    expect(result).toMatchObject({ blocked: true, reason: 'reconcile_is_blocked' });
    expect(fixture.calls).not.toContain('rokit.install');
  });

  // 10. The run always ends on the strict verify.
  test('always finishes with a strict project verify', async () => {
    const reconciler = fixture.reconciler();
    const plan = reconciler.plan(fixture.root);
    await reconciler.apply(fixture.root, undefined, true, plan.planHash);
    expect(collectProjectChecks).toHaveBeenCalledWith(fixture.root);
  });

  test('a warning keeps ready false, because the verify is strict', async () => {
    collectProjectChecks.mockResolvedValue([
      { name: 'Wally package mapping', status: 'warn', detail: 'unmapped: Packages' },
    ]);
    const reconciler = fixture.reconciler();
    const plan = reconciler.plan(fixture.root);
    const result = await reconciler.apply(fixture.root, undefined, true, plan.planHash);
    expect(result.ready).toBe(false);
    expect(result.ok).toBe(false);
  });

  test('status reports the lease holder and the recent runs', async () => {
    const reconciler = fixture.reconciler();
    const plan = reconciler.plan(fixture.root);
    await reconciler.apply(fixture.root, undefined, true, plan.planHash);

    const status = reconciler.status(fixture.root);
    expect(status.lease).toBeUndefined();
    expect((status.runs as Array<{ status: string }>)[0].status).toBe('completed');
  });
});
