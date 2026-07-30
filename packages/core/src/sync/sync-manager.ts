// SyncManager — pure logic for mapping Roblox script instances to/from local
// files and detecting edit conflicts. All filesystem and Studio I/O lives in the
// tool layer; this class is deterministic and unit-testable. Scripts serialize
// to suffixed Lua files so the class is recoverable from the file name:
//   Script       -> *.server.lua
//   LocalScript  -> *.client.lua
//   ModuleScript -> *.lua (the official Rojo convention)

import { classifyRojoSource, unsupportedInstanceNameReason } from '../rojo/source-mapper.js';

export type ScriptClassName = 'Script' | 'LocalScript' | 'ModuleScript';

const SUFFIX_BY_CLASS: Record<ScriptClassName, string> = {
  Script: '.server.lua',
  LocalScript: '.client.lua',
  ModuleScript: '.lua',
};

export type ConflictKind = 'none' | 'local' | 'studio' | 'both';

export interface ConflictInput {
  /** Current content of the local file (undefined if absent). */
  local?: string;
  /** Content captured at the last successful sync (undefined if never synced). */
  base?: string;
  /** Current content in Studio (undefined if the instance is gone). */
  studio?: string;
}

export interface SyncConfig {
  /** Glob-ish ignore patterns evaluated against POSIX-style relative paths. */
  ignore: string[];
}

export const DEFAULT_SYNC_IGNORE = [
  '**/*.spec.lua',
  '**/*.test.lua',
  '**/Packages/**',
  '**/node_modules/**',
];

export class SyncManager {
  private readonly ignore: string[];

  constructor(config: Partial<SyncConfig> = {}) {
    this.ignore = config.ignore ?? [...DEFAULT_SYNC_IGNORE];
  }

  fileNameFor(name: string, className: ScriptClassName): string {
    return `${name}${SUFFIX_BY_CLASS[className]}`;
  }

  classNameForFile(fileName: string): { baseName: string; className: ScriptClassName } | null {
    const mapping = classifyRojoSource(fileName);
    if (!mapping || (mapping.kind !== 'Script' && mapping.kind !== 'LocalScript' && mapping.kind !== 'ModuleScript')) {
      return null;
    }
    return { baseName: mapping.instanceName ?? '', className: mapping.kind };
  }

  /** "game.ServerScriptService.A.B" + Script -> "ServerScriptService/A/B.server.lua". */
  instancePathToFilePath(instancePath: string, className: ScriptClassName): string {
    // Only the leading "game" is the DataModel prefix; a nested Instance may
    // legitimately be named "game".
    const segments = instancePath.split('.').filter((s) => s.length > 0);
    if (segments[0] === 'game') segments.shift();
    return this.instanceSegmentsToFilePath(segments, className);
  }

  /**
   * Throws when any segment cannot be represented as a portable file name.
   * Rojo refuses such names rather than encoding them, so we do too — an encoded
   * name would round-trip back into Studio as a different Instance name.
   */
  instanceSegmentsToFilePath(segments: string[], className: ScriptClassName): string {
    if (segments.length === 0) throw new Error('Invalid empty instance path');
    for (const segment of segments) {
      const reason = unsupportedInstanceNameReason(segment);
      if (reason) throw new Error(reason);
    }
    const leaf = segments[segments.length - 1];
    const dirs = segments.slice(0, -1).join('/');
    const file = this.fileNameFor(leaf, className);
    return dirs ? `${dirs}/${file}` : file;
  }

  /** Reverse of instancePathToFilePath. */
  filePathToInstancePath(relPath: string): { instancePath: string; className: ScriptClassName } | null {
    const normalized = relPath.replace(/\\/g, '/');
    const parts = normalized.split('/');
    const fileName = parts.pop() as string;
    const parsed = this.classNameForFile(fileName);
    if (!parsed) return null;
    const instancePath = [...parts, parsed.baseName].join('.');
    return { instancePath, className: parsed.className };
  }

  isIgnored(relPath: string): boolean {
    const normalized = relPath.replace(/\\/g, '/');
    return this.ignore.some((pattern) => globToRegExp(pattern).test(normalized));
  }

  /**
   * Three-way merge classification. `base` is the content at last sync, so we
   * can tell which side actually moved rather than blindly overwriting.
   */
  detectConflict(input: ConflictInput): ConflictKind {
    const { local, base, studio } = input;
    if (local === studio) return 'none';
    const localChanged = local !== base;
    const studioChanged = studio !== base;
    if (localChanged && studioChanged) return 'both';
    if (studioChanged) return 'studio';
    if (localChanged) return 'local';
    return 'none';
  }
}

// Minimal glob → RegExp supporting "**", "*" and literal segments. Deliberately
// small (no brace/charclass support) — enough for sync ignore lists.
function globToRegExp(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        // "**" matches across directory separators; consume an optional trailing slash.
        re += '.*';
        i++;
        if (glob[i + 1] === '/') i++;
      } else {
        re += '[^/]*';
      }
    } else if ('\\^$+?.()|{}[]'.includes(c)) {
      re += `\\${c}`;
    } else {
      re += c;
    }
  }
  return new RegExp(`^${re}$`);
}
