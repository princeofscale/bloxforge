// One contract for every third-party integration, instead of one tool set each.
//
// Roadmap 04, item 1. The alternative — `adonis_install`, `pesde_add`,
// `fusion_generate_component`, three tools per library — is not an integration
// but a tax: the catalog is already 218 tools and costs 49.9k tokens per
// request in full mode, and every new library would widen that for every agent
// on every call, including the ones that never touch the library.
//
// So: four operations over a declared manifest.
//
//   inspect   what is here, which version, and how we know
//   plan      what would change, immutable, with a planHash
//   apply     exactly that plan, re-reading every file immediately before it writes
//   validate  the postconditions the pack itself declared
//
// The repository invariants live here once rather than in each pack: a plan
// hash covers every input the apply depends on; a file is re-read before it is
// written; a step that makes a decision rather than restoring declared state
// comes back blocked, naming what would permit it; and anything unrecognized
// stops the operation instead of being guessed at.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import type { ToolEffect } from '../tools/definitions.js';

/**
 * The most any pack may declare.
 *
 * The four `integration_*` tools declare exactly this set, because a tool's
 * effects are fixed at definition time while the pack behind it is chosen at
 * call time. Bounding the packs is what keeps the tool's declaration honest
 * instead of aspirational — a pack that wanted more would be advertised under a
 * declaration that did not cover it.
 */
export const PACK_EFFECT_CEILING: readonly ToolEffect[] = [
  'local.files.read',
  'local.files.write',
  'local.process.execute',
  'network.external',
];

/** A file the plan depends on. `digest: null` means "must still not exist". */
export interface FileExpectation {
  path: string;
  digest: string | null;
}

/**
 * A step is either a repair or a decision, and the pack has to say which.
 *
 * The same line the reconcile invariant draws: installing the exact version a
 * manifest pins is a repair; choosing a version is a decision. A decision comes
 * back as `blocked` naming the flag that would permit it, and `apply` never
 * runs it — not even with confirm.
 */
export interface PackStep {
  id: string;
  summary: string;
  kind: 'automatic' | 'blocked';
  /** Required when blocked: the flag or approval that would permit this step. */
  blockedBy?: string;
  /** Every file the step reads or writes. Each must appear in the plan's expectations. */
  touches: readonly string[];
}

export interface DraftPlan {
  steps: readonly PackStep[];
  expectations: readonly FileExpectation[];
  /**
   * Anything remote the plan resolved to: an asset id, a release tag, a
   * registry version. Hashed into the planHash, because a plan that pinned
   * release 1.2.3 must not apply once it means something else.
   */
  remoteIdentities?: Readonly<Record<string, string>>;
  /** Free-form pack output for the caller. Not hashed — it must not steer an apply. */
  detail?: Readonly<Record<string, unknown>>;
}

export interface IntegrationPlan extends DraftPlan {
  packId: string;
  packVersion: string;
  planHash: string;
}

export interface Detection {
  present: boolean;
  /** Present-tense evidence, not an inference: the files and fields that decided it. */
  evidence: readonly string[];
  version?: string;
  variant?: string;
  detail?: Readonly<Record<string, unknown>>;
}

export type CheckStatus = 'pass' | 'fail' | 'unknown';

export interface Check {
  id: string;
  status: CheckStatus;
  /** Why. An `unknown` that does not say what was missing is not a result. */
  message: string;
  /** A failing check that does not block is advisory. Default is blocking. */
  advisory?: boolean;
}

export interface PackContext {
  /** Project root every path in the pack is relative to. */
  root: string;
  /** Read a file, or null when it does not exist. Injected so packs stay testable. */
  readFile: (path: string) => string | null;
  /** Anything the host wants to expose to packs — the Studio bridge, a runner. */
  host?: Readonly<Record<string, unknown>>;
}

export interface IntegrationPack {
  id: string;
  title: string;
  /** The pack's own version. Part of the plan hash: a changed pack invalidates old plans. */
  version: string;
  /**
   * Licence of the integrated project, declared rather than assumed. A pack
   * that installs somebody else's code has to say under what terms, and
   * `'unknown'` is a real answer that a policy can refuse.
   */
  license: string;
  /** The primary source this pack encodes — what a reviewer checks it against. */
  sourceOfTruth: string;
  /** Declared, never inferred from the name. Same rule as ToolDefinition.effects. */
  effects: readonly ToolEffect[];

  detect(ctx: PackContext): Promise<Detection>;
  plan(ctx: PackContext, request: Readonly<Record<string, unknown>>): Promise<DraftPlan>;
  /** Execute one automatic step. The engine has already re-verified its files. */
  apply(ctx: PackContext, step: PackStep): Promise<Record<string, unknown>>;
  validate(ctx: PackContext): Promise<readonly Check[]>;
}

export class PackError extends Error {}

// ─── Registry ────────────────────────────────────────────────────────

const packs = new Map<string, IntegrationPack>();

export function registerPack(pack: IntegrationPack): void {
  if (packs.has(pack.id)) throw new PackError(`Integration pack already registered: ${pack.id}`);
  const over = pack.effects.filter((e) => !PACK_EFFECT_CEILING.includes(e));
  if (over.length > 0) {
    throw new PackError(`Pack ${pack.id} declares ${over.join(', ')}, which the integration_* tools do not declare. Widen the tool declaration deliberately or drop the effect.`);
  }
  if (pack.effects.length === 0) {
    throw new PackError(`Pack ${pack.id} declares no effects. A pack that truly does nothing to the project does not need to be a pack.`);
  }
  packs.set(pack.id, pack);
}

export function listPacks(): { id: string; title: string; version: string; license: string; sourceOfTruth: string; effects: readonly ToolEffect[] }[] {
  return [...packs.values()]
    .map((p) => ({ id: p.id, title: p.title, version: p.version, license: p.license, sourceOfTruth: p.sourceOfTruth, effects: p.effects }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** Fail closed on an unknown id, and name what is available rather than only refusing. */
export function getPack(id: string): IntegrationPack {
  const pack = packs.get(id);
  if (!pack) {
    const known = [...packs.keys()].sort().join(', ') || '(none registered)';
    throw new PackError(`Unknown integration pack: ${id}. Registered: ${known}`);
  }
  return pack;
}

/** Test seam. Not exported through the facade — packs are registered at module load. */
export function _resetPacks(): void {
  packs.clear();
}

// ─── Context ─────────────────────────────────────────────────────────

export function fileContext(root: string, host?: Record<string, unknown>): PackContext {
  return {
    root,
    readFile: (path) => {
      try {
        return readFileSync(path, 'utf8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
    },
    ...(host ? { host } : {}),
  };
}

/** Textual containment. Symlinks are the ceiling; see the note on `planIntegration`. */
function withinRoot(root: string, candidate: string): boolean {
  const rel = relative(resolve(root), resolve(root, candidate));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

export function digestOf(content: string | null): string | null {
  return content === null ? null : `sha256:${createHash('sha256').update(content).digest('hex')}`;
}

// ─── Plan ────────────────────────────────────────────────────────────

/**
 * Hash every input the apply depends on.
 *
 * Length-prefixed and sorted, so `{a: 'b|c'}` and `{a: 'b', c: ''}` cannot
 * collide into the same hash by concatenation. `detail` is deliberately outside
 * the hash: it is for the caller to read, and anything that steers an apply
 * belongs in a step.
 */
function hashPlan(packId: string, packVersion: string, request: Readonly<Record<string, unknown>>, draft: DraftPlan): string {
  const canonical = {
    packId,
    packVersion,
    request: canonicalize(request),
    steps: draft.steps.map((s) => [s.id, s.kind, s.blockedBy ?? '', s.summary, [...s.touches].sort().join('\0')]),
    expectations: [...draft.expectations].map((e) => `${e.path}\0${e.digest ?? 'absent'}`).sort(),
    remoteIdentities: Object.entries(draft.remoteIdentities ?? {}).sort(([a], [b]) => a.localeCompare(b)),
  };
  return `sha256:${createHash('sha256').update(JSON.stringify(canonical)).digest('hex')}`;
}

/** Stable key order so an equivalent request hashes equally regardless of spelling order. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonicalize(v)]),
    );
  }
  return value;
}

export async function inspectIntegration(id: string, ctx: PackContext): Promise<Detection & { packId: string; license: string; sourceOfTruth: string }> {
  const pack = getPack(id);
  const detection = await pack.detect(ctx);
  return { ...detection, packId: pack.id, license: pack.license, sourceOfTruth: pack.sourceOfTruth };
}

// ponytail: containment is textual, so a symlink inside the root that points
// outside it is not caught here. Ceiling accepted because the packs in this
// repository name paths they construct from the root themselves, never paths a
// caller supplied. Upgrade path when a pack takes a caller-supplied path:
// realpath both sides, as `quality-tools.ts` already does for its inputs.
export async function planIntegration(
  id: string,
  ctx: PackContext,
  request: Readonly<Record<string, unknown>> = {},
): Promise<IntegrationPlan> {
  const pack = getPack(id);
  const draft = await pack.plan(ctx, request);

  // A step whose file is not in the expectations would be applied without ever
  // being re-read — invariant 3 defeated by omission rather than by edit. That
  // is a pack bug, and it is caught at plan time rather than mid-apply.
  // A pack names its own paths, so the containment check belongs here rather
  // than in each pack — one of them getting it wrong is exactly the case this
  // has to survive.
  for (const path of [...draft.expectations.map((e) => e.path), ...draft.steps.flatMap((s) => s.touches)]) {
    if (!withinRoot(ctx.root, path)) {
      throw new PackError(`Pack ${pack.id} named ${path}, which is outside the project root ${ctx.root}.`);
    }
  }

  const declared = new Set(draft.expectations.map((e) => e.path));
  for (const step of draft.steps) {
    for (const path of step.touches) {
      if (!declared.has(path)) {
        throw new PackError(`Pack ${pack.id} step ${step.id} touches ${path}, which the plan does not record an expectation for.`);
      }
    }
    if (step.kind === 'blocked' && !step.blockedBy) {
      throw new PackError(`Pack ${pack.id} step ${step.id} is blocked but does not name what would permit it.`);
    }
  }
  const seen = new Set<string>();
  for (const step of draft.steps) {
    if (seen.has(step.id)) throw new PackError(`Pack ${pack.id} returned two steps with id ${step.id}; step order is the contract.`);
    seen.add(step.id);
  }

  return { ...draft, packId: pack.id, packVersion: pack.version, planHash: hashPlan(pack.id, pack.version, request, draft) };
}

// ─── Apply ───────────────────────────────────────────────────────────

export interface ApplyResult {
  packId: string;
  planHash: string;
  applied: { stepId: string; result: Record<string, unknown> }[];
  /** Steps that were never run, and why. A skipped step is reported, not dropped. */
  skipped: { stepId: string; reason: string }[];
  /** True only when every automatic step ran. A plan of nothing is not a success. */
  complete: boolean;
  summary: string;
}

/**
 * Apply a plan, re-reading each step's files immediately before it runs.
 *
 * The verification is done twice on purpose: once up front, so a stale plan
 * fails before anything is touched, and once per step, because step one can
 * take a minute and step three's file can move inside it. The per-step check is
 * the one the invariant actually requires; the up-front one only makes the
 * failure cheap.
 */
export async function applyIntegration(
  id: string,
  ctx: PackContext,
  plan: IntegrationPlan,
  expectedPlanHash: string | undefined,
  confirm: boolean | undefined,
): Promise<ApplyResult> {
  const pack = getPack(id);
  if (confirm !== true) throw new PackError(`${pack.id}: confirm=true is required — this applies changes to the project.`);
  if (!expectedPlanHash) throw new PackError(`${pack.id}: expectedPlanHash is required. Take it from integration_plan.`);
  if (expectedPlanHash !== plan.planHash) {
    throw new PackError(`${pack.id}: plan hash mismatch — expected ${expectedPlanHash}, plan is ${plan.planHash}. Re-plan; do not apply a stale plan.`);
  }
  if (plan.packId !== pack.id) throw new PackError(`Plan was produced by ${plan.packId}, not ${pack.id}.`);
  if (plan.packVersion !== pack.version) {
    throw new PackError(`${pack.id}: plan was made by pack version ${plan.packVersion}, this is ${pack.version}. Re-plan.`);
  }

  const byPath = new Map(plan.expectations.map((e) => [e.path, e.digest]));
  verifyFiles(pack.id, ctx, [...byPath.keys()], byPath, 'since the plan was made');

  const applied: ApplyResult['applied'] = [];
  const skipped: ApplyResult['skipped'] = [];
  for (const step of plan.steps) {
    if (step.kind === 'blocked') {
      skipped.push({ stepId: step.id, reason: `blocked: ${step.blockedBy}` });
      continue;
    }
    verifyFiles(pack.id, ctx, step.touches, byPath, `before step ${step.id}`);
    applied.push({ stepId: step.id, result: await pack.apply(ctx, step) });
  }

  const automatic = plan.steps.filter((s) => s.kind === 'automatic').length;
  return {
    packId: pack.id,
    planHash: plan.planHash,
    applied,
    skipped,
    complete: applied.length === automatic,
    summary: automatic === 0
      ? `Nothing to apply: the plan has ${plan.steps.length} step(s), none automatic.`
      : `Applied ${applied.length}/${automatic} automatic step(s), skipped ${skipped.length} blocked.`,
  };
}

function verifyFiles(
  packId: string,
  ctx: PackContext,
  paths: readonly string[],
  expected: ReadonlyMap<string, string | null>,
  when: string,
): void {
  for (const path of paths) {
    const want = expected.get(path);
    const have = digestOf(ctx.readFile(path));
    if (want === have) continue;
    const describe = (d: string | null | undefined) => (d === null ? 'absent' : d ?? 'unrecorded');
    throw new PackError(`${packId}: ${path} changed ${when} — plan recorded ${describe(want)}, found ${describe(have)}. Re-plan.`);
  }
}

// ─── Validate ────────────────────────────────────────────────────────

export interface ValidationResult {
  packId: string;
  checks: readonly Check[];
  /** False if any blocking check failed *or* could not be determined. */
  passed: boolean;
  blocking: readonly string[];
}

/**
 * Run the pack's declared checks.
 *
 * `unknown` blocks exactly as `fail` does, for the reason the asset gates give:
 * a check that could not run is not a check that passed. An advisory check may
 * be unknown without blocking, because it was never load-bearing.
 */
export async function validateIntegration(id: string, ctx: PackContext): Promise<ValidationResult> {
  const pack = getPack(id);
  const checks = await pack.validate(ctx);
  const blocking = checks
    .filter((c) => !c.advisory && c.status !== 'pass')
    .map((c) => `${c.id}: ${c.status} — ${c.message}`);
  return { packId: pack.id, checks, passed: blocking.length === 0, blocking };
}
