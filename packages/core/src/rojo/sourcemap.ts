import * as fs from 'node:fs';
import * as path from 'node:path';
import { resolveProjectPath, resolveProjectRoot } from './source-mapper.js';

interface SourcemapNode {
  name?: string;
  className?: string;
  filePaths?: string[];
  children?: SourcemapNode[];
}

function readSourcemap(root: string, sourcemap = 'sourcemap.json'): SourcemapNode {
  const canonicalRoot = resolveProjectRoot(root);
  return JSON.parse(fs.readFileSync(resolveProjectPath(canonicalRoot, sourcemap), 'utf8')) as SourcemapNode;
}

function walk(node: SourcemapNode, segments: string[], visit: (node: SourcemapNode, segments: string[]) => boolean): boolean {
  const next = node.name ? [...segments, node.name] : segments;
  if (visit(node, next)) return true;
  for (const child of node.children ?? []) {
    if (walk(child, next, visit)) return true;
  }
  return false;
}

export function resolveInstanceSource(
  root: string,
  instancePath: string,
  sourcemap?: string,
): Record<string, unknown> {
  const wanted = instancePath.split('.').filter((segment) => segment && segment !== 'game');
  let match: { node: SourcemapNode; segments: string[] } | undefined;
  walk(readSourcemap(root, sourcemap), [], (node, segments) => {
    const normalized = segments[0] === 'game' ? segments.slice(1) : segments;
    if (normalized.join('.') !== wanted.join('.')) return false;
    match = { node, segments: normalized };
    return true;
  });
  return match
    ? { resolved: true, instancePath, sourcePaths: match.node.filePaths ?? [], className: match.node.className }
    : { resolved: false, instancePath, reason: 'instance not found in sourcemap' };
}

export function resolveSourceInstance(
  root: string,
  sourcePath: string,
  sourcemap?: string,
): Record<string, unknown> {
  const canonicalRoot = resolveProjectRoot(root);
  const source = resolveProjectPath(canonicalRoot, sourcePath);
  let match: { node: SourcemapNode; segments: string[] } | undefined;
  walk(readSourcemap(canonicalRoot, sourcemap), [], (node, segments) => {
    const paths = (node.filePaths ?? []).map((file) => path.resolve(canonicalRoot, file));
    if (!paths.includes(source)) return false;
    match = { node, segments: segments[0] === 'game' ? segments.slice(1) : segments };
    return true;
  });
  return match
    ? {
      resolved: true,
      sourcePath: path.relative(canonicalRoot, source).split(path.sep).join('/'),
      instancePath: `game.${match.segments.join('.')}`,
      className: match.node.className,
    }
    : { resolved: false, sourcePath, reason: 'source not found in sourcemap' };
}
