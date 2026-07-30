import * as fs from 'node:fs';
import * as path from 'node:path';
import { resolveProjectPath, resolveProjectRoot } from './source-mapper.js';

interface SourcemapNode {
  name?: string;
  className?: string;
  filePaths?: string[];
  children?: SourcemapNode[];
}

const MAX_SOURCEMAP_BYTES = 32 * 1024 * 1024;
const MAX_SOURCEMAP_DEPTH = 200;

function readSourcemap(root: string, sourcemap = 'sourcemap.json'): SourcemapNode {
  const canonicalRoot = resolveProjectRoot(root);
  const file = resolveProjectPath(canonicalRoot, sourcemap);
  const size = fs.statSync(file).size;
  if (size > MAX_SOURCEMAP_BYTES) {
    throw new Error(`Sourcemap ${path.basename(file)} is ${size} bytes, over the ${MAX_SOURCEMAP_BYTES}-byte limit`);
  }
  return JSON.parse(fs.readFileSync(file, 'utf8')) as SourcemapNode;
}

function walk(
  node: SourcemapNode,
  segments: string[],
  visit: (node: SourcemapNode, segments: string[]) => boolean,
  depth = 0,
): boolean {
  if (depth > MAX_SOURCEMAP_DEPTH) throw new Error(`Sourcemap nesting exceeds ${MAX_SOURCEMAP_DEPTH} levels`);
  const next = node.name ? [...segments, node.name] : segments;
  if (visit(node, next)) return true;
  for (const child of node.children ?? []) {
    if (walk(child, next, visit, depth + 1)) return true;
  }
  return false;
}

/**
 * A dotted path cannot express an Instance whose name contains a dot, so
 * callers that know the real hierarchy should pass segments instead.
 */
export function instancePathSegments(instancePath: string | string[]): string[] {
  if (Array.isArray(instancePath)) {
    const segments = instancePath.filter((segment) => segment.length > 0);
    return segments[0] === 'game' ? segments.slice(1) : segments;
  }
  return instancePath.split('.').filter((segment) => segment && segment !== 'game');
}

export function resolveInstanceSource(
  root: string,
  instancePath: string | string[],
  sourcemap?: string,
): Record<string, unknown> {
  const wanted = instancePathSegments(instancePath);
  const display = Array.isArray(instancePath) ? `game.${wanted.join('.')}` : instancePath;
  let match: { node: SourcemapNode; segments: string[] } | undefined;
  walk(readSourcemap(root, sourcemap), [], (node, segments) => {
    const normalized = segments[0] === 'game' ? segments.slice(1) : segments;
    if (normalized.length !== wanted.length || normalized.some((segment, index) => segment !== wanted[index])) {
      return false;
    }
    match = { node, segments: normalized };
    return true;
  });
  return match
    ? {
      resolved: true,
      instancePath: display,
      instancePathSegments: match.segments,
      sourcePaths: match.node.filePaths ?? [],
      className: match.node.className,
    }
    : { resolved: false, instancePath: display, instancePathSegments: wanted, reason: 'instance not found in sourcemap' };
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
      instancePathSegments: match.segments,
      className: match.node.className,
    }
    : { resolved: false, sourcePath, reason: 'source not found in sourcemap' };
}
