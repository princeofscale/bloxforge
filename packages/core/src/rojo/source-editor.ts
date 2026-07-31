import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { classifyRojoSource, resolveProjectPath, resolveProjectRoot } from './source-mapper.js';

const MAX_SOURCE_BYTES = 5 * 1024 * 1024;
const DIFF_CONTEXT_LINES = 3;
const MAX_DIFF_LINES = 400;
type Rename = (from: fs.PathLike, to: fs.PathLike) => void;
type Validate = (content: string, file: string) => void;

export function contentHash(content: string): string {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`;
}

/**
 * Single-hunk unified diff. `patch` replaces one contiguous span and `create`
 * writes a whole file, so one hunk is exact rather than an approximation — and
 * it keeps a five-megabyte edit from returning a ten-megabyte diff.
 */
function diff(before: string, after: string): string {
  const oldLines = before.split('\n');
  const newLines = after.split('\n');
  let head = 0;
  while (head < oldLines.length && head < newLines.length && oldLines[head] === newLines[head]) head++;
  let tail = 0;
  while (
    tail < oldLines.length - head
    && tail < newLines.length - head
    && oldLines[oldLines.length - 1 - tail] === newLines[newLines.length - 1 - tail]
  ) tail++;

  const contextStart = Math.max(0, head - DIFF_CONTEXT_LINES);
  const oldStop = Math.min(oldLines.length, oldLines.length - tail + DIFF_CONTEXT_LINES);
  const newStop = Math.min(newLines.length, newLines.length - tail + DIFF_CONTEXT_LINES);
  const body: string[] = [];
  for (let i = contextStart; i < head; i++) body.push(` ${oldLines[i]}`);
  for (let i = head; i < oldLines.length - tail; i++) body.push(`-${oldLines[i]}`);
  for (let i = head; i < newLines.length - tail; i++) body.push(`+${newLines[i]}`);
  for (let i = oldLines.length - tail; i < oldStop; i++) body.push(` ${oldLines[i]}`);

  const truncated = body.length > MAX_DIFF_LINES;
  return [
    '--- before',
    '+++ after',
    `@@ -${contextStart + 1},${oldStop - contextStart} +${contextStart + 1},${newStop - contextStart} @@`,
    ...(truncated ? body.slice(0, MAX_DIFF_LINES) : body),
    ...(truncated ? [`... ${body.length - MAX_DIFF_LINES} more diff lines omitted`] : []),
  ].join('\n');
}

export class RojoSourceEditor {
  private readonly root: string;

  constructor(
    root = process.cwd(),
    private readonly rename: Rename = fs.renameSync,
    private readonly validate?: Validate,
  ) {
    this.root = resolveProjectRoot(root);
  }

  private file(relativePath: string, mustExist: boolean): string {
    const file = resolveProjectPath(this.root, relativePath, mustExist);
    if (!classifyRojoSource(path.basename(file))) throw new Error('Path is not a supported Rojo source file');
    return file;
  }

  private atomicWrite(file: string, content: string): void {
    if (Buffer.byteLength(content) > MAX_SOURCE_BYTES) throw new Error(`Source exceeds the ${MAX_SOURCE_BYTES}-byte limit`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.bloxforge-${process.pid}-${randomUUID()}.tmp`;
    try {
      const mode = fs.existsSync(file) ? fs.statSync(file).mode : 0o600;
      fs.writeFileSync(temporary, content, { encoding: 'utf8', mode });
      this.rename(temporary, file);
    } finally {
      try { fs.unlinkSync(temporary); } catch { /* already renamed or unavailable */ }
    }
  }

  /**
   * `expectedAbsent` has to be enforced by the kernel, not by an earlier
   * `existsSync`: between the check and the write another process can create the
   * file, and a rename would silently overwrite it.
   */
  private exclusiveWrite(file: string, content: string, relativePath: string): void {
    if (Buffer.byteLength(content) > MAX_SOURCE_BYTES) throw new Error(`Source exceeds the ${MAX_SOURCE_BYTES}-byte limit`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    let handle: number;
    try {
      handle = fs.openSync(file, 'wx', 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new Error(`Source already exists: ${relativePath}`);
      }
      throw error;
    }
    try {
      fs.writeFileSync(handle, content, 'utf8');
    } finally {
      fs.closeSync(handle);
    }
  }

  read(relativePath: string): {
    path: string;
    content: string;
    contentHash: string;
    bytes: number;
  } {
    const file = this.file(relativePath, true);
    // Bound the read, not only the write: an oversized file would otherwise be
    // pulled into memory and returned in full over the tool channel.
    const size = fs.statSync(file).size;
    if (size > MAX_SOURCE_BYTES) {
      throw new Error(`${path.relative(this.root, file)} is ${size} bytes, over the ${MAX_SOURCE_BYTES}-byte read limit`);
    }
    const content = fs.readFileSync(file, 'utf8');
    return {
      path: path.relative(this.root, file).split(path.sep).join('/'),
      content,
      contentHash: contentHash(content),
      bytes: Buffer.byteLength(content),
    };
  }

  /**
   * Re-verifies the hash immediately before the mutation. Validation and diffing
   * happen between the read and the write, and a concurrent editor in that window
   * would otherwise be overwritten with no conflict reported.
   *
   * ponytail: narrows the window, does not close it. A cross-process lock file
   * is the upgrade if two BloxForge servers ever share a project root.
   */
  private assertUnchanged(relativePath: string, expectedHash: string): void {
    if (this.read(relativePath).contentHash !== expectedHash) {
      throw new Error(`Content hash conflict for ${relativePath}: the file changed while the edit was being prepared`);
    }
  }

  patch(
    relativePath: string,
    options: {
      oldText: string;
      newText: string;
      expectedHash: string;
      dryRun?: boolean;
    },
  ) {
    const current = this.read(relativePath);
    if (current.contentHash !== options.expectedHash) {
      throw new Error(`Content hash conflict for ${current.path}: expected ${options.expectedHash}, found ${current.contentHash}`);
    }
    if (!options.oldText) throw new Error('oldText is required');
    const first = current.content.indexOf(options.oldText);
    if (first < 0) throw new Error('oldText was not found');
    if (current.content.indexOf(options.oldText, first + options.oldText.length) >= 0) {
      throw new Error('oldText matches multiple locations');
    }
    const next = current.content.slice(0, first) + options.newText + current.content.slice(first + options.oldText.length);
    this.validate?.(next, current.path);
    if (!options.dryRun) {
      this.assertUnchanged(relativePath, options.expectedHash);
      this.atomicWrite(resolveProjectPath(this.root, current.path), next);
    }
    return {
      path: current.path,
      applied: options.dryRun !== true,
      beforeHash: current.contentHash,
      afterHash: contentHash(next),
      diff: diff(current.content, next),
    };
  }

  create(
    relativePath: string,
    options: { content: string; expectedAbsent?: boolean; dryRun?: boolean },
  ) {
    const file = this.file(relativePath, false);
    if (fs.existsSync(file)) throw new Error(`Source already exists: ${relativePath}`);
    if (!options.dryRun && options.expectedAbsent !== true) {
      throw new Error('expectedAbsent=true is required before creating a source file');
    }
    this.validate?.(options.content, relativePath);
    if (!options.dryRun) this.exclusiveWrite(file, options.content, relativePath);
    return {
      path: path.relative(this.root, file).split(path.sep).join('/'),
      applied: options.dryRun !== true,
      afterHash: contentHash(options.content),
      diff: diff('', options.content),
    };
  }

  delete(
    relativePath: string,
    options: { expectedHash: string; confirm?: boolean; dryRun?: boolean },
  ) {
    const current = this.read(relativePath);
    if (current.contentHash !== options.expectedHash) {
      throw new Error(`Content hash conflict for ${current.path}: expected ${options.expectedHash}, found ${current.contentHash}`);
    }
    if (!options.dryRun && options.confirm !== true) {
      throw new Error('Confirmation required: pass confirm=true to delete a source file');
    }
    let backupPath: string | undefined;
    if (!options.dryRun) {
      const backupRelative = path.join(
        '.bloxforge',
        'backups',
        new Date().toISOString().replace(/[:.]/g, '-'),
        current.path,
      );
      const backup = resolveProjectPath(this.root, backupRelative, false);
      this.assertUnchanged(relativePath, options.expectedHash);
      this.atomicWrite(backup, current.content);
      fs.unlinkSync(resolveProjectPath(this.root, current.path));
      backupPath = backup;
    }
    return {
      path: current.path,
      applied: options.dryRun !== true,
      beforeHash: current.contentHash,
      backupPath,
      diff: diff(current.content, ''),
    };
  }
}
