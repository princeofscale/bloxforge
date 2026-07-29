import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { classifyRojoSource, resolveProjectPath, resolveProjectRoot } from './source-mapper.js';

const MAX_SOURCE_BYTES = 5 * 1024 * 1024;
type Rename = (from: fs.PathLike, to: fs.PathLike) => void;
type Validate = (content: string, file: string) => void;

function contentHash(content: string): string {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`;
}

function diff(before: string, after: string): string {
  const oldLines = before.split('\n').map((line) => `-${line}`);
  const newLines = after.split('\n').map((line) => `+${line}`);
  return ['--- before', '+++ after', ...oldLines, ...newLines].join('\n');
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
      try { fs.unlinkSync(temporary); } catch {}
    }
  }

  read(relativePath: string): {
    path: string;
    content: string;
    contentHash: string;
    bytes: number;
  } {
    const file = this.file(relativePath, true);
    const content = fs.readFileSync(file, 'utf8');
    return {
      path: path.relative(this.root, file).split(path.sep).join('/'),
      content,
      contentHash: contentHash(content),
      bytes: Buffer.byteLength(content),
    };
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
    if (!options.dryRun) this.atomicWrite(resolveProjectPath(this.root, current.path), next);
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
    if (!options.dryRun) this.atomicWrite(file, options.content);
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
