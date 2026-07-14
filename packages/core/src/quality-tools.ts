import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const TOOL_COMMANDS = ['luau-analyze', 'luau-lsp', 'stylua', 'selene', 'rojo', 'rokit', 'wally', 'lune'] as const;
type QualityCommand = typeof TOOL_COMMANDS[number];

function within(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function allowedProjectRoot(root: string): string {
  const candidate = path.resolve(root);
  if (process.env.NODE_ENV === 'test') return candidate;
  const allowed = path.resolve(process.env.BLOXFORGE_PROJECT_ROOT?.trim() || process.cwd());
  if (!within(allowed, candidate)) throw new Error(`Project root must stay within ${allowed}`);
  return candidate;
}

export interface QualityCheck {
  tool: QualityCommand;
  available: boolean;
  ok: boolean;
  output?: string;
  error?: string;
  exitCode?: number;
}

export interface RobloxProject {
  root: string;
  files: Record<string, string>;
  availableTools: QualityCommand[];
}

function hasCommand(command: QualityCommand): boolean {
  try {
    execFileSync(command, ['--version'], { stdio: 'pipe', timeout: 3000 });
    return true;
  } catch (error: any) {
    return error?.code !== 'ENOENT';
  }
}

function projectFiles(root: string): Record<string, string> {
  const names = [
    'default.project.json', 'rojo.json', 'rojo.project.json', 'sourcemap.json',
    'selene.toml', 'stylua.toml', 'wally.toml', 'wally.lock', 'rokit.toml', 'aftman.toml',
  ];
  return Object.fromEntries(names
    .map((name) => [name, fs.existsSync(path.join(root, name)) ? path.join(root, name) : undefined] as const)
    .filter((entry): entry is readonly [string, string] => entry[1] !== undefined));
}

function run(command: QualityCommand, args: string[], options: { cwd?: string; input?: string } = {}): QualityCheck {
  if (!hasCommand(command)) return { tool: command, available: false, ok: false, error: `${command} is not installed` };
  try {
    const output = execFileSync(command, args, {
      cwd: options.cwd,
      input: options.input,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 120000,
      maxBuffer: 10 * 1024 * 1024,
    });
    return { tool: command, available: true, ok: true, output: output.trim() };
  } catch (error: any) {
    return {
      tool: command,
      available: true,
      ok: false,
      output: [error?.stdout, error?.stderr].filter(Boolean).join('\n').trim(),
      error: error?.message ?? String(error),
      exitCode: typeof error?.status === 'number' ? error.status : undefined,
    };
  }
}

export class QualityTools {
  detectRobloxProject(root = process.cwd()): RobloxProject {
    const boundary = process.env.NODE_ENV === 'test'
      ? path.parse(path.resolve(root)).root
      : path.resolve(process.env.BLOXFORGE_PROJECT_ROOT?.trim() || process.cwd());
    let current = allowedProjectRoot(root);
    while (true) {
      const files = projectFiles(current);
      if (Object.keys(files).length > 0) {
        return {
          root: current,
          files,
          availableTools: TOOL_COMMANDS.filter(hasCommand),
        };
      }
      const parent = path.dirname(current);
      if (parent === current || !within(boundary, parent)) break;
      current = parent;
    }
    return { root: path.resolve(root), files: {}, availableTools: TOOL_COMMANDS.filter(hasCommand) };
  }

  validateScriptSource(source: string, fileName = 'script.server.lua'): { checks: QualityCheck[] } {
    if (typeof source !== 'string') throw new Error('source is required');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloxforge-quality-'));
    const file = path.join(dir, path.basename(fileName));
    fs.writeFileSync(file, source, 'utf8');
    const checks = [
      run('luau-analyze', [file]),
      run('selene', [file]),
      run('stylua', ['--check', file]),
    ];
    fs.rmSync(dir, { recursive: true, force: true });
    return { checks };
  }

  formatScriptPreview(source: string, fileName = 'script.server.lua'): QualityCheck {
    if (typeof source !== 'string') throw new Error('source is required');
    return run('stylua', ['--stdin-filepath', fileName], { input: source });
  }

  resolveInstanceSourceFile(instancePath: string, root = process.cwd()): Record<string, unknown> {
    const project = this.detectRobloxProject(root);
    const sourcemapPath = project.files['sourcemap.json'];
    if (!sourcemapPath) return { resolved: false, reason: 'sourcemap.json not found', instancePath };
    let sourcemap: any;
    try { sourcemap = JSON.parse(fs.readFileSync(sourcemapPath, 'utf8')); } catch (error) {
      return { resolved: false, reason: `invalid sourcemap: ${error instanceof Error ? error.message : String(error)}`, instancePath };
    }
    const target = instancePath.split('.').filter(Boolean).reduce((node, segment) => {
      if (!node || typeof node !== 'object') return undefined;
      return (node as any).children?.find((child: any) => child.name === segment);
    }, sourcemap);
    return target ? { resolved: true, instancePath, node: target } : { resolved: false, instancePath, reason: 'instance not found' };
  }

  getDependencyGraph(root = process.cwd()): Record<string, unknown> {
    const project = this.detectRobloxProject(root);
    const lock = project.files['wally.lock'];
    const dependencies: string[] = [];
    if (lock) {
      for (const line of fs.readFileSync(lock, 'utf8').split(/\r?\n/)) {
        const match = line.match(/^\s*([\w.-]+)\s*=/);
        if (match && match[1] !== 'version') dependencies.push(match[1]);
      }
    }
    return { root: project.root, manifest: project.files['wally.toml'], lockfile: lock, dependencies: [...new Set(dependencies)] };
  }

  installWallyPackages(root = process.cwd(), confirm = false): QualityCheck {
    if (!confirm) return { tool: 'wally', available: hasCommand('wally'), ok: false, error: 'Confirmation required: pass confirm=true to install packages' };
    return run('wally', ['install'], { cwd: this.detectRobloxProject(root).root });
  }

  runProjectTests(root = process.cwd(), script?: string): QualityCheck {
    if (!script) return { tool: 'lune', available: hasCommand('lune'), ok: false, error: 'script is required' };
    const project = this.detectRobloxProject(root);
    const scriptPath = path.resolve(project.root, script);
    if (!within(project.root, scriptPath)) return { tool: 'lune', available: hasCommand('lune'), ok: false, error: 'script must stay within project root' };
    return run('lune', ['run', scriptPath], { cwd: project.root });
  }

  validateWithLuauLsp(root = process.cwd(), files: string[] = ['.']): QualityCheck {
    const project = this.detectRobloxProject(root);
    const args = ['analyze', ...files];
    if (project.files['sourcemap.json']) args.push('--sourcemap', project.files['sourcemap.json']);
    return run('luau-lsp', args, { cwd: project.root });
  }

  generateRojoSourcemap(root = process.cwd(), output = 'sourcemap.json'): QualityCheck {
    const project = this.detectRobloxProject(root);
    const projectFile = project.files['default.project.json'] ?? project.files['rojo.project.json'];
    if (!projectFile) return { tool: 'rojo', available: hasCommand('rojo'), ok: false, error: 'Rojo project file not found' };
    const outputPath = path.resolve(project.root, output);
    if (!within(project.root, outputPath)) return { tool: 'rojo', available: hasCommand('rojo'), ok: false, error: 'output must stay within project root' };
    return run('rojo', ['sourcemap', projectFile, '--output', outputPath], { cwd: project.root });
  }

  buildRojoProject(root = process.cwd(), output?: string): QualityCheck {
    const project = this.detectRobloxProject(root);
    const projectFile = project.files['default.project.json'] ?? project.files['rojo.project.json'];
    if (!projectFile) return { tool: 'rojo', available: hasCommand('rojo'), ok: false, error: 'Rojo project file not found' };
    if (!output) return { tool: 'rojo', available: hasCommand('rojo'), ok: false, error: 'output is required' };
    const outputPath = path.resolve(project.root, output);
    if (!within(project.root, outputPath)) return { tool: 'rojo', available: hasCommand('rojo'), ok: false, error: 'output must stay within project root' };
    return run('rojo', ['build', projectFile, '--output', outputPath], { cwd: project.root });
  }

  runQualityGate(root = process.cwd()): { project: RobloxProject; checks: QualityCheck[] } {
    const project = this.detectRobloxProject(root);
    const checks = [
      run('rojo', ['sourcemap'], { cwd: project.root }),
      run('selene', ['.'], { cwd: project.root }),
      run('stylua', ['--check', '.'], { cwd: project.root }),
      this.validateWithLuauLsp(project.root),
    ];
    return { project, checks };
  }
}
