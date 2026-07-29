import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { SyncManager, type ScriptClassName } from '../sync/sync-manager.js';
import { resolveProjectPath, resolveProjectRoot } from '../rojo/source-mapper.js';
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

interface SyncState {
  schemaVersion: 1;
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
  renamed: Array<{ from: string; to: string }>;
  scripts: Map<string, StudioScript>;
  local: Map<string, string>;
  state: SyncState;
}

function studioHash(content: string): string {
  let value = 5381;
  for (const byte of Buffer.from(content)) value = (value * 33 + byte) % 2147483647;
  return `djb2:${value.toString(16).padStart(8, '0')}`;
}

function atomicWriteFile(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.bloxforge-${process.pid}-${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, content, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temporary, file);
  } finally {
    try { fs.unlinkSync(temporary); } catch { /* already renamed or unavailable */ }
  }
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

  private _readState(dir: string): SyncState {
    try {
      const parsed = JSON.parse(fs.readFileSync(this._statePath(dir), 'utf8')) as SyncState;
      if (parsed.schemaVersion === 1 && parsed.entries && typeof parsed.entries === 'object') return parsed;
    } catch { /* missing or invalid state starts a fresh baseline */ }
    return {
      schemaVersion: 1,
      projectIdentity: dir,
      updatedAt: new Date(0).toISOString(),
      entries: {},
    };
  }

  private _writeState(dir: string, state: SyncState): void {
    atomicWriteFile(this._statePath(dir), `${JSON.stringify({
      ...state,
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
    do {
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

  private async _plan(dir: string, instance_id?: string): Promise<SyncPlan> {
    const state = this._readState(dir);
    const studioScripts = await this._readStudioScripts(state, instance_id);
    const local = this._walkLocalScripts(dir);
    const scripts = new Map<string, StudioScript>();
    const plan: SyncPlan = {
      added: [],
      modified: [],
      localOnly: [],
      conflicts: [],
      deletedInStudio: [],
      inSync: [],
      tooLarge: [],
      renamed: [],
      scripts,
      local,
      state,
    };

    for (const script of studioScripts) {
      const segments = script.pathSegments?.length
        ? script.pathSegments
        : script.path.split('.').filter((segment) => segment !== 'game');
      const rel = this.sync.instanceSegmentsToFilePath(segments, script.className);
      if (this.sync.isIgnored(rel)) continue;
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
      if (scripts.has(rel)) continue;
      const localContent = local.get(rel);
      if (localContent === undefined || contentHash(localContent) === baseline.contentHash) plan.deletedInStudio.push(rel);
      else plan.conflicts.push(rel);
    }
    for (const from of [...plan.deletedInStudio]) {
      const baseHash = state.entries[from]?.contentHash;
      const to = plan.added.find((candidate) => {
        const source = scripts.get(candidate)?.source;
        return source !== undefined && contentHash(source) === baseHash;
      });
      if (!to) continue;
      plan.renamed.push({ from, to });
      plan.deletedInStudio.splice(plan.deletedInStudio.indexOf(from), 1);
      plan.added.splice(plan.added.indexOf(to), 1);
    }
    return plan;
  }

  async syncPull(syncDir?: string, instance_id?: string, options: SafetyOptions & { deleteMissing?: boolean } = {}) {
    const dir = this._resolveSyncDir(syncDir);
    const plan = await this._plan(dir, instance_id);
    const apply = options.confirm === true && options.dryRun !== true;
    const applied: string[] = [];
    const deleted: string[] = [];

    if (apply) {
      fs.mkdirSync(dir, { recursive: true });
      const backupRoot = path.join(dir, '.bloxforge', 'backups', new Date().toISOString().replace(/[:.]/g, '-'));
      const rollback: Array<{ file: string; previous?: string }> = [];
      const renamedRollback: Array<{ from: string; to: string }> = [];
      try {
        for (const rename of plan.renamed) {
          const from = resolveProjectPath(dir, rename.from);
          const to = resolveProjectPath(dir, rename.to, false);
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
          if (previous !== undefined) atomicWriteFile(path.join(backupRoot, rel), previous);
          rollback.push({ file, previous });
          atomicWriteFile(file, script.source);
          applied.push(rel);
        }
        if (options.deleteMissing === true) {
          for (const rel of plan.deletedInStudio) {
            const file = resolveProjectPath(dir, rel);
            const previous = fs.readFileSync(file, 'utf8');
            atomicWriteFile(path.join(backupRoot, rel), previous);
            rollback.push({ file, previous });
            fs.unlinkSync(file);
            deleted.push(rel);
          }
        }
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
          applied,
          deleted,
          added: plan.added,
          modified: plan.modified,
          localOnly: plan.localOnly,
          conflicts: plan.conflicts,
          deletedInStudio: plan.deletedInStudio,
          renamed: plan.renamed,
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

  async syncStatus(syncDir?: string, instance_id?: string) {
    const dir = this._resolveSyncDir(syncDir);
    const plan = await this._plan(dir, instance_id);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          deprecated: true,
          warning: 'sync_status is deprecated; use rojo_syncback_plan.',
          dir,
          localOnlyChanges: plan.localOnly,
          studioOnlyChanges: [...plan.added, ...plan.modified],
          conflicts: plan.conflicts,
          deletedInStudio: plan.deletedInStudio,
          renamed: plan.renamed,
          inSync: plan.inSync.length,
          tooLarge: plan.tooLarge,
        }, null, 2),
      }] as ToolContent[],
    };
  }

  async syncPush(syncDir?: string, instance_id?: string, options: SafetyOptions = {}) {
    const dir = this._resolveSyncDir(syncDir);
    const plan = await this._plan(dir, instance_id);
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
            wouldPush: plan.localOnly,
            conflicts: plan.conflicts,
            confirmationRequired: plan.localOnly.length > 0,
          }, null, 2),
        }] as ToolContent[],
      };
    }

    const pushed: string[] = [];
    for (const rel of plan.localOnly) {
      const script = plan.scripts.get(rel);
      const content = plan.local.get(rel);
      if (!script || content === undefined) continue;
      await this.runtime.callSingle('/api/set-script-source', {
        instancePath: script.path,
        source: content,
      }, undefined, instance_id);
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
          conflicts: plan.conflicts,
        }, null, 2),
      }] as ToolContent[],
    };
  }
}
