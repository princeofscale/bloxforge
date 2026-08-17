// World-model + asset-preflight tools, split out of the RobloxStudioTools
// monolith. Token-lean read pipeline (snapshot → batch → changefeed → search) plus
// the authoritative asset insert preflight. All run via execute-luau through the
// shared runtime; the changefeed owns its snapshot store. The facade delegates here.

import { buildWorldSnapshotLuau, buildNodeBatchLuau, type SnapshotLevel } from '../builders/world-model.js';
import { buildSceneSearchLuau } from '../builders/scene-search.js';
import { buildWorldFingerprintLuau } from '../builders/world-fingerprint.js';
import { buildAssetPreflightLuau } from '../builders/asset-preflight.js';
import { buildSanitizeScanLuau, buildSanitizeApplyLuau, SANITIZE_PATTERNS, type SanitizeAction } from '../builders/asset-sanitize.js';
import { buildFitScanLuau, buildFitApplyLuau, type PivotPolicy } from '../builders/asset-fit.js';
import { buildSpatialLayoutLuau, SCAN_LIMIT } from '../builders/scene-layout.js';
import crypto from 'crypto';
import { diffFingerprints, SnapshotStore, type Fingerprint } from '../world-changes.js';
import { classifyError } from '../errors.js';
import { normalizeExecuteLuauToolResult, wrapToolJsonText, type ToolContent } from './runtime-support.js';

type WorldModelRuntime = {
  callSingle(endpoint: string, data: unknown, target: string | undefined, instance_id: string | undefined): Promise<unknown>;
  runGeneratedLuau?(code: string, instance_id?: string, undoLabel?: string): Promise<{ content: ToolContent[] }>;
};

type ScannedScript = {
  path: string;
  name: string;
  className: string;
  enabled?: boolean;
  sourceBytes: number;
  sourceChecksum: number;
  findings: string[];
};

type SanitizeScan = {
  found: boolean;
  path?: string;
  className?: string;
  descendantCount?: number;
  scripts?: ScannedScript[];
  remotes?: Array<{ path: string; className: string }>;
};

/**
 * Covers everything the apply depends on: which subtree, which scripts, and the
 * content of each one. A script edited between plan and apply changes its
 * checksum and invalidates the plan, which is the point — the caller approved a
 * specific set of scripts doing specific things, not a path.
 */
function sanitizePlanHash(action: SanitizeAction, scan: SanitizeScan): string {
  const digest = crypto.createHash('sha256');
  digest.update(JSON.stringify({
    operation: 'asset_sanitize',
    action,
    path: scan.path,
    scripts: (scan.scripts ?? []).map((s) => ({
      path: s.path,
      className: s.className,
      enabled: s.enabled ?? null,
      sourceBytes: s.sourceBytes,
      sourceChecksum: s.sourceChecksum,
    })),
  }));
  return `sha256:${digest.digest('hex')}`;
}

type FitScan = {
  found: boolean;
  isModel?: boolean;
  path?: string;
  className?: string;
  scale?: number;
  extents?: [number, number, number];
  center?: [number, number, number];
  pivotOffset?: [number, number, number];
  partCount?: number;
  unanchoredParts?: number;
};

/**
 * A Roblox character is about 5 studs tall — the one absolute reference the
 * platform provides. Everything a builder judges as "too big" or "too small" is
 * measured against it, so it is the default the plan compares to.
 */
export const CHARACTER_HEIGHT_STUDS = 5;

function fitPlanHash(scan: FitScan, targetScale: number | undefined, pivot: PivotPolicy): string {
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify({
    operation: 'asset_fit',
    path: scan.path,
    scale: scan.scale,
    extents: scan.extents,
    pivotOffset: scan.pivotOffset,
    targetScale: targetScale ?? null,
    pivot,
  })).digest('hex')}`;
}

const SEVERITY_OF: Record<string, 'high' | 'medium'> = {
  require_asset_id: 'high',
  http_request: 'high',
  dynamic_code: 'high',
  env_access: 'high',
  purchase_prompt: 'high',
  player_kick: 'medium',
  datastore: 'medium',
  teleport: 'medium',
  remote_creation: 'medium',
};

export class WorldModelTools {
  private snapshots = new SnapshotStore();

  constructor(private readonly runtime: WorldModelRuntime) {}

  async getWorldSnapshot(path?: string, level?: SnapshotLevel, topNPerClass?: number, instance_id?: string) {
    const code = buildWorldSnapshotLuau(path ?? 'game', level ?? 'overview', topNPerClass ?? 12);
    const response = await this.runtime.callSingle('/api/execute-luau', { code }, 'edit', instance_id);
    return wrapToolJsonText(normalizeExecuteLuauToolResult(response, {
      error: 'get_world_snapshot returned non-object execute-luau output',
    }));
  }

  async sceneSearch(query: string, path?: string, limit?: number, instance_id?: string) {
    if (!query || !query.trim()) {
      throw new Error('query is required for scene_search');
    }
    const response = await this.runtime.callSingle(
      '/api/execute-luau',
      { code: buildSceneSearchLuau(query, path ?? 'game', limit ?? 10) },
      'edit',
      instance_id,
    );
    return wrapToolJsonText(normalizeExecuteLuauToolResult(response, {
      query,
      total: 0,
      returned: 0,
      results: [],
      error: 'scene_search returned non-object execute-luau output',
    }));
  }

  async getNodeBatch(paths: string[], fields?: string[], includeChildrenCount?: boolean, instance_id?: string) {
    if (!Array.isArray(paths) || paths.length === 0) {
      throw new Error('paths (a non-empty array) is required for get_node_batch');
    }
    const response = await this.runtime.callSingle(
      '/api/execute-luau',
      { code: buildNodeBatchLuau(paths, fields ?? [], includeChildrenCount ?? false) },
      'edit',
      instance_id,
    );
    return wrapToolJsonText(normalizeExecuteLuauToolResult(response, {
      nodes: [],
      count: 0,
      error: 'get_node_batch returned non-object execute-luau output',
    }));
  }

  private async _captureFingerprint(path: string, instance_id?: string): Promise<{ fp: Fingerprint; count: number; truncated: boolean; scope?: string; error?: string }> {
    const response = await this.runtime.callSingle('/api/execute-luau', { code: buildWorldFingerprintLuau(path) }, 'edit', instance_id);
    try {
      const rv = (response as { returnValue?: unknown })?.returnValue;
      // A returnValue arrives as a JSON string, except where it does not: the
      // sanitize and fit scans in this same file both accept an already-decoded
      // object, because one of them met it. This accepted only the string, so
      // the same bridge response would have made the changefeed the one read
      // that could not parse the world.
      const parsed = (typeof rv === 'string' ? JSON.parse(rv) : rv) as
        { fingerprint?: Fingerprint; count?: number; truncated?: boolean; scope?: string; error?: string } | undefined;
      if (parsed && typeof parsed === 'object') {
        if (parsed.error) return { fp: {}, count: 0, truncated: false, error: parsed.error };
        return { fp: parsed.fingerprint ?? {}, count: parsed.count ?? 0, truncated: parsed.truncated ?? false, scope: parsed.scope };
      }
    } catch { /* fall through */ }
    return { fp: {}, count: 0, truncated: false, error: 'Could not parse world fingerprint' };
  }

  /**
   * Diff the world against a stored snapshot.
   *
   * The baseline used to roll forward on every call, so a snapshotId silently
   * changed meaning from "the world as it was when I started" to "the world as
   * of my previous call". Asking twice in a row therefore reported no changes,
   * and an agent had no way to ask what it had built across a whole session —
   * the one question the snapshot id looks like it answers.
   *
   * The baseline now holds still, which is what the id promises. Pass
   * `rebaseline: true` for the old polling behaviour ("what moved since I last
   * looked"), where advancing the baseline is the point.
   */
  async getChangesSince(snapshotId?: string, path?: string, instance_id?: string, rebaseline?: boolean) {
    const wrap = (obj: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(obj) }] as ToolContent[] });
    // Resolved before the capture: a snapshot is a fingerprint *of a subtree*,
    // and diffing it against a different one reports the whole of both as
    // changed. `path` used to default to "game" on every call, so baselining
    // `game.Workspace` and then polling with the snapshotId alone — the obvious
    // way to use this — diffed the entire DataModel against a Workspace
    // baseline and returned a scene full of changes that never happened.
    const prev = snapshotId ? this.snapshots.get(snapshotId) : undefined;
    if (snapshotId && !prev) {
      return wrap({ error: 'Unknown or expired snapshotId — call get_changes_since with no snapshotId to start a new baseline.', snapshotId });
    }
    const p = path ?? prev?.path ?? 'game';
    if (prev && prev.path !== p) {
      return wrap({
        error: `snapshotId ${snapshotId} is a baseline of ${prev.path}, and this call asks about ${p}. Comparing two subtrees reports both as entirely changed — pass the same path, omit it, or start a new baseline for ${p}.`,
        snapshotId,
        baselinePath: prev.path,
        requestedPath: p,
      });
    }
    const cur = await this._captureFingerprint(p, instance_id);
    if (cur.error) return wrap({ error: cur.error, path: p });
    if (!prev) {
      const id = this.snapshots.put(p, cur.fp);
      return wrap({ snapshotId: id, baseline: true, count: cur.count, truncated: cur.truncated, path: p, scope: cur.scope });
    }
    const diff = diffFingerprints(prev.fingerprint, cur.fp);
    const rolled = rebaseline === true;
    if (rolled) this.snapshots.update(prev.id, cur.fp);
    return wrap({
      snapshotId: prev.id,
      path: p,
      ...diff,
      // Which question this answer is to. Without it the two modes are
      // indistinguishable in the response, and a caller cannot tell a quiet
      // world from a baseline that just moved out from under it.
      since: rolled ? 'previous-call' : 'baseline',
      baselineAt: prev.createdAt,
      count: cur.count,
      truncated: cur.truncated,
      scope: cur.scope,
    });
  }

  async assetPreflightInsert(assetId: number, instance_id?: string) {
    if (!assetId || !Number.isFinite(Number(assetId))) {
      throw new Error('assetId (a number) is required for asset_preflight_insert');
    }
    const response = await this.runtime.callSingle('/api/execute-luau', { code: buildAssetPreflightLuau(Number(assetId)) }, 'edit', instance_id);
    let verdict: Record<string, unknown> | undefined;
    try {
      const rv = (response as { returnValue?: unknown })?.returnValue;
      if (typeof rv === 'string') verdict = JSON.parse(rv);
    } catch { /* fall through to raw response */ }
    if (verdict && verdict.insertabilityVerdict === 'no' && typeof verdict.error === 'string') {
      verdict.code = classifyError(verdict.error);
      if (verdict.code === 'AUTH') {
        verdict.hint = 'Copy-locked or not owned — pick another candidate (prefer a free, copy-unlocked asset).';
      }
    }
    return { content: [{ type: 'text', text: JSON.stringify(verdict ?? response) }] as ToolContent[] };
  }

  private async scanSubtree(instancePath: string, instance_id?: string): Promise<SanitizeScan> {
    const response = await this.runtime.callSingle(
      '/api/execute-luau',
      { code: buildSanitizeScanLuau(instancePath) },
      'edit',
      instance_id,
    );
    const rv = (response as { returnValue?: unknown })?.returnValue;
    if (typeof rv === 'string') {
      try {
        return JSON.parse(rv) as SanitizeScan;
      } catch { /* fall through */ }
    }
    if (rv && typeof rv === 'object') return rv as SanitizeScan;
    throw new Error(`asset_sanitize_plan could not read ${instancePath}: ${JSON.stringify(response).slice(0, 200)}`);
  }

  async assetSanitizePlan(instancePath: string, action?: SanitizeAction, instance_id?: string) {
    if (!instancePath) throw new Error('instancePath is required for asset_sanitize_plan');
    const chosen: SanitizeAction = action === 'remove' ? 'remove' : 'disable';
    const scan = await this.scanSubtree(instancePath, instance_id);
    if (!scan.found) {
      throw new Error(`instancePath not found for asset_sanitize_plan: ${instancePath}`);
    }

    const scripts = scan.scripts ?? [];
    const flagged = scripts.filter((s) => s.findings.length > 0);
    const severity = flagged.some((s) => s.findings.some((f) => SEVERITY_OF[f] === 'high'))
      ? 'high'
      : flagged.length > 0
        ? 'medium'
        : scripts.length > 0
          ? 'low'
          : 'none';

    return wrapToolJsonText({
      path: scan.path,
      className: scan.className,
      action: chosen,
      severity,
      descendantCount: scan.descendantCount,
      scriptCount: scripts.length,
      flaggedCount: flagged.length,
      remotes: scan.remotes ?? [],
      // Only flagged scripts are listed in full; a clean script contributes its
      // count and nothing else, because a 40-script model would otherwise cost
      // more to report than to inspect.
      scripts: flagged.map((s) => ({
        path: s.path,
        className: s.className,
        enabled: s.enabled,
        sourceBytes: s.sourceBytes,
        findings: s.findings.map((id) => ({
          id,
          severity: SEVERITY_OF[id] ?? 'medium',
          why: SANITIZE_PATTERNS.find((p) => p.id === id)?.why ?? '',
        })),
      })),
      // The apply acts on every script, not only the flagged ones: a model you
      // did not write is the unit of trust, not an individual file.
      targets: scripts.map((s) => s.path),
      planHash: sanitizePlanHash(chosen, scan),
      client_hint: severity === 'none'
        ? 'No scripts under this path — nothing to sanitize.'
        : `Pass this planHash to asset_sanitize_apply to ${chosen === 'remove' ? 'remove' : 'disable'} all ${scripts.length} script(s). Read an individual one with get_script_source first if you want to keep it.`,
    });
  }

  async assetSanitizeApply(instancePath: string, expectedPlanHash: string, action?: SanitizeAction, instance_id?: string) {
    if (!instancePath) throw new Error('instancePath is required for asset_sanitize_apply');
    if (!expectedPlanHash) {
      throw new Error('expectedPlanHash is required for asset_sanitize_apply: run asset_sanitize_plan and pass the planHash it returns.');
    }
    const chosen: SanitizeAction = action === 'remove' ? 'remove' : 'disable';

    // Re-read immediately before mutating. A script added, edited or removed
    // since the plan changes this hash, and the apply refuses rather than acting
    // on a tree the caller never saw.
    const scan = await this.scanSubtree(instancePath, instance_id);
    if (!scan.found) throw new Error(`instancePath not found for asset_sanitize_apply: ${instancePath}`);
    const actual = sanitizePlanHash(chosen, scan);
    if (actual !== expectedPlanHash) {
      throw new Error(
        `${instancePath} changed after asset_sanitize_plan ran (expected planHash ${expectedPlanHash}, current ${actual}). Re-run the plan and review it before applying.`,
      );
    }

    const targets = (scan.scripts ?? []).map((s) => s.path);
    if (targets.length === 0) {
      return wrapToolJsonText({ path: scan.path, action: chosen, applied: [], appliedCount: 0, skippedCount: 0, message: 'No scripts to sanitize.' });
    }
    if (!this.runtime.runGeneratedLuau) {
      throw new Error('asset_sanitize_apply requires the generated-Luau runtime');
    }
    const result = await this.runtime.runGeneratedLuau(
      // The scan's own full name, so the walk starts where the plan was made.
      buildSanitizeApplyLuau(scan.path ?? instancePath, targets, chosen),
      instance_id,
      `sanitize ${chosen} (${targets.length} scripts)`,
    );
    return result;
  }

  private async scanFit(instancePath: string, instance_id?: string): Promise<FitScan> {
    const response = await this.runtime.callSingle(
      '/api/execute-luau',
      { code: buildFitScanLuau(instancePath) },
      'edit',
      instance_id,
    );
    const rv = (response as { returnValue?: unknown })?.returnValue;
    if (typeof rv === 'string') {
      try { return JSON.parse(rv) as FitScan; } catch { /* fall through */ }
    }
    if (rv && typeof rv === 'object') return rv as FitScan;
    throw new Error(`asset_fit_plan could not read ${instancePath}: ${JSON.stringify(response).slice(0, 200)}`);
  }

  async assetFitPlan(instancePath: string, targetHeight?: number, pivot?: PivotPolicy, instance_id?: string) {
    if (!instancePath) throw new Error('instancePath is required for asset_fit_plan');
    const pivotPolicy: PivotPolicy = pivot === 'center' ? 'center' : pivot === 'keep' ? 'keep' : 'base';
    const scan = await this.scanFit(instancePath, instance_id);
    if (!scan.found) throw new Error(`instancePath not found for asset_fit_plan: ${instancePath}`);
    if (!scan.isModel) {
      throw new Error(`asset_fit_plan needs a Model; ${instancePath} is a ${scan.className}. Scale and pivot are Model properties — group the parts into a Model first.`);
    }

    const [ex = 0, ey = 0, ez = 0] = scan.extents ?? [];
    const currentScale = scan.scale ?? 1;
    // ScaleTo is absolute against the authored size, so the target is computed
    // from the current scale rather than applied as a factor — a factor would
    // compound if the model had already been scaled.
    const targetScale = targetHeight && ey > 0
      ? Number(((currentScale * targetHeight) / ey).toFixed(6))
      : undefined;

    const [px = 0, py = 0, pz = 0] = scan.pivotOffset ?? [];
    const pivotDistance = Number(Math.sqrt(px * px + py * py + pz * pz).toFixed(3));
    // The pivot belongs at the base for anything that stands on ground. Half the
    // height below centre is where "base" is, so that is what a correct model
    // already reads as.
    const pivotAlreadyAtBase = Math.abs(px) < 0.05 && Math.abs(pz) < 0.05 && Math.abs(py + ey / 2) < 0.05;

    const notes: string[] = [];
    if (ey > 0) {
      const characters = Number((ey / CHARACTER_HEIGHT_STUDS).toFixed(2));
      notes.push(`${characters}× the height of a character (${CHARACTER_HEIGHT_STUDS} studs)`);
    }
    if (!pivotAlreadyAtBase && pivotPolicy !== 'keep') {
      notes.push(`pivot sits ${pivotDistance} studs from where "${pivotPolicy}" would put it, so moves and rotations swing the model`);
    }
    if ((scan.unanchoredParts ?? 0) > 0) {
      notes.push(`${scan.unanchoredParts} of ${scan.partCount} parts are unanchored and will fall on playtest`);
    }

    return wrapToolJsonText({
      path: scan.path,
      currentScale,
      extents: { x: ex, y: ey, z: ez },
      heightInCharacters: ey > 0 ? Number((ey / CHARACTER_HEIGHT_STUDS).toFixed(2)) : undefined,
      pivotOffset: { x: px, y: py, z: pz },
      pivotAlreadyAtBase,
      partCount: scan.partCount,
      unanchoredParts: scan.unanchoredParts,
      proposed: {
        scale: targetScale,
        resultingHeight: targetScale ? Number((ey * (targetScale / currentScale)).toFixed(3)) : ey,
        pivot: pivotPolicy,
      },
      notes,
      planHash: fitPlanHash(scan, targetScale, pivotPolicy),
      client_hint: targetScale === undefined && pivotPolicy === 'keep'
        ? 'Nothing to change: pass targetHeight to rescale, or pivot to move the pivot.'
        : 'Pass this planHash to asset_fit_apply. The hash covers the model\'s current size and pivot, so moving or rescaling it by hand in between invalidates the plan.',
    });
  }

  async assetFitApply(instancePath: string, expectedPlanHash: string, targetHeight?: number, pivot?: PivotPolicy, instance_id?: string) {
    if (!instancePath) throw new Error('instancePath is required for asset_fit_apply');
    if (!expectedPlanHash) {
      throw new Error('expectedPlanHash is required for asset_fit_apply: run asset_fit_plan and pass the planHash it returns.');
    }
    const pivotPolicy: PivotPolicy = pivot === 'center' ? 'center' : pivot === 'keep' ? 'keep' : 'base';

    const scan = await this.scanFit(instancePath, instance_id);
    if (!scan.found) throw new Error(`instancePath not found for asset_fit_apply: ${instancePath}`);
    if (!scan.isModel) throw new Error(`asset_fit_apply needs a Model; ${instancePath} is a ${scan.className}.`);

    const [, ey = 0] = scan.extents ?? [];
    const currentScale = scan.scale ?? 1;
    const targetScale = targetHeight && ey > 0
      ? Number(((currentScale * targetHeight) / ey).toFixed(6))
      : undefined;

    const actual = fitPlanHash(scan, targetScale, pivotPolicy);
    if (actual !== expectedPlanHash) {
      throw new Error(
        `${instancePath} changed after asset_fit_plan ran (expected planHash ${expectedPlanHash}, current ${actual}). Re-run the plan and review it before applying.`,
      );
    }
    if (targetScale === undefined && pivotPolicy === 'keep') {
      return wrapToolJsonText({ path: scan.path, changed: [], message: 'Nothing to apply: no targetHeight and pivot is "keep".' });
    }
    if (!this.runtime.runGeneratedLuau) {
      throw new Error('asset_fit_apply requires the generated-Luau runtime');
    }
    return this.runtime.runGeneratedLuau(
      buildFitApplyLuau(instancePath, targetScale, pivotPolicy),
      instance_id,
      `fit model (${targetScale !== undefined ? `scale ${targetScale}` : 'pivot only'})`,
    );
  }

  async getSpatialLayout(path?: string, gridSize?: number, topLandmarks?: number, instance_id?: string) {
    const grid = Math.max(4, Math.min(48, Math.round(gridSize ?? 24)));
    const top = Math.max(1, Math.min(40, Math.round(topLandmarks ?? 10)));
    const root = path ?? 'game.Workspace';
    const response = await this.runtime.callSingle(
      '/api/execute-luau',
      { code: buildSpatialLayoutLuau(root, grid, top) },
      'edit',
      instance_id,
    );
    const rv = (response as { returnValue?: unknown })?.returnValue;
    let layout: SpatialLayout | undefined;
    if (typeof rv === 'string') {
      try { layout = JSON.parse(rv) as SpatialLayout; } catch { /* fall through */ }
    } else if (rv && typeof rv === 'object') {
      layout = rv as SpatialLayout;
    }
    if (!layout) {
      throw new Error(`get_spatial_layout could not read ${root}: ${JSON.stringify(response).slice(0, 200)}`);
    }
    if (!layout.found) throw new Error(`path not found for get_spatial_layout: ${root}`);
    return wrapToolJsonText({ ...layout, notes: spatialNotes(layout) });
  }
}

type SpatialLayout = {
  found: boolean;
  path?: string;
  partCount?: number;
  truncated?: boolean;
  bounds?: { min: number[]; max: number[]; size: number[] };
  grid?: { size: number; cell: number[]; origin: number[]; broadParts: number; rows: string[] };
  ground?: { path: string; topY: number; span: number[]; material: string };
  landmarks?: Array<{ name: string; className: string; position: number[]; size: number[] }>;
  spawns?: Array<{ path: string; position: number[] }>;
  terrainCells?: number;
};

/**
 * The numbers above are exact; these say what they mean. Placing anything
 * requires knowing where the floor is and which cells are free, and neither is
 * obvious from a bounding box alone.
 */
function spatialNotes(layout: SpatialLayout): string[] {
  const notes: string[] = [];
  if (!layout.partCount) {
    notes.push('No parts under this path — the space is empty, so any placement is free.');
    return notes;
  }
  const [sx = 0, , sz = 0] = layout.bounds?.size ?? [];
  notes.push(`Built area spans ${sx} × ${sz} studs; a character is about ${CHARACTER_HEIGHT_STUDS} studs tall.`);
  if (layout.ground) {
    notes.push(`Ground is ${layout.ground.path} (${layout.ground.material}); stand things at y=${layout.ground.topY}.`);
  } else {
    notes.push('No flat part wide enough to read as ground — check whether the scene stands on terrain.');
  }
  if (layout.grid) {
    const [cx = 0, cz = 0] = layout.grid.cell;
    const free = layout.grid.rows.reduce((n, row) => n + (row.match(/\./g)?.length ?? 0), 0);
    notes.push(
      `grid.rows is a map of the XZ plane, north (high Z) first: "." is empty, 1-9 is that many parts, "#" is ten or more. ` +
      `Each cell is ${cx} × ${cz} studs from origin [${layout.grid.origin.join(', ')}]. ${free} of ${layout.grid.size * layout.grid.size} cells are empty.`,
    );
    if (layout.grid.broadParts > 0) {
      notes.push(`${layout.grid.broadParts} part(s) cover most of the grid (baseplate or floor) and are excluded from it, so an empty cell means empty of obstacles, not of ground.`);
    }
  }
  if (!layout.spawns?.length) notes.push('No SpawnLocation — players will spawn at the origin.');
  if (layout.truncated) notes.push(`Stopped after ${SCAN_LIMIT} descendants; the picture is partial. Pass a narrower path.`);
  return notes;
}
