// World-model + asset-preflight tools, split out of the RobloxStudioTools
// monolith. Token-lean read pipeline (snapshot → batch → changefeed → search) plus
// the authoritative asset insert preflight. All run via execute-luau through the
// shared runtime; the changefeed owns its snapshot store. The facade delegates here.

import { buildWorldSnapshotLuau, buildNodeBatchLuau, type SnapshotLevel } from '../builders/world-model.js';
import { buildSceneSearchLuau } from '../builders/scene-search.js';
import { buildWorldFingerprintLuau } from '../builders/world-fingerprint.js';
import { buildAssetPreflightLuau } from '../builders/asset-preflight.js';
import { buildSanitizeScanLuau, buildSanitizeApplyLuau, SANITIZE_PATTERNS, type SanitizeAction } from '../builders/asset-sanitize.js';
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
      if (typeof rv === 'string') {
        const parsed = JSON.parse(rv) as { fingerprint?: Fingerprint; count?: number; truncated?: boolean; scope?: string; error?: string };
        if (parsed.error) return { fp: {}, count: 0, truncated: false, error: parsed.error };
        return { fp: parsed.fingerprint ?? {}, count: parsed.count ?? 0, truncated: parsed.truncated ?? false, scope: parsed.scope };
      }
    } catch { /* fall through */ }
    return { fp: {}, count: 0, truncated: false, error: 'Could not parse world fingerprint' };
  }

  async getChangesSince(snapshotId?: string, path?: string, instance_id?: string) {
    const p = path ?? 'game';
    const cur = await this._captureFingerprint(p, instance_id);
    const wrap = (obj: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(obj) }] as ToolContent[] });
    if (cur.error) return wrap({ error: cur.error, path: p });
    if (!snapshotId) {
      const id = this.snapshots.put(p, cur.fp);
      return wrap({ snapshotId: id, baseline: true, count: cur.count, truncated: cur.truncated, path: p, scope: cur.scope });
    }
    const prev = this.snapshots.get(snapshotId);
    if (!prev) return wrap({ error: 'Unknown or expired snapshotId — call get_changes_since with no snapshotId to start a new baseline.', snapshotId });
    const diff = diffFingerprints(prev.fingerprint, cur.fp);
    this.snapshots.update(snapshotId, cur.fp); // rolling baseline
    return wrap({ snapshotId, path: p, ...diff, count: cur.count, truncated: cur.truncated, scope: cur.scope });
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
      buildSanitizeApplyLuau(targets, chosen),
      instance_id,
      `sanitize ${chosen} (${targets.length} scripts)`,
    );
    return result;
  }
}
