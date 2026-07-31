import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { SyncManager, type ScriptClassName } from '../sync/sync-manager.js';
import { portablePathKey, resolveProjectPath, resolveProjectRoot } from '../rojo/source-mapper.js';
import { contentHash } from '../rojo/source-editor.js';
import type { SafetyOptions, ToolContent } from './runtime-support.js';

type SyncToolRuntime = {
  callSingle(endpoint: string, data: unknown, target: string | undefined, instance_id: string | undefined): Promise<unknown>;
  recordOperation(kind: string, summary: string): void;
};

interface StudioScript {
  path: string;
  pathSegments?: string[];
  className: ScriptClassName;
  source?: string;
  sourceHash: string;
  sourceLength: number;
  unchanged?: boolean;
  sourceOmitted?: boolean;
}

interface SyncStateEntry {
  contentHash: string;
  studioHash: string;
  studioIdentity: string;
  lastSuccessfulSyncAt: string;
}

/** Bumped to 2 when `studioHash` gained a second accumulator and a length suffix. */
const STATE_SCHEMA_VERSION = 2;
/** The plugin caps items per page, so this bounds a misbehaving or looping peer. */
const MAX_STUDIO_PAGES = 500;

interface SyncState {
  schemaVersion: typeof STATE_SCHEMA_VERSION;
  projectIdentity: string;
  updatedAt: string;
  entries: Record<string, SyncStateEntry>;
}

interface SyncPlan {
  added: string[];
  modified: string[];
  localOnly: string[];
  conflicts: string[];
  deletedInStudio: string[];
  inSync: string[];
  tooLarge: string[];
  unsupported: Array<{ path: string; reason: string }>;
  ambiguous: Array<{ from: string; candidates: string[] }>;
  renamed: Array<{ from: string; to: string }>;
  scripts: Map<string, StudioScript>;
  local: Map<string, string>;
  state: SyncState;
  planHash: string;
}

/**
 * Mirrors `sourceHash` in the Studio plugin. Studio cannot afford SHA-256 over
 * ten thousand scripts in Luau, so identity is two independent rolling hashes
 * plus the byte length — enough that a single-hash collision no longer makes a
 * changed script look unchanged. Both sides must stay in sync.
 */
function studioHash(content: string): string {
  const bytes = Buffer.from(content);
  let djb2 = 5381;
  let sdbm = 0;
  for (const byte of bytes) {
    djb2 = (djb2 * 33 + byte) % 2147483647;
    sdbm = (sdbm * 65599 + byte) % 2147483647;
  }
  return `djb2:${djb2.toString(16).padStart(8, '0')}:${sdbm.toString(16).padStart(8, '0')}:${bytes.length}`;
}

function atomicWriteFile(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.bloxforge-${process.pid}-${randomUUID()}.tmp`;
  try {
    // Preserve the existing mode; only brand-new files get the private default.
    let mode = 0o600;
    try { mode = fs.statSync(file).mode; } catch { /* new file keeps 0600 */ }
    fs.writeFileSync(temporary, content, { encoding: 'utf8', mode });
    fs.renameSync(temporary, file);
  } finally {
    try { fs.unlinkSync(temporary); } catch { /* already renamed or unavailable */ }
  }
}

/** Only the leading segment is the DataModel; a child may be named "game". */
function stripDataModelPrefix(segments: string[]): string[] {
  return segments[0] === 'game' ? segments.slice(1) : segments;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isValidStateEntry(value: unknown): value is SyncStateEntry {
  const entry = value as Partial<SyncStateEntry> | null;
  return !!entry
    && typeof entry === 'object'
    && typeof entry.contentHash === 'string'
    && typeof entry.studioHash === 'string'
    && typeof entry.studioIdentity === 'string'
    && typeof entry.lastSuccessfulSyncAt === 'string';
}

export class SyncTools {
  constructor(
    private readonly sync: SyncManager,
    private readonly runtime: SyncToolRuntime,
  ) {}

  private _statePath(dir: string): string {
    return fs.existsSync(dir)
      ? resolveProjectPath(dir, '.bloxforge/rojo-state.json', false)
      : path.join(dir, '.bloxforge', 'rojo-state.json');
  }

  /**
   * Fails closed. A damaged baseline that silently reads as "never synced" makes
   * every local file look like a Studio addition, so corruption must stop the
   * operation until the caller explicitly asks to rebuild the baseline.
   */
  private _readState(dir: string, resetBaseline = false): SyncState {
    const file = this._statePath(dir);
    const fresh = (): SyncState => ({
      schemaVersion: STATE_SCHEMA_VERSION,
      projectIdentity: dir,
      updatedAt: new Date(0).toISOString(),
      entries: {},
    });

    let raw: string;
    try {
      raw = fs.readFileSync(file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fresh();
      throw new Error(`Cannot read sync state ${file}: ${errorMessage(error)}`, { cause: error });
    }

    const problem = ((): string | undefined => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch (error) {
        return `invalid JSON (${errorMessage(error)})`;
      }
      const state = parsed as Partial<SyncState> | null;
      if (!state || typeof state !== 'object' || Array.isArray(state)) return 'not a JSON object';
      if (state.schemaVersion !== STATE_SCHEMA_VERSION) return `unsupported schemaVersion ${String(state.schemaVersion)}`;
      if (state.projectIdentity !== dir) return `belongs to a different directory (${String(state.projectIdentity)})`;
      if (!state.entries || typeof state.entries !== 'object' || Array.isArray(state.entries)) return 'missing "entries" object';
      const broken = Object.entries(state.entries).find(([, entry]) => !isValidStateEntry(entry));
      if (broken) return `invalid entry for ${broken[0]}`;
      return undefined;
    })();

    if (!problem) return JSON.parse(raw) as SyncState;
    if (!resetBaseline) {
      throw new Error(
        `Sync state ${file} is unusable: ${problem}. Inspect it, then re-run with resetBaseline=true to quarantine it and rebuild the baseline from scratch.`,
      );
    }
    fs.renameSync(file, `${file}.quarantine-${new Date().toISOString().replace(/[:.]/g, '-')}`);
    return fresh();
  }

  private _writeState(dir: string, state: SyncState): void {
    atomicWriteFile(this._statePath(dir), `${JSON.stringify({
      ...state,
      schemaVersion: STATE_SCHEMA_VERSION,
      projectIdentity: dir,
      updatedAt: new Date().toISOString(),
    }, null, 2)}\n`);
  }

  private async _readStudioScripts(state: SyncState, instance_id?: string): Promise<StudioScript[]> {
    const scripts: StudioScript[] = [];
    let continuationToken: string | undefined;
    const knownHashes: Record<string, string> = {};
    let knownHashBytes = 0;
    for (const entry of Object.values(state.entries)) {
      knownHashBytes += Buffer.byteLength(entry.studioIdentity) + Buffer.byteLength(entry.studioHash);
      if (knownHashBytes > 256 * 1024) break;
      knownHashes[entry.studioIdentity] = entry.studioHash;
    }
    const seenTokens = new Set<string>();
    let pages = 0;
    do {
      if (++pages > MAX_STUDIO_PAGES) {
        throw new Error(`Studio returned more than ${MAX_STUDIO_PAGES} managed-script pages; aborting instead of paging forever`);
      }
      const response = await this.runtime.callSingle('/api/read-managed-scripts', {
        rootPath: 'game',
        limit: 100,
        maxSourceBytes: 1024 * 1024,
        knownHashes,
        ...(continuationToken ? { continuationToken } : {}),
      }, 'edit', instance_id) as { items?: unknown; continuationToken?: unknown; error?: unknown };
      if (typeof response?.error === 'string') throw new Error(response.error);
      if (!Array.isArray(response?.items)) throw new Error('Invalid managed-script page from Studio');
      for (const item of response.items) {
        const script = item as Partial<StudioScript>;
        if (
          typeof script.path === 'string' &&
          typeof script.className === 'string' &&
          typeof script.sourceHash === 'string' &&
          typeof script.sourceLength === 'number' &&
          (script.className === 'Script' || script.className === 'LocalScript' || script.className === 'ModuleScript')
        ) {
          scripts.push(script as StudioScript);
        }
      }
      continuationToken = typeof response.continuationToken === 'string'
        ? response.continuationToken
        : undefined;
      // A plugin repeating a token would otherwise spin here forever.
      if (continuationToken !== undefined) {
        if (seenTokens.has(continuationToken)) {
          throw new Error('Studio repeated a managed-script continuation token; aborting the paginated read');
        }
        seenTokens.add(continuationToken);
      }
    } while (continuationToken);
    return scripts;
  }

  private _walkLocalScripts(dir: string): Map<string, string> {
    const out = new Map<string, string>();
    const walk = (current: string) => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(current, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (entry.name === '.bloxforge' || entry.isSymbolicLink()) continue;
        const full = path.join(current, entry.name);
        const rel = path.relative(dir, full).split(path.sep).join('/');
        if (entry.isDirectory()) walk(full);
        else if (entry.isFile() && this.sync.classNameForFile(entry.name) && !this.sync.isIgnored(rel)) {
          out.set(rel, fs.readFileSync(resolveProjectPath(dir, rel), 'utf8'));
        }
      }
    };
    walk(dir);
    return out;
  }

  private _resolveSyncDir(syncDir?: string): string {
    const projectRoot = resolveProjectRoot(process.env.BLOXFORGE_PROJECT_ROOT?.trim() || process.cwd());
    const requested = syncDir ?? process.env.ROBLOX_SYNC_DIR ?? 'roblox-src';
    return resolveProjectPath(projectRoot, requested, false);
  }

  /**
   * Covers everything an apply depends on: the operations themselves, the Studio
   * identity/hash/length of every mapped script, and the current hash of every
   * local file. A local edit between plan and apply therefore invalidates the
   * hash even when the set of affected paths is unchanged.
   */
  private _planHash(plan: Omit<SyncPlan, 'planHash'>): string {
    const sorted = (values: string[]) => [...values].sort();
    const canonical = {
      schemaVersion: STATE_SCHEMA_VERSION,
      added: sorted(plan.added),
      modified: sorted(plan.modified),
      localOnly: sorted(plan.localOnly),
      conflicts: sorted(plan.conflicts),
      deletedInStudio: sorted(plan.deletedInStudio),
      tooLarge: sorted(plan.tooLarge),
      renamed: [...plan.renamed].map(({ from, to }) => `${from} ${to}`).sort(),
      unsupported: plan.unsupported.map(({ path: instancePath, reason }) => `${instancePath} ${reason}`).sort(),
      ambiguous: plan.ambiguous.map(({ from, candidates }) => `${from} ${sorted(candidates).join(',')}`).sort(),
      studio: [...plan.scripts]
        .map(([rel, script]) => `${rel} ${script.path} ${script.className} ${script.sourceHash} ${script.sourceLength}`)
        .sort(),
      local: [...plan.local].map(([rel, content]) => `${rel} ${contentHash(content)}`).sort(),
      baseline: Object.entries(plan.state.entries)
        .map(([rel, entry]) => `${rel} ${entry.contentHash} ${entry.studioHash}`)
        .sort(),
    };
    return `sha256:${createHash('sha256').update(JSON.stringify(canonical)).digest('hex')}`;
  }

  private async _plan(dir: string, instance_id?: string, resetBaseline = false): Promise<SyncPlan> {
    const state = this._readState(dir, resetBaseline);
    const studioScripts = await this._readStudioScripts(state, instance_id);
    const local = this._walkLocalScripts(dir);
    const scripts = new Map<string, StudioScript>();
    const plan: Omit<SyncPlan, 'planHash'> = {
      added: [],
      modified: [],
      localOnly: [],
      conflicts: [],
      deletedInStudio: [],
      inSync: [],
      tooLarge: [],
      unsupported: [],
      ambiguous: [],
      renamed: [],
      scripts,
      local,
      state,
    };

    // An Instance name Rojo cannot represent as a portable file name is reported,
    // never encoded into a name Rojo would decode back into a different Instance.
    const mappedScripts: Array<{ script: StudioScript; rel: string }> = [];
    for (const script of studioScripts) {
      const segments = script.pathSegments?.length
        ? script.pathSegments
        : stripDataModelPrefix(script.path.split('.').filter(Boolean));
      let rel: string;
      try {
        rel = this.sync.instanceSegmentsToFilePath(segments, script.className);
      } catch (error) {
        plan.unsupported.push({ path: script.path, reason: errorMessage(error) });
        continue;
      }
      if (!this.sync.isIgnored(rel)) mappedScripts.push({ script, rel });
    }

    const pathCounts = new Map<string, number>();
    for (const { rel } of mappedScripts) {
      const key = portablePathKey(rel);
      pathCounts.set(key, (pathCounts.get(key) ?? 0) + 1);
    }
    const blockedPaths = new Set(
      [...pathCounts].filter(([, count]) => count > 1).map(([key]) => key),
    );

    for (const { script, rel } of mappedScripts) {
      if (blockedPaths.has(portablePathKey(rel))) {
        if (!plan.conflicts.includes(rel)) plan.conflicts.push(rel);
        continue;
      }
      scripts.set(rel, script);
      const baseline = state.entries[rel];
      if (script.source === undefined && !script.unchanged) {
        plan.tooLarge.push(rel);
        continue;
      }
      const localContent = local.get(rel);
      const localHash = localContent === undefined ? undefined : contentHash(localContent);
      const studioContentHash = script.source === undefined ? baseline?.contentHash : contentHash(script.source);
      const baseHash = baseline?.contentHash;
      if (localHash === studioContentHash) plan.inSync.push(rel);
      else if (localHash === undefined) plan.added.push(rel);
      else if (localHash === baseHash) plan.modified.push(rel);
      else if (studioContentHash === baseHash) plan.localOnly.push(rel);
      else plan.conflicts.push(rel);
    }
    for (const [rel, baseline] of Object.entries(state.entries)) {
      if (blockedPaths.has(portablePathKey(rel))) continue;
      if (scripts.has(rel)) continue;
      const localContent = local.get(rel);
      if (localContent === undefined || contentHash(localContent) === baseline.contentHash) plan.deletedInStudio.push(rel);
      else plan.conflicts.push(rel);
    }

    // A rename is only inferable when exactly one added file carries the removed
    // file's baseline content. Two identical scripts would otherwise make the
    // first candidate win and silently move the wrong file.
    const claimed = new Set<string>();
    for (const from of [...plan.deletedInStudio]) {
      const baseHash = state.entries[from]?.contentHash;
      if (!baseHash) continue;
      const candidates = plan.added.filter((candidate) => {
        if (claimed.has(candidate)) return false;
        const source = scripts.get(candidate)?.source;
        return source !== undefined && contentHash(source) === baseHash;
      });
      if (candidates.length !== 1) {
        if (candidates.length > 1) plan.ambiguous.push({ from, candidates });
        continue;
      }
      const to = candidates[0];
      claimed.add(to);
      plan.renamed.push({ from, to });
      plan.deletedInStudio.splice(plan.deletedInStudio.indexOf(from), 1);
      plan.added.splice(plan.added.indexOf(to), 1);
    }
    return { ...plan, planHash: this._planHash(plan) };
  }

  async syncPull(
    syncDir?: string,
    instance_id?: string,
    options: SafetyOptions & {
      deleteMissing?: boolean;
      expectedPlanHash?: string;
      requirePlanHash?: boolean;
      resetBaseline?: boolean;
    } = {},
  ) {
    const dir = this._resolveSyncDir(syncDir);
    const plan = await this._plan(dir, instance_id, options.resetBaseline);
    const apply = options.confirm === true && options.dryRun !== true;
    const applied: string[] = [];
    const deleted: string[] = [];

    if (apply) {
      if (options.requirePlanHash === true && !options.expectedPlanHash) {
        throw new Error('expectedPlanHash is required: review rojo_syncback_plan, then apply the planHash it returned');
      }
      if (options.expectedPlanHash && plan.planHash !== options.expectedPlanHash) {
        throw new Error(`Sync plan changed since preview (expected ${options.expectedPlanHash}, found ${plan.planHash}); review a fresh rojo_syncback_plan before applying`);
      }
      fs.mkdirSync(dir, { recursive: true });
      const backupRoot = path.join(dir, '.bloxforge', 'backups', new Date().toISOString().replace(/[:.]/g, '-'));
      const rollback: Array<{ file: string; previous?: string }> = [];
      const renamedRollback: Array<{ from: string; to: string }> = [];
      try {
        for (const rename of plan.renamed) {
          const from = resolveProjectPath(dir, rename.from);
          const to = resolveProjectPath(dir, rename.to, false);
          // The write path re-checks; the rename path must too. Otherwise an edit
          // made after the preview is moved to a new name and then recorded as
          // the confirmed baseline, so the next plan sees nothing to reconcile.
          if (fs.readFileSync(from, 'utf8') !== plan.local.get(rename.from)) {
            throw new Error(`${rename.from} changed on disk after the plan was produced; re-run rojo_syncback_plan`);
          }
          fs.mkdirSync(path.dirname(to), { recursive: true });
          fs.renameSync(from, to);
          renamedRollback.push({ from, to });
          applied.push(rename.to);
        }
        for (const rel of [...plan.added, ...plan.modified]) {
          const script = plan.scripts.get(rel);
          if (script?.source === undefined) continue;
          const file = resolveProjectPath(dir, rel, false);
          const previous = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : undefined;
          // Re-check right before writing: the plan's view of this file must still hold.
          if (previous !== plan.local.get(rel)) {
            throw new Error(`${rel} changed on disk after the plan was produced; re-run rojo_syncback_plan`);
          }
          if (previous !== undefined) atomicWriteFile(path.join(backupRoot, rel), previous);
          rollback.push({ file, previous });
          atomicWriteFile(file, script.source);
          applied.push(rel);
        }
        if (options.deleteMissing === true) {
          for (const rel of plan.deletedInStudio) {
            // Baseline can name a file that is already gone locally; nothing to unlink.
            if (!plan.local.has(rel)) continue;
            const file = resolveProjectPath(dir, rel, false);
            if (!fs.existsSync(file)) continue;
            const previous = fs.readFileSync(file, 'utf8');
            if (previous !== plan.local.get(rel)) {
              throw new Error(`${rel} changed on disk after the plan was produced; re-run rojo_syncback_plan`);
            }
            atomicWriteFile(path.join(backupRoot, rel), previous);
            rollback.push({ file, previous });
            fs.unlinkSync(file);
            deleted.push(rel);
          }
        }

        // State is part of the same transaction: if it cannot be written, the
        // files it describes must not stay changed either.
        const now = new Date().toISOString();
        for (const rel of [...plan.inSync, ...applied]) {
          const script = plan.scripts.get(rel);
          const content = script?.source ?? plan.local.get(rel);
          if (!script || content === undefined) continue;
          plan.state.entries[rel] = {
            contentHash: contentHash(content),
            studioHash: script.sourceHash,
            studioIdentity: script.path,
            lastSuccessfulSyncAt: now,
          };
        }
        for (const rename of plan.renamed) delete plan.state.entries[rename.from];
        for (const rel of deleted) delete plan.state.entries[rel];
        this._writeState(dir, plan.state);
      } catch (error) {
        for (const item of rollback.reverse()) {
          if (item.previous === undefined) {
            try { fs.unlinkSync(item.file); } catch { /* rollback is best effort */ }
          } else {
            atomicWriteFile(item.file, item.previous);
          }
        }
        for (const item of renamedRollback.reverse()) {
          try { fs.renameSync(item.to, item.from); } catch { /* rollback is best effort */ }
        }
        throw error;
      }
      this.runtime.recordOperation('sync_pull', `pulled ${applied.length} scripts to ${dir}`);
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          deprecated: true,
          warning: 'sync_pull is deprecated; use rojo_syncback_plan/apply for explicit Studio-to-files updates.',
          dir,
          dryRun: !apply,
          planHash: plan.planHash,
          applied,
          deleted,
          added: plan.added,
          modified: plan.modified,
          localOnly: plan.localOnly,
          conflicts: plan.conflicts,
          deletedInStudio: plan.deletedInStudio,
          renamed: plan.renamed,
          ambiguous: plan.ambiguous,
          unsupported: plan.unsupported,
          inSync: plan.inSync.length,
          tooLarge: plan.tooLarge,
          confirmationRequired: !apply && (
            plan.added.length > 0 ||
            plan.modified.length > 0 ||
            plan.renamed.length > 0 ||
            (options.deleteMissing === true && plan.deletedInStudio.length > 0)
          ),
        }, null, 2),
      }] as ToolContent[],
    };
  }

  async syncStatus(syncDir?: string, instance_id?: string, options: { resetBaseline?: boolean } = {}) {
    const dir = this._resolveSyncDir(syncDir);
    const plan = await this._plan(dir, instance_id, options.resetBaseline);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          deprecated: true,
          warning: 'sync_status is deprecated; use rojo_syncback_plan.',
          dir,
          planHash: plan.planHash,
          localOnlyChanges: plan.localOnly,
          studioOnlyChanges: [...plan.added, ...plan.modified],
          conflicts: plan.conflicts,
          deletedInStudio: plan.deletedInStudio,
          renamed: plan.renamed,
          ambiguous: plan.ambiguous,
          unsupported: plan.unsupported,
          inSync: plan.inSync.length,
          tooLarge: plan.tooLarge,
        }, null, 2),
      }] as ToolContent[],
    };
  }

  async syncPush(syncDir?: string, instance_id?: string, options: SafetyOptions & { resetBaseline?: boolean } = {}) {
    const dir = this._resolveSyncDir(syncDir);
    const plan = await this._plan(dir, instance_id, options.resetBaseline);
    const apply = options.confirm === true && options.dryRun !== true;
    if (!apply) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            deprecated: true,
            warning: 'sync_push is deprecated; edit Rojo-managed local files and let rojo serve update Studio.',
            dir,
            dryRun: true,
            planHash: plan.planHash,
            wouldPush: plan.localOnly,
            conflicts: plan.conflicts,
            unsupported: plan.unsupported,
            confirmationRequired: plan.localOnly.length > 0,
          }, null, 2),
        }] as ToolContent[],
      };
    }

    const pushed: string[] = [];
    const failed: Array<{ path: string; error: string }> = [];
    for (const rel of plan.localOnly) {
      const script = plan.scripts.get(rel);
      const content = plan.local.get(rel);
      if (!script || content === undefined) continue;
      // Push what the caller reviewed, not the plan's snapshot: a file edited
      // after planning would otherwise overwrite Studio with unreviewed content
      // and then be recorded as the agreed baseline.
      let current: string;
      try {
        current = fs.readFileSync(resolveProjectPath(dir, rel), 'utf8');
      } catch (error) {
        failed.push({ path: rel, error: errorMessage(error) });
        continue;
      }
      if (current !== content) {
        failed.push({ path: rel, error: `${rel} changed on disk after the plan was produced; re-run sync_status` });
        continue;
      }
      // The plugin reports failure as an { error } envelope rather than throwing.
      // Recording a baseline for it would mark the file in-sync and lose the edit.
      const response = await this.runtime.callSingle('/api/set-script-source', {
        instancePath: script.path,
        source: content,
      }, undefined, instance_id) as { error?: unknown } | undefined;
      if (typeof response?.error === 'string') {
        failed.push({ path: rel, error: response.error });
        continue;
      }
      pushed.push(rel);
    }
    const now = new Date().toISOString();
    for (const rel of pushed) {
      const script = plan.scripts.get(rel)!;
      const content = plan.local.get(rel)!;
      plan.state.entries[rel] = {
        contentHash: contentHash(content),
        studioHash: studioHash(content),
        studioIdentity: script.path,
        lastSuccessfulSyncAt: now,
      };
    }
    if (pushed.length > 0) {
      this._writeState(dir, plan.state);
      this.runtime.recordOperation('sync_push', `pushed ${pushed.length} scripts from ${dir}`);
    }
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          deprecated: true,
          warning: 'sync_push is deprecated; prefer rojo serve.',
          dir,
          dryRun: false,
          pushed,
          failed,
          conflicts: plan.conflicts,
          unsupported: plan.unsupported,
        }, null, 2),
      }] as ToolContent[],
    };
  }
}
