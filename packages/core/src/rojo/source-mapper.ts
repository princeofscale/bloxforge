import * as fs from 'node:fs';
import * as path from 'node:path';
import type { RojoSourceKind, RojoSourceMapping } from './types.js';

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

function within(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function canonicalCandidate(candidate: string): string {
  let current = candidate;
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) throw new Error(`No existing parent for ${candidate}`);
    current = parent;
  }
  return path.join(fs.realpathSync(current), path.relative(current, candidate));
}

export function resolveProjectRoot(requested = process.cwd()): string {
  const allowed = fs.realpathSync(path.resolve(process.env.BLOXFORGE_PROJECT_ROOT?.trim() || process.cwd()));
  const candidate = fs.realpathSync(path.isAbsolute(requested) ? requested : path.resolve(allowed, requested));
  if (!within(allowed, candidate)) throw new Error(`Path must stay within project root ${allowed}`);
  return candidate;
}

export function resolveProjectPath(root: string, requested: string, mustExist = true): string {
  if (!requested || requested.startsWith('-')) throw new Error('Path must not be empty or option-shaped');
  const canonicalRoot = resolveProjectRoot(root);
  const candidate = path.resolve(canonicalRoot, requested);
  const checked = mustExist ? fs.realpathSync(candidate) : canonicalCandidate(candidate);
  if (!within(canonicalRoot, checked)) throw new Error(`Path must stay within project root ${canonicalRoot}`);
  return checked;
}

/**
 * Rojo never encodes Instance names that a portable file name cannot represent —
 * it refuses them. Encoding here would produce a name Rojo cannot decode, so the
 * next `rojo serve` would silently rename the Instance. Callers must surface the
 * reason as a conflict instead of writing a file.
 */
export function unsupportedInstanceNameReason(name: string): string | undefined {
  if (!name) return 'Instance name is empty';
  const illegal = [...name].find((char) => /[<>:"/\\|?*]/.test(char) || char.codePointAt(0)! < 32);
  if (illegal !== undefined) {
    const shown = illegal.codePointAt(0)! < 32
      ? `U+${illegal.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`
      : `"${illegal}"`;
    return `Instance name ${JSON.stringify(name)} contains ${shown}, which no portable file name can represent`;
  }
  if (/^[. ]|[. ]$/.test(name)) {
    return `Instance name ${JSON.stringify(name)} starts or ends with a dot or space, which is not portable`;
  }
  if (WINDOWS_RESERVED.test(name)) {
    return `Instance name ${JSON.stringify(name)} is reserved by Windows`;
  }
  return undefined;
}

/**
 * Minimal glob → RegExp supporting `**`, `*` and literal segments, matched
 * against a POSIX-style path relative to the project directory — the same shape
 * Rojo matches `globIgnorePaths` and `syncbackRules.ignorePaths` against.
 *
 * Braces and character classes are escaped to literals, so an unsupported
 * pattern matches *less* than Rojo's globset would. That is the safe direction:
 * for the syncback snapshot it means a file gets backed up unnecessarily rather
 * than being left out of a rollback.
 */
export function globToRegExp(glob: string): RegExp {
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

export function portablePathKey(relativePath: string): string {
  return relativePath.replace(/\\/g, '/').normalize('NFC').toLowerCase();
}

// Mirrors Rojo 7.7 `default_sync_rules()`. Order matters: the longest matching
// suffix must be tried first (`.server.lua` before `.lua`, `.meta.json` before
// `.json`). Matching is case-insensitive so a snapshot taken on a case-folding
// filesystem still covers every file Rojo can mutate.
const SCRIPT_SUFFIXES: ReadonlyArray<readonly [string, RojoSourceKind]> = [
  ['.server.lua', 'Script'],
  ['.server.luau', 'Script'],
  ['.client.lua', 'LocalScript'],
  ['.client.luau', 'LocalScript'],
  ['.plugin.lua', 'PluginScript'],
  ['.plugin.luau', 'PluginScript'],
  ['.lua', 'ModuleScript'],
  ['.luau', 'ModuleScript'],
];

const DATA_SUFFIXES: ReadonlyArray<readonly [string, RojoSourceKind]> = [
  ['.project.json', 'project'],
  ['.project.jsonc', 'project'],
  ['.meta.json', 'meta'],
  ['.meta.jsonc', 'meta'],
  ['.model.json', 'model'],
  ['.model.jsonc', 'model'],
  ['.rbxm', 'model'],
  ['.rbxmx', 'model'],
  ['.json', 'value'],
  ['.jsonc', 'value'],
  ['.toml', 'value'],
  ['.csv', 'value'],
  ['.txt', 'value'],
  ['.yml', 'value'],
  ['.yaml', 'value'],
];

export function classifyRojoSource(fileName: string): RojoSourceMapping | undefined {
  const lower = fileName.toLowerCase();
  for (const [suffix, kind] of SCRIPT_SUFFIXES) {
    if (lower.endsWith(suffix)) {
      return { kind, instanceName: fileName.slice(0, -suffix.length) || undefined };
    }
  }
  for (const [suffix, kind] of DATA_SUFFIXES) {
    if (lower.endsWith(suffix)) return { kind };
  }
  return undefined;
}
