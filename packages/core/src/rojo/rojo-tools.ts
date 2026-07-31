import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { RojoCommandRunner } from './command-runner.js';
import { discoverRojoProjects, isRojoProjectFile, selectRojoProject } from './project-discovery.js';
import { RojoProcessManager } from './process-manager.js';
import { RojoSourceEditor } from './source-editor.js';
import { resolveInstanceSource, resolveSourceInstance } from './sourcemap.js';
import { classifyRojoSource, globToRegExp, resolveProjectPath, resolveProjectRoot } from './source-mapper.js';
import type { RojoProject, RojoSourceKind } from './types.js';
import { QualityTools } from '../quality-tools.js';

const defaultRojoProcessManager = new RojoProcessManager();

const MAX_SNAPSHOT_FILES = 5000;
const MAX_SNAPSHOT_BYTES = 100 * 1024 * 1024;
const BUILD_EXTENSIONS = ['.rbxl', '.rbxlx', '.rbxm', '.rbxmx'];
const SYNCBACK_INPUT_EXTENSIONS = BUILD_EXTENSIONS;

interface SourceSnapshot {
  files: string[];
  directories: string[];
}

function hashFile(file: string): string {
  return `sha256:${createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`;
}

/**
 * Rejects an output path that would clobber project input. Rojo happily writes
 * wherever it is told, so `--output` must never land on a source file, a project
 * file, or an extension the command does not actually produce.
 */
function assertSafeOutput(
  project: RojoProject,
  target: string,
  allowedExtensions: string[],
  blockedKinds: RojoSourceKind[],
  label: string,
): void {
  const name = path.basename(target);
  const extension = path.extname(name).toLowerCase();
  if (!allowedExtensions.includes(extension)) {
    throw new Error(`${label} output must use one of ${allowedExtensions.join(', ')}; got "${extension || name}"`);
  }
  if (isRojoProjectFile(name)) throw new Error(`${label} output must not overwrite a Rojo project file`);
  if (path.resolve(target) === path.resolve(project.projectFile)) {
    throw new Error(`${label} output must not overwrite the selected project file`);
  }
  // The extension check already excludes script sources. What remains is the
  // overlap between legitimate outputs and Rojo inputs that share an extension:
  // `.rbxm` is both a build artefact and a model source, and `sourcemap.json`
  // is a `.json` output that classifies as a value source. Only the kinds a
  // given command can never legitimately produce are rejected.
  const mapping = classifyRojoSource(name);
  if (mapping && blockedKinds.includes(mapping.kind) && fs.existsSync(target)) {
    throw new Error(`${label} output must not overwrite the Rojo source ${name}`);
  }
}

export class RojoTools {
  private readonly quality = new QualityTools();
  constructor(
    private readonly runner = new RojoCommandRunner(),
    private readonly processes = defaultRojoProcessManager,
  ) {}

  detectProjects(root?: string) {
    return { projects: discoverRojoProjects(root).map((project) => ({ ...project, tree: undefined })) };
  }

  getProjectInfo(root?: string, projectFile?: string) {
    return selectRojoProject(root, projectFile);
  }

  getVersion(root?: string) {
    // Resolution depends on the project's toolchain manifest, so the lookup has
    // to start from the project directory rather than the server's cwd. A root
    // that does not resolve must surface: silently answering for the server's
    // own cwd reports a plausible version of an entirely different Rojo.
    return this.runner.version(root === undefined ? undefined : resolveProjectRoot(root));
  }

  async validateProject(root?: string, projectFile?: string) {
    const project = selectRojoProject(root, projectFile);
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'bloxforge-rojo-validate-'));
    try {
      const result = await this.runner.run(
        ['build', project.projectFile, '--output', path.join(temporary, 'validation.rbxl')],
        { cwd: project.root },
      );
      return { projectFile: project.projectFile, ...result };
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  }

  async serveStart(root?: string, projectFile?: string, host?: string, port?: number, placeId?: number) {
    const project = selectRojoProject(root, projectFile);
    if (placeId !== undefined && project.servePlaceIds?.length && !project.servePlaceIds.includes(placeId)) {
      throw new Error(`Place ${placeId} is not allowed by servePlaceIds in ${path.basename(project.projectFile)}`);
    }
    return this.processes.start(project.projectFile, {
      host: host ?? project.serveAddress ?? '127.0.0.1',
      port: port ?? project.servePort ?? 34872,
    });
  }

  serveStatus(root?: string, projectFile?: string) {
    const project = selectRojoProject(root, projectFile);
    return this.processes.status(project.projectFile) ?? {
      projectFile: project.projectFile,
      status: 'stopped',
    };
  }

  serveLogs(root?: string, projectFile?: string, limit?: number) {
    const project = selectRojoProject(root, projectFile);
    return this.processes.logs(project.projectFile, limit);
  }

  serveStop(root?: string, projectFile?: string) {
    const project = selectRojoProject(root, projectFile);
    return this.processes.stop(project.projectFile);
  }

  async buildProject(root?: string, projectFile?: string, output?: string) {
    if (!output) throw new Error('output is required');
    const project = selectRojoProject(root, projectFile);
    const target = resolveProjectPath(project.root, output, false);
    // A build may overwrite a previous artefact; it must never land on metadata.
    assertSafeOutput(project, target, BUILD_EXTENSIONS, ['meta', 'project'], 'rojo build');
    return {
      projectFile: project.projectFile,
      output: target,
      ...await this.runner.run(['build', project.projectFile, '--output', target], { cwd: project.root }),
    };
  }

  /**
   * `rojo sourcemap` emits only Script/LocalScript/ModuleScript unless told
   * otherwise, so a default sourcemap cannot resolve a Folder, a model, or any
   * other non-script Instance.
   */
  async generateSourcemap(root?: string, projectFile?: string, output = 'sourcemap.json', includeNonScripts = false) {
    const project = selectRojoProject(root, projectFile);
    const target = resolveProjectPath(project.root, output, false);
    // sourcemap.json is itself a `.json` value source, so only metadata and
    // model definitions are off limits — otherwise regeneration is impossible.
    assertSafeOutput(project, target, ['.json'], ['meta', 'model', 'project'], 'rojo sourcemap');
    return {
      projectFile: project.projectFile,
      output: target,
      includeNonScripts,
      ...await this.runner.run([
        'sourcemap',
        project.projectFile,
        '--output',
        target,
        ...(includeNonScripts ? ['--include-non-scripts'] : []),
      ], { cwd: project.root }),
    };
  }

  resolveInstanceSource(root: string | undefined, projectFile: string | undefined, instancePath: string | string[], sourcemap?: string) {
    const project = selectRojoProject(root, projectFile);
    return resolveInstanceSource(project.root, instancePath, sourcemap);
  }

  resolveSourceInstance(root: string | undefined, projectFile: string | undefined, sourcePath: string, sourcemap?: string) {
    const project = selectRojoProject(root, projectFile);
    return resolveSourceInstance(project.root, sourcePath, sourcemap);
  }

  readSource(root: string | undefined, projectFile: string | undefined, sourcePath: string) {
    return new RojoSourceEditor(selectRojoProject(root, projectFile).root).read(sourcePath);
  }

  patchSource(root: string | undefined, projectFile: string | undefined, sourcePath: string, options: {
    oldText: string;
    newText: string;
    expectedHash: string;
    dryRun?: boolean;
    validate?: boolean;
  }) {
    return this.editor(root, projectFile, options.validate).patch(sourcePath, options);
  }

  createSource(root: string | undefined, projectFile: string | undefined, sourcePath: string, options: {
    content: string;
    expectedAbsent?: boolean;
    dryRun?: boolean;
    validate?: boolean;
  }) {
    return this.editor(root, projectFile, options.validate).create(sourcePath, options);
  }

  deleteSource(root: string | undefined, projectFile: string | undefined, sourcePath: string, options: {
    expectedHash: string;
    confirm?: boolean;
    dryRun?: boolean;
  }) {
    return new RojoSourceEditor(selectRojoProject(root, projectFile).root).delete(sourcePath, options);
  }

  async nativeSyncbackPlan(root: string | undefined, projectFile: string | undefined, inputPlaceFile: string) {
    const project = selectRojoProject(root, projectFile);
    const input = resolveProjectPath(project.root, inputPlaceFile);
    if (!SYNCBACK_INPUT_EXTENSIONS.includes(path.extname(input).toLowerCase())) {
      throw new Error('syncback input must be an RBXL, RBXLX, RBXM, or RBXMX file');
    }
    const version = await this.runner.version(project.root);
    if (!version.features.includes('syncback')) {
      throw new Error(`Installed Rojo ${version.version ?? 'version'} does not support syncback; use Rojo 7.7.0+ or the bounded Studio adapter`);
    }
    const result = await this.runner.run([
      'syncback',
      project.projectFile,
      '--input',
      input,
      '--dry-run',
      '--list',
      '--non-interactive',
    ], { cwd: project.root });
    const changes = result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    return {
      projectFile: project.projectFile,
      input,
      dryRun: true,
      rojoVersion: version.version,
      planHash: this.syncbackPlanHash(project, input, changes, version.version),
      changes,
      ...result,
    };
  }

  async nativeSyncbackApply(
    root: string | undefined,
    projectFile: string | undefined,
    inputPlaceFile: string,
    confirm = false,
    expectedPlanHash?: string,
  ) {
    if (!confirm) throw new Error('Confirmation required: review rojo_syncback_plan, then pass confirm=true');
    const project = selectRojoProject(root, projectFile);
    const plan = await this.nativeSyncbackPlan(root, projectFile, inputPlaceFile);
    // A failed dry run still produces a hash; applying it would run a syncback
    // whose preview nobody could read.
    if (!plan.ok) {
      throw new Error(`Native syncback dry run failed; nothing was applied: ${plan.error ?? plan.stderr ?? 'unknown error'}`);
    }
    if (!expectedPlanHash || plan.planHash !== expectedPlanHash) {
      throw new Error('Native syncback plan changed since preview; review a fresh rojo_syncback_plan before applying');
    }
    const ignore = this.ignoredPaths(project);
    const snapshot = this.snapshotSources(project.root, plan.input, ignore);
    const backupRoot = resolveProjectPath(
      project.root,
      path.join('.bloxforge', 'backups', `native-syncback-${new Date().toISOString().replace(/[:.]/g, '-')}`),
      false,
    );
    for (const relative of snapshot.files) {
      const backup = path.join(backupRoot, relative);
      fs.mkdirSync(path.dirname(backup), { recursive: true });
      fs.copyFileSync(path.join(project.root, relative), backup);
    }
    const result = await this.runner.run([
      'syncback',
      project.projectFile,
      '--input',
      plan.input,
      '--list',
      '--non-interactive',
    ], { cwd: project.root });
    if (!result.ok) {
      this.restoreSources(project.root, plan.input, snapshot, backupRoot, ignore);
      throw new Error(`Rojo syncback failed and local sources were restored: ${result.error ?? result.stderr ?? 'unknown error'}`);
    }
    return {
      projectFile: project.projectFile,
      input: plan.input,
      dryRun: false,
      backupRoot,
      rojoVersion: plan.rojoVersion,
      changes: result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
      ...result,
    };
  }

  stopAll() {
    return this.processes.stopAll();
  }

  private editor(root?: string, projectFile?: string, validate = false): RojoSourceEditor {
    const project = selectRojoProject(root, projectFile);
    return new RojoSourceEditor(project.root, fs.renameSync, validate
      ? (content, file) => {
        if (!/\.luau?$/i.test(file)) return;
        const failures = this.quality.validateScriptSource(content, path.basename(file)).checks
          .filter((check) => check.available && !check.ok);
        if (failures.length > 0) {
          throw new Error(`Source validation failed: ${failures.map((failure) => `${failure.tool}: ${failure.error ?? failure.output}`).join('; ')}`);
        }
      }
      : undefined);
  }

  /**
   * The plan is only reproducible if everything it depends on is hashed: the
   * project config, the input place, the installed Rojo, the reported operations,
   * and the current content of every local file syncback could rewrite. Hashing
   * only the `--list` text would let a local edit slip in between preview and
   * apply without changing the hash.
   */
  private syncbackPlanHash(project: RojoProject, input: string, changes: string[], rojoVersion?: string): string {
    const ignore = this.ignoredPaths(project);
    const snapshot = this.snapshotSources(project.root, input, ignore);
    const digest = createHash('sha256');
    digest.update(JSON.stringify({
      rojoVersion: rojoVersion ?? 'unknown',
      projectFile: path.relative(project.root, project.projectFile).split(path.sep).join('/'),
      input: path.relative(project.root, input).split(path.sep).join('/'),
      changes,
      ignore,
      directories: snapshot.directories,
    }));
    digest.update(hashFile(project.projectFile));
    digest.update(hashFile(input));
    for (const relative of snapshot.files) {
      digest.update(`\0${relative}\0${hashFile(path.join(project.root, relative))}`);
    }
    return `sha256:${digest.digest('hex')}`;
  }

  /**
   * Snapshots every regular file under the project root, not only the ones the
   * classifier recognises. Rojo syncback writes `.luau`, `.jsonc`, YAML and
   * whole directories; a classifier-filtered snapshot silently leaves those out
   * of the backup and they cannot be restored when a partial syncback fails.
   *
   * The only files skipped are the ones the project itself declares off-limits
   * via `globIgnorePaths` and `syncbackRules.ignorePaths`. Rojo evaluates those
   * per path, relative to the project directory, and refuses to write to a match
   * — so excluding them shrinks the snapshot without shrinking what it can
   * restore. Deliberately *not* scoped to the dry run's reported paths: the
   * `--list` text is not a machine contract, and any path a parse missed would
   * be unrecoverable after a partial failure.
   */
  private snapshotSources(root: string, exclude?: string, ignore: readonly string[] = []): SourceSnapshot {
    const files: string[] = [];
    const directories: string[] = [];
    const patterns = ignore.map(globToRegExp);
    let bytes = 0;
    const walk = (directory: string) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (entry.name === '.git' || entry.name === '.bloxforge' || entry.name === 'node_modules' || entry.isSymbolicLink()) continue;
        const absolute = path.join(directory, entry.name);
        const relative = path.relative(root, absolute);
        if (entry.isDirectory()) {
          directories.push(relative);
          walk(absolute);
        } else if (entry.isFile()) {
          if (exclude && path.resolve(absolute) === path.resolve(exclude)) continue;
          const posix = relative.split(path.sep).join('/');
          if (patterns.some((pattern) => pattern.test(posix))) continue;
          files.push(relative);
          bytes += fs.statSync(absolute).size;
          if (files.length > MAX_SNAPSHOT_FILES || bytes > MAX_SNAPSHOT_BYTES) {
            throw new Error(`Native syncback recovery snapshot exceeds ${MAX_SNAPSHOT_FILES} files or ${MAX_SNAPSHOT_BYTES / (1024 * 1024)} MiB; exclude generated directories with globIgnorePaths or syncbackRules.ignorePaths`);
          }
        }
      }
    };
    walk(root);
    files.sort();
    directories.sort();
    return { files, directories };
  }

  /** Both lists Rojo consults before writing a syncback result. */
  private ignoredPaths(project: RojoProject): string[] {
    return [...(project.globIgnorePaths ?? []), ...(project.syncbackIgnorePaths ?? [])];
  }

  private restoreSources(root: string, input: string, snapshot: SourceSnapshot, backupRoot: string, ignore: readonly string[]): void {
    const current = this.snapshotSources(root, input, ignore);
    const keptFiles = new Set(snapshot.files);
    const keptDirectories = new Set(snapshot.directories);
    for (const relative of current.files) {
      if (!keptFiles.has(relative)) fs.rmSync(path.join(root, relative), { force: true });
    }
    for (const relative of snapshot.files) {
      const target = path.join(root, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(path.join(backupRoot, relative), target);
    }
    // Deepest first, so a directory tree syncback created is removed completely.
    for (const relative of [...current.directories].sort((a, b) => b.length - a.length)) {
      if (keptDirectories.has(relative)) continue;
      try { fs.rmdirSync(path.join(root, relative)); } catch { /* not empty or already gone */ }
    }
  }
}
