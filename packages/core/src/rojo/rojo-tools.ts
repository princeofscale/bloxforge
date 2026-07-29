import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { RojoCommandRunner } from './command-runner.js';
import { discoverRojoProjects, selectRojoProject } from './project-discovery.js';
import { RojoProcessManager } from './process-manager.js';
import { RojoSourceEditor } from './source-editor.js';
import { resolveInstanceSource, resolveSourceInstance } from './sourcemap.js';
import { classifyRojoSource, resolveProjectPath } from './source-mapper.js';
import { QualityTools } from '../quality-tools.js';

const defaultRojoProcessManager = new RojoProcessManager();

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

  getVersion() {
    return this.runner.version();
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
    return {
      projectFile: project.projectFile,
      output: target,
      ...await this.runner.run(['build', project.projectFile, '--output', target], { cwd: project.root }),
    };
  }

  async generateSourcemap(root?: string, projectFile?: string, output = 'sourcemap.json') {
    const project = selectRojoProject(root, projectFile);
    const target = resolveProjectPath(project.root, output, false);
    return {
      projectFile: project.projectFile,
      output: target,
      ...await this.runner.run(['sourcemap', project.projectFile, '--output', target], { cwd: project.root }),
    };
  }

  resolveInstanceSource(root: string | undefined, projectFile: string | undefined, instancePath: string, sourcemap?: string) {
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
    if (!/\.(?:rbxl|rbxlx|rbxm|rbxmx)$/i.test(input)) {
      throw new Error('syncback input must be an RBXL, RBXLX, RBXM, or RBXMX file');
    }
    const version = await this.runner.version();
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
    return {
      projectFile: project.projectFile,
      input,
      dryRun: true,
      changes: result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
      ...result,
    };
  }

  async nativeSyncbackApply(
    root: string | undefined,
    projectFile: string | undefined,
    inputPlaceFile: string,
    confirm = false,
  ) {
    if (!confirm) throw new Error('Confirmation required: review rojo_syncback_plan, then pass confirm=true');
    const project = selectRojoProject(root, projectFile);
    const plan = await this.nativeSyncbackPlan(root, projectFile, inputPlaceFile);
    const snapshot = this.snapshotSources(project.root);
    const backupRoot = resolveProjectPath(
      project.root,
      path.join('.bloxforge', 'backups', `native-syncback-${new Date().toISOString().replace(/[:.]/g, '-')}`),
      false,
    );
    for (const relative of snapshot) {
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
      for (const relative of this.snapshotSources(project.root)) {
        if (!snapshot.has(relative)) fs.rmSync(path.join(project.root, relative), { force: true });
      }
      for (const relative of snapshot) {
        const target = path.join(project.root, relative);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(path.join(backupRoot, relative), target);
      }
      throw new Error(result.error ?? result.stderr ?? 'Rojo syncback failed and local sources were restored');
    }
    return {
      projectFile: project.projectFile,
      input: plan.input,
      dryRun: false,
      backupRoot,
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
        if (!file.endsWith('.lua')) return;
        const failures = this.quality.validateScriptSource(content, path.basename(file)).checks
          .filter((check) => check.available && !check.ok);
        if (failures.length > 0) {
          throw new Error(`Source validation failed: ${failures.map((failure) => `${failure.tool}: ${failure.error ?? failure.output}`).join('; ')}`);
        }
      }
      : undefined);
  }

  private snapshotSources(root: string): Set<string> {
    const files = new Set<string>();
    let bytes = 0;
    const walk = (directory: string) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (entry.name === '.git' || entry.name === '.bloxforge' || entry.name === 'node_modules' || entry.isSymbolicLink()) continue;
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) walk(absolute);
        else if (entry.isFile() && classifyRojoSource(entry.name)) {
          const relative = path.relative(root, absolute);
          files.add(relative);
          bytes += fs.statSync(absolute).size;
          if (files.size > 5000 || bytes > 100 * 1024 * 1024) {
            throw new Error('Native syncback recovery snapshot exceeds 5,000 files or 100 MiB');
          }
        }
      }
    };
    walk(root);
    return files;
  }
}
