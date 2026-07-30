import * as fs from 'node:fs';
import * as path from 'node:path';
import type { RojoSourceMapping } from './types.js';

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

export function encodeInstanceName(name: string): string {
  if (!name) return '~empty';
  let encoded = [...name].map((char) =>
    /[~<>:"/\\|?*]/.test(char) || char.codePointAt(0)! < 32
      ? `~${char.codePointAt(0)!.toString(16).toUpperCase().padStart(2, '0')}`
      : char).join('');
  encoded = encoded.replace(/^[. ]+|[. ]+$/g, (value) =>
    [...value].map((char) => `~${char.codePointAt(0)!.toString(16).toUpperCase()}`).join(''));
  if (WINDOWS_RESERVED.test(encoded)) encoded = `~${encoded}`;
  return encoded;
}

export function portablePathKey(relativePath: string): string {
  return relativePath.replace(/\\/g, '/').normalize('NFC').toLowerCase();
}

export function classifyRojoSource(fileName: string): RojoSourceMapping | undefined {
  if (fileName.endsWith('.server.lua')) {
    return { kind: 'Script', instanceName: fileName.slice(0, -'.server.lua'.length) || undefined };
  }
  if (fileName.endsWith('.client.lua')) {
    return { kind: 'LocalScript', instanceName: fileName.slice(0, -'.client.lua'.length) || undefined };
  }
  if (fileName.endsWith('.lua')) {
    return { kind: 'ModuleScript', instanceName: fileName.slice(0, -'.lua'.length) || undefined };
  }
  if (fileName.endsWith('.meta.json')) return { kind: 'meta' };
  if (fileName.endsWith('.model.json') || /\.(?:rbxm|rbxmx)$/i.test(fileName)) return { kind: 'model' };
  if (fileName.endsWith('.project.json')) return { kind: 'project' };
  if (/\.(?:json|toml|txt|csv)$/i.test(fileName)) return { kind: 'value' };
  return undefined;
}
