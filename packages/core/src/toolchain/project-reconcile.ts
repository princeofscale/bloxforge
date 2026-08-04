// One idempotent flow that brings a project from "declared" to "running".
//
// Every individual operation already exists and is already safe. What was
// missing is the order: an agent had to work out for itself that rokit_status
// comes before rokit_install, that a Wally install is pointless before the lock
// validates, and that a sourcemap generated before the packages are installed
// describes a tree that does not exist yet. Reconcile owns that order.
//
// The governing rule is narrow on purpose: **reconcile may restore declared
// state, and may never invent new state.** Installing the exact version
// rokit.toml pins is a restoration. Choosing a version for it is not. Installing
// the packages wally.lock already resolved is a restoration. Resolving a new
// lock is not. Everything in the second category is reported as a blocked step
// with the policy flag that would permit it, and left for a human.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { RokitTools } from './rokit-tools.js';
import { WallyTools } from './wally-tools.js';
import { RojoTools } from '../rojo/rojo-tools.js';
import { selectRojoProject } from '../rojo/project-discovery.js';
import { resolveProjectRoot } from '../rojo/source-mapper.js';
import { findManifest, planHashOf, planHashMismatch, readTomlFile } from './manifest.js';
import { collectProjectChecks } from '../doctor.js';

export interface ReconcilePolicy {
  /** Install the exact versions the toolchain manifest already pins. */
  installPinnedTools: boolean;
  /** Install the packages wally.lock already resolved. */
  installLockedPackages: boolean;
  generateSourcemap: boolean;
  startRojo: boolean;
  restartManagedRojo: boolean;
  /** Off by default: each of these decides new state rather than restoring it. */
  updateToolPins: boolean;
  updateWallyLock: boolean;
  editRojoProject: boolean;
  migrateAftmanToRokit: boolean;
}

export const DEFAULT_POLICY: Readonly<ReconcilePolicy> = Object.freeze({
  installPinnedTools: true,
  installLockedPackages: true,
  generateSourcemap: true,
  startRojo: true,
  restartManagedRojo: true,
  updateToolPins: false,
  updateWallyLock: false,
  editRojoProject: false,
  migrateAftmanToRokit: false,
});

export interface ReconcileStep {
  id: string;
  /** The tool an agent would call to perform this step by hand. */
  tool: string;
  reason: string;
  /** The policy permits reconcile to run this unattended. */
  automatic: boolean;
  /** Cannot run: the policy withholds it, or it needs a human decision. */
  blocked: boolean;
  /** The policy flag that would unblock it, when one exists. */
  requires?: keyof ReconcilePolicy;
}

export interface ReconcilePlan {
  ready: boolean;
  projectRoot: string;
  projectFile?: string;
  policy: ReconcilePolicy;
  steps: ReconcileStep[];
  blockers: string[];
  notes: string[];
  planHash: string;
  confirmationRequired: true;
  /**
   * Wall-clock milliseconds per inspection phase.
   *
   * Reported after a healthy two-tool project took about 160 seconds to return a
   * one-step plan "without timeout diagnostics". Every step here is synchronous
   * and individually bounded — the toolchain shim probes cap at 5s each — so the
   * code alone does not explain it, and without a breakdown the next occurrence
   * is just as opaque. This makes it answerable: whichever phase ate the time
   * says so. Excluded from planHash: timings are observation, not plan content.
   */
  timingsMs: Record<string, number>;
}

interface Journal {
  runId: string;
  status: 'running' | 'completed' | 'failed' | 'blocked';
  startedAt: string;
  updatedAt: string;
  planHash: string;
  projectRoot: string;
  completedSteps: string[];
  currentStep: string | null;
  lastError: string | null;
}

interface Lease {
  pid: number;
  runId: string;
  startedAt: string;
  projectRoot: string;
}

const LEASE_FILE = path.join('.bloxforge', 'locks', 'project-reconcile.lock');
const JOURNAL_DIRECTORY = path.join('.bloxforge', 'reconcile');

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** `WallyTools.load` searches upward, so "no manifest anywhere" is its error. */
function noWally(error: unknown): boolean {
  return /No wally\.toml found at or above/.test(errorText(error));
}

/**
 * `[automation]` in bloxforge.toml, over the defaults. Unknown keys and
 * non-boolean values are ignored rather than guessed at: a typo must not
 * silently enable something the defaults deliberately withhold.
 */
export function loadPolicy(root: string): { policy: ReconcilePolicy; source?: string } {
  const file = findManifest(root, 'bloxforge.toml');
  if (!file) return { policy: { ...DEFAULT_POLICY } };
  let automation: Record<string, unknown> = {};
  try {
    const data = readTomlFile(file);
    const block = data.automation;
    if (block && typeof block === 'object' && !Array.isArray(block)) {
      automation = block as Record<string, unknown>;
    }
  } catch {
    // An unparsable config must not quietly widen what reconcile may do.
    return { policy: { ...DEFAULT_POLICY } };
  }
  const policy = { ...DEFAULT_POLICY };
  for (const key of Object.keys(DEFAULT_POLICY) as Array<keyof ReconcilePolicy>) {
    const value = automation[key];
    if (typeof value === 'boolean') policy[key] = value;
  }
  return { policy, source: file };
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means it exists and belongs to somebody else.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function readLease(projectRoot: string): Lease | undefined {
  try {
    return JSON.parse(fs.readFileSync(path.join(projectRoot, LEASE_FILE), 'utf8')) as Lease;
  } catch {
    return undefined;
  }
}

/**
 * Exclusive create, so two agents starting at the same moment cannot both
 * believe they hold it. A lease whose process is gone is stale — a crashed run
 * must not lock the project forever — and is taken over once.
 */
function acquireLease(projectRoot: string, runId: string): { ok: true } | { ok: false; held: Lease | undefined } {
  const file = path.join(projectRoot, LEASE_FILE);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lease: Lease = { pid: process.pid, runId, startedAt: new Date().toISOString(), projectRoot };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.writeFileSync(file, JSON.stringify(lease, null, 2), { flag: 'wx' });
      return { ok: true };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const held = readLease(projectRoot);
      // Our own pid is not an exemption. One MCP server can have two applies in
      // flight, and that is precisely the case the lease exists for; only a
      // lease whose process is gone is stale.
      if (held && isProcessAlive(held.pid)) return { ok: false, held };
      // Stale (or unreadable, which is the same problem): drop it and retry once.
      try {
        fs.unlinkSync(file);
      } catch {
        return { ok: false, held };
      }
    }
  }
  return { ok: false, held: readLease(projectRoot) };
}

function releaseLease(projectRoot: string, runId: string): void {
  const held = readLease(projectRoot);
  if (held && held.runId !== runId) return; // someone else's; not ours to remove
  try {
    fs.unlinkSync(path.join(projectRoot, LEASE_FILE));
  } catch { /* already gone */ }
}

function journalPath(projectRoot: string, runId: string): string {
  return path.join(projectRoot, JOURNAL_DIRECTORY, `${runId}.json`);
}

function writeJournal(journal: Journal): void {
  const file = journalPath(journal.projectRoot, journal.runId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  journal.updatedAt = new Date().toISOString();
  fs.writeFileSync(file, JSON.stringify(journal, null, 2));
}

/**
 * Resumes a run of the same plan. A journal from a different plan is not
 * resumed: its completed steps were computed against other state, so skipping
 * them here would skip work this plan still needs.
 */
function openJournal(projectRoot: string, runId: string, planHash: string): Journal {
  try {
    const existing = JSON.parse(fs.readFileSync(journalPath(projectRoot, runId), 'utf8')) as Journal;
    if (existing.planHash === planHash && Array.isArray(existing.completedSteps)) {
      return { ...existing, status: 'running', currentStep: null, lastError: null };
    }
  } catch { /* no journal yet, or unreadable */ }
  const now = new Date().toISOString();
  return {
    runId,
    status: 'running',
    startedAt: now,
    updatedAt: now,
    planHash,
    projectRoot,
    completedSteps: [],
    currentStep: null,
    lastError: null,
  };
}

export class ProjectReconciler {
  constructor(
    private readonly rokit = new RokitTools(),
    private readonly wally = new WallyTools(),
    private readonly rojo = new RojoTools(),
  ) {}

  /**
   * Reads the current state and returns the ordered remainder. Read-only: it
   * spawns local probes (`<shim> --version`, `wally install --help`) but makes
   * no network request and writes nothing, so it is safe to call on a loop.
   */
  plan(root?: string, projectFile?: string): ReconcilePlan {
    const projectRoot = resolveProjectRoot(root ?? process.cwd());
    const { policy, source } = loadPolicy(projectRoot);
    return this.inspect(projectRoot, projectFile, policy, source);
  }

  private inspect(
    projectRoot: string,
    projectFile: string | undefined,
    policy: ReconcilePolicy,
    policySource?: string,
  ): ReconcilePlan {
    const steps: ReconcileStep[] = [];
    const blockers: string[] = [];
    const notes: string[] = [];
    const files: Array<string | undefined> = [];
    if (policySource) files.push(policySource);

    const timingsMs: Record<string, number> = {};
    const startedAt = Date.now();
    /** Run a phase and record what it cost, whether it succeeds or throws. */
    const timed = <T>(phase: string, run: () => T): T => {
      const began = Date.now();
      try {
        return run();
      } finally {
        timingsMs[phase] = Date.now() - began;
      }
    };

    const finish = (selected?: string): ReconcilePlan => {
      const planHash = planHashOf('project_reconcile', { steps, policy }, files);
      timingsMs.total = Date.now() - startedAt;
      return {
        // Not "nothing runnable": a step the policy withholds still means the
        // project is not ready, and reporting it as ready would hide the one
        // thing the operator needs to decide about.
        ready: steps.length === 0 && blockers.length === 0,
        projectRoot,
        projectFile: selected,
        policy,
        steps,
        blockers,
        notes,
        planHash,
        confirmationRequired: true,
        timingsMs,
      };
    };

    // 1. The Rojo project. Ambiguity blocks rather than picking one: reconciling
    //    the wrong game is worse than asking which one.
    let project;
    try {
      project = timed('selectProject', () => selectRojoProject(projectRoot, projectFile));
    } catch (error) {
      blockers.push(errorText(error));
      return finish();
    }
    files.push(project.projectFile);

    // 2-4. The toolchain manifest, its pins, and the shims they name.
    try {
      const status = timed('rokitStatus', () => this.rokit.status(projectRoot));
      files.push(status.manifestPath);
      if (status.legacy && !policy.migrateAftmanToRokit) {
        notes.push('aftman.toml is read as-is; migrating it to rokit.toml is a decision, not a repair.');
      }
      if (!status.healthy) {
        if (status.action === 'fix-manifest') {
          // No policy flag unblocks this: reconcile cannot choose a version the
          // manifest failed to state.
          blockers.push(`Toolchain manifest cannot be repaired automatically: ${status.reasons.join('; ')}`);
        } else {
          steps.push({
            id: 'install-toolchain',
            tool: 'rokit_install',
            reason: status.reasons.join('; '),
            automatic: policy.installPinnedTools,
            blocked: !policy.installPinnedTools,
            requires: 'installPinnedTools',
          });
        }
      }
    } catch (error) {
      // No manifest at all is not a fault: a project may use tools from PATH.
      notes.push(errorText(error));
    }

    // 5-7. The lockfile, the packages it resolved, and their Rojo mounts.
    try {
      const validation = timed('wallyValidateLock', () => this.wally.validateLock(projectRoot));
      files.push(path.join(validation.root, 'wally.toml'), validation.lockPath);
      if (!validation.present) {
        steps.push({
          id: 'resolve-wally-lock',
          tool: 'wally_install_apply',
          reason: 'wally.lock does not exist, so there is no resolution to restore',
          automatic: false,
          blocked: !policy.updateWallyLock,
          requires: 'updateWallyLock',
        });
      } else if (!validation.ok) {
        steps.push({
          id: 'resolve-wally-lock',
          tool: 'wally_update_apply',
          reason: `wally.lock does not satisfy wally.toml: ${JSON.stringify({
            missing: validation.missing,
            mismatched: validation.mismatched,
            unverifiable: validation.unverifiable,
            unresolved: validation.unresolved,
          })}`,
          automatic: false,
          blocked: !policy.updateWallyLock,
          requires: 'updateWallyLock',
        });
      } else if ((validation.declared ?? 0) > 0) {
        const mapping = timed('wallyRojoMapping', () => this.wally.verifyRojoMapping(projectRoot, project.projectFile));
        if (mapping.packageDirectories.length === 0) {
          steps.push({
            id: 'install-packages',
            tool: 'wally_install_apply',
            reason: `wally.lock resolves ${validation.locked} package(s) but no package directory exists`,
            automatic: policy.installLockedPackages,
            blocked: !policy.installLockedPackages,
            requires: 'installLockedPackages',
          });
        } else if (!mapping.ok) {
          steps.push({
            id: 'map-packages',
            tool: 'rojo_get_project_info',
            reason: `${mapping.unmapped.join(', ')} exist but are not mounted by ${path.basename(mapping.projectFile)}`,
            automatic: false,
            blocked: !policy.editRojoProject,
            requires: 'editRojoProject',
          });
        }
      }
    } catch (error) {
      if (noWally(error)) notes.push('No wally.toml; this project does not use Wally.');
      else blockers.push(errorText(error));
    }

    // 9. The sourcemap. Regenerating an existing one on every pass would make a
    //    second reconcile a mutation, so absence is the trigger; an install
    //    earlier in the same run changes the tree and is re-inspected anyway.
    if (!fs.existsSync(path.join(project.root, 'sourcemap.json'))) {
      steps.push({
        id: 'generate-sourcemap',
        tool: 'rojo_generate_sourcemap',
        reason: 'sourcemap.json does not exist, so instance paths cannot be resolved to files',
        automatic: policy.generateSourcemap,
        blocked: !policy.generateSourcemap,
        requires: 'generateSourcemap',
      });
    }

    // 10. `rojo serve`.
    const serve = timed('rojoServeStatus', () => this.rojo.serveStatus(projectRoot, project.projectFile));
    if (serve.status !== 'running') {
      const restart = serve.status !== 'stopped';
      const permitted = restart ? policy.restartManagedRojo : policy.startRojo;
      steps.push({
        id: restart ? 'restart-rojo' : 'start-rojo',
        tool: 'rojo_serve_start',
        reason: `rojo serve is ${serve.status}`,
        automatic: permitted,
        blocked: !permitted,
        requires: restart ? 'restartManagedRojo' : 'startRojo',
      });
    }

    return finish(project.projectFile);
  }

  /**
   * Runs the plan's steps in order under a single-writer lease, re-reading state
   * after every mutation. Precomputing ten hashes and marching through them
   * would be wrong: `rokit_install` changes which tools exist, which changes
   * what the remaining steps should even be.
   */
  async apply(
    root?: string,
    projectFile?: string,
    confirm = false,
    expectedPlanHash?: string,
    runId?: string,
  ): Promise<Record<string, unknown>> {
    const projectRoot = resolveProjectRoot(root ?? process.cwd());
    const { policy, source } = loadPolicy(projectRoot);
    let plan = this.inspect(projectRoot, projectFile, policy, source);

    if (!confirm) {
      return {
        ...plan,
        ok: false,
        error: 'Confirmation required: review project_reconcile_plan, then pass confirm=true with its planHash.',
      };
    }
    const mismatch = planHashMismatch(expectedPlanHash, plan.planHash, 'project_reconcile_plan');
    if (mismatch) return { ok: false, error: mismatch, planHash: plan.planHash, projectRoot };
    if (plan.blockers.length > 0) {
      return { ok: false, blocked: true, reason: 'reconcile_is_blocked', ...plan };
    }

    const id = runId ?? randomUUID();
    const lease = acquireLease(projectRoot, id);
    if (!lease.ok) {
      return { ok: false, blocked: true, reason: 'another_reconcile_is_running', lease: lease.held ?? {} };
    }

    const journal = openJournal(projectRoot, id, plan.planHash);
    const executed: Array<{ id: string; tool: string; ok: boolean; detail?: string }> = [];
    try {
      writeJournal(journal);
      for (;;) {
        const step = plan.steps.find((candidate) => !journal.completedSteps.includes(candidate.id));
        if (!step) break;
        if (step.blocked) {
          journal.status = 'blocked';
          journal.currentStep = step.id;
          journal.lastError = `${step.id} needs policy.${step.requires ?? 'automation'} = true`;
          writeJournal(journal);
          return {
            ok: false,
            blocked: true,
            reason: 'step_not_permitted_by_policy',
            runId: id,
            step,
            executed,
            ...plan,
          };
        }
        journal.currentStep = step.id;
        writeJournal(journal);

        const result = await this.runStep(step, projectRoot, plan.projectFile);
        if (!result.ok) {
          journal.status = 'failed';
          journal.lastError = result.detail ?? `${step.id} failed`;
          writeJournal(journal);
          return { ok: false, runId: id, failedStep: step, executed: [...executed, result], ...plan };
        }
        executed.push(result);
        journal.completedSteps.push(step.id);
        journal.currentStep = null;
        writeJournal(journal);

        // A step that reported success but did not change the state is not
        // retried: it is already in completedSteps, so the next pass moves on
        // and the final verify reports what is still wrong.
        plan = this.inspect(projectRoot, projectFile, policy, source);
      }

      // 8. A mutation may have produced a tree Rojo cannot build. Skipped when
      //    nothing ran, so a no-op reconcile stays cheap.
      if (executed.length > 0 && plan.projectFile) {
        const validation = await this.rojo.validateProject(projectRoot, plan.projectFile);
        if (!validation.ok) {
          journal.status = 'failed';
          journal.lastError = validation.error ?? 'rojo build failed';
          writeJournal(journal);
          return { ok: false, runId: id, executed, validation, ...plan };
        }
      }

      // 11. Always finish with the full strict project verify.
      const checks = await collectProjectChecks(projectRoot);
      const ready = !checks.some((check) => check.status === 'fail' || check.status === 'warn');
      journal.status = ready ? 'completed' : 'failed';
      journal.lastError = ready ? null : 'strict verify did not pass';
      writeJournal(journal);
      return {
        ok: ready,
        ready,
        noOp: executed.length === 0,
        runId: id,
        projectRoot,
        projectFile: plan.projectFile,
        policy,
        executed,
        verify: { strict: true, checks, ready },
        remaining: plan.steps,
      };
    } finally {
      releaseLease(projectRoot, id);
    }
  }

  /** The current plan, plus who holds the lease and what recent runs did. */
  status(root?: string, projectFile?: string): Record<string, unknown> {
    const projectRoot = resolveProjectRoot(root ?? process.cwd());
    const plan = this.plan(projectRoot, projectFile);
    return { ...plan, lease: readLease(projectRoot), runs: recentRuns(projectRoot) };
  }

  private async runStep(
    step: ReconcileStep,
    projectRoot: string,
    projectFile?: string,
  ): Promise<{ id: string; tool: string; ok: boolean; detail?: string }> {
    const done = (ok: boolean, detail?: string) => ({ id: step.id, tool: step.tool, ok, detail });
    try {
      switch (step.id) {
        case 'install-toolchain': {
          // allowPinnedToolDownloads refuses anything that is not an exact
          // owner/repo@x.y.z, which is the same line reconcile draws.
          const result = this.rokit.install(projectRoot, true, true);
          return done(result.ok, result.error ?? result.output);
        }
        case 'install-packages': {
          // The hash is taken immediately before the apply, so the install is
          // pinned to the manifest and lock as they are right now — after any
          // earlier step in this run touched them.
          const wallyPlan = this.wally.installPlan(projectRoot);
          const result = this.wally.installApply(projectRoot, true, true, wallyPlan.planHash);
          return done(result.ok, result.error ?? result.output);
        }
        case 'generate-sourcemap': {
          const result = await this.rojo.generateSourcemap(projectRoot, projectFile);
          return done(result.ok, result.error ?? result.output);
        }
        case 'start-rojo':
        case 'restart-rojo': {
          if (step.id === 'restart-rojo') this.rojo.serveStop(projectRoot, projectFile);
          const result = await this.rojo.serveStart(projectRoot, projectFile);
          return done(
            result.status === 'running',
            `rojo serve is ${result.status} on ${result.host}:${result.port}`,
          );
        }
        default:
          return done(false, `${step.id} has no automatic implementation`);
      }
    } catch (error) {
      return done(false, errorText(error));
    }
  }
}

function recentRuns(projectRoot: string, limit = 5): Journal[] {
  const directory = path.join(projectRoot, JOURNAL_DIRECTORY);
  let names: string[];
  try {
    names = fs.readdirSync(directory).filter((name) => name.endsWith('.json'));
  } catch {
    return [];
  }
  const runs: Journal[] = [];
  for (const name of names) {
    try {
      runs.push(JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8')) as Journal);
    } catch { /* a partially written journal is not worth failing status over */ }
  }
  return runs
    .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
    .slice(0, limit);
}
