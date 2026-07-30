import * as fs from 'node:fs';
import * as path from 'node:path';
import { resolveProjectRoot } from '../rojo/source-mapper.js';
import { parseToml, type TomlTable } from './toml.js';

const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;

export interface ManifestFile {
  path: string;
  directory: string;
  mtimeMs: number;
  data: TomlTable;
}

export function readTomlFile(file: string): TomlTable {
  const size = fs.statSync(file).size;
  if (size > MAX_MANIFEST_BYTES) {
    throw new Error(`${path.basename(file)} is ${size} bytes, over the ${MAX_MANIFEST_BYTES}-byte manifest limit`);
  }
  return parseToml(fs.readFileSync(file, 'utf8'));
}

/** Nearest manifest at or above `root`, without leaving the allowed project root. */
export function findManifest(root: string, fileName: string): string | undefined {
  const boundary = resolveProjectRoot(process.env.BLOXFORGE_PROJECT_ROOT?.trim() || process.cwd());
  let current = resolveProjectRoot(root);
  for (;;) {
    const candidate = path.join(current, fileName);
    if (fs.existsSync(candidate)) return candidate;
    if (current === boundary) return undefined;
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

export function loadManifest(root: string, fileName: string): ManifestFile | undefined {
  const file = findManifest(root, fileName);
  if (!file) return undefined;
  return {
    path: file,
    directory: path.dirname(file),
    mtimeMs: fs.statSync(file).mtimeMs,
    data: readTomlFile(file),
  };
}

export function asStringMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
}
