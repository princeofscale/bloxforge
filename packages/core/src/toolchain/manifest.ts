import * as crypto from 'node:crypto';
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

/** Content hash of a file, or `undefined` when it does not exist. */
export function fileHash(file: string | undefined): string | undefined {
  if (!file) return undefined;
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  } catch {
    return undefined;
  }
}

/**
 * A toolchain plan is immutable, exactly like a Rojo syncback plan.
 *
 * `wally_*_plan` and `rokit_*_plan` described a change against a manifest and
 * lockfile that another process could rewrite before the matching `*_apply`
 * ran, and apply took only `confirm`. Two agents on one repository could
 * therefore review one plan and apply a different one. The hash covers the
 * operation, its arguments and the current content of both files, so any edit
 * in between invalidates it.
 */
export function planHashOf(operation: string, args: unknown, files: Array<string | undefined>): string {
  return crypto.createHash('sha256')
    .update(JSON.stringify({ operation, args, files: files.map((file) => fileHash(file) ?? 'absent') }))
    .digest('hex');
}

/** Thrown as a plain failing QualityCheck by every toolchain apply. */
export function planHashMismatch(expected: string | undefined, actual: string, planTool: string): string | undefined {
  if (expected === undefined || expected.trim() === '') {
    return `expectedPlanHash is required: run ${planTool} and pass the planHash it returns.`;
  }
  if (expected !== actual) {
    return `The manifest or lockfile changed after ${planTool} ran (expected planHash ${expected}, current ${actual}). Re-run the plan and review it before applying.`;
  }
  return undefined;
}

export function asStringMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
}
