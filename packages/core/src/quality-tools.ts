import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { isRojoProjectFile } from './rojo/project-discovery.js';
import { resolveToolCommand } from './toolchain/resolver.js';
import { WallyTools } from './toolchain/wally-tools.js';

const TOOL_COMMANDS = ['luau-analyze', 'luau-lsp', 'stylua', 'selene', 'rojo', 'rokit', 'aftman', 'wally', 'lune'] as const;
export type QualityCommand = typeof TOOL_COMMANDS[number];
const MAX_OUTPUT_BYTES = 1024 * 1024;

function within(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function allowedProjectRoot(root: string): string {
  const candidate = fs.realpathSync(path.resolve(root));
  if (process.env.NODE_ENV === 'test') return candidate;
  const allowed = fs.realpathSync(path.resolve(process.env.BLOXFORGE_PROJECT_ROOT?.trim() || process.cwd()));
  if (!within(allowed, candidate)) throw new Error(`Project root must stay within ${allowed}`);
  return candidate;
}

function safeExistingPath(root: string, requested: string, label: string): { path?: string; error?: string } {
  if (!requested || requested.startsWith('-')) return { error: `${label} must not be an option` };
  const resolved = path.resolve(root, requested);
  if (!within(root, resolved)) return { error: `${label} must stay within project root` };
  try {
    const real = fs.realpathSync(resolved);
    if (!within(fs.realpathSync(root), real)) return { error: `${label} must stay within project root` };
    return { path: real };
  } catch {
    return { error: `${label} does not exist` };
  }
}

function safeOutputPath(root: string, requested: string): { path?: string; error?: string } {
  if (!requested || requested.startsWith('-')) return { error: 'output must not be an option' };
  const resolved = path.resolve(root, requested);
  if (!within(root, resolved)) return { error: 'output must stay within project root' };
  try {
    const realParent = fs.realpathSync(path.dirname(resolved));
    if (!within(fs.realpathSync(root), realParent)) return { error: 'output must stay within project root' };
    return { path: resolved };
  } catch {
    return { error: 'output parent directory does not exist' };
  }
}

export interface QualityCheck {
  tool: QualityCommand;
  available: boolean;
  ok: boolean;
  output?: string;
  error?: string;
  exitCode?: number;
}

interface CommandFailure extends Error {
  code?: string;
  stdout?: string | Buffer;
  stderr?: string | Buffer;
}

interface SourcemapNode {
  name?: string;
  children?: SourcemapNode[];
  [key: string]: unknown;
}

function commandFailure(error: unknown): CommandFailure {
  return error instanceof Error ? error as CommandFailure : new Error(String(error));
}

export interface RobloxProject {
  root: string;
  files: Record<string, string>;
  availableTools: QualityCommand[];
}

/**
 * Availability is per project, not per machine. A tool a `rokit.toml` pins but
 * has not installed is *not* available, even when a global copy sits on PATH —
 * reporting it available is how an unpinned version ends up running.
 */
export function hasCommand(command: QualityCommand, root?: string): boolean {
  const resolved = resolveToolCommand(command, root);
  if (resolved.installHint) return false;
  // Deliberately not memoised. Caching the probe per resolved command makes
  // availability sticky across an uninstall of an unpinned tool — the resolver's
  // own cache only invalidates on manifest and shim mtimes, and a bare PATH
  // resolution has neither. A `--version` spawn is the cheaper of the two.
  try {
    execFileSync(resolved.executable, [...resolved.prefixArgs, '--version'], {
      cwd: root,
      stdio: 'pipe',
      timeout: 3000,
      windowsHide: true,
    });
    return true;
  } catch (error: unknown) {
    return commandFailure(error).code !== 'ENOENT';
  }
}

function projectFiles(root: string): Record<string, string> {
  // Same predicate the Rojo discovery uses, so `.project.jsonc` is not invisible
  // here. An unreadable directory simply has no project files; it must not take
  // down project detection for every other tool.
  let discovered: string[] = [];
  try {
    discovered = fs.readdirSync(root).filter(isRojoProjectFile).sort();
  } catch { /* unreadable or missing directory */ }
  const names = [
    ...discovered,
    'rojo.json', 'sourcemap.json',
    'selene.toml', 'stylua.toml', 'wally.toml', 'wally.lock', 'rokit.toml', 'aftman.toml',
  ];
  return Object.fromEntries(names
    .map((name) => [name, fs.existsSync(path.join(root, name)) ? path.join(root, name) : undefined] as const)
    .filter((entry): entry is readonly [string, string] => entry[1] !== undefined));
}

function selectedProjectFile(project: RobloxProject): { path?: string; error?: string } {
  const candidates = Object.entries(project.files)
    .filter(([name]) => isRojoProjectFile(name))
    .map(([, file]) => file);
  if (candidates.length === 0) return { error: 'Rojo project file not found' };
  if (candidates.length > 1) return { error: 'Multiple Rojo project files found; use the rojo_* tools and select projectFile explicitly' };
  return { path: candidates[0] };
}

export function run(command: QualityCommand, args: string[], options: { cwd?: string; input?: string } = {}): QualityCheck {
  const resolved = resolveToolCommand(command, options.cwd);
  // A pin with no installed shim reports the install step rather than running
  // whatever copy of the tool happens to be on PATH.
  if (resolved.installHint) return { tool: command, available: false, ok: false, error: resolved.installHint };
  // No `--version` probe first. It doubled the process count for every quality
  // call, and it was a TOCTOU: the tool could vanish between the probe and the
  // real run. ENOENT from the run itself is the same answer, one process later.
  try {
    const output = execFileSync(resolved.executable, [...resolved.prefixArgs, ...args], {
      cwd: options.cwd,
      input: options.input,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 120000,
      maxBuffer: MAX_OUTPUT_BYTES,
      windowsHide: true,
    });
    return { tool: command, available: true, ok: true, output: output.trim() };
  } catch (error: unknown) {
    const failure = commandFailure(error);
    if (failure.code === 'ENOENT') {
      return { tool: command, available: false, ok: false, error: `${command} is not installed` };
    }
    return {
      tool: command,
      available: true,
      ok: false,
      output: [failure.stdout, failure.stderr].filter(Boolean).join('\n').slice(0, MAX_OUTPUT_BYTES).trim(),
      error:
        failure.code === 'ETIMEDOUT'
          ? `${command} timed out after 120000ms`
          : failure.code === 'ENOBUFS'
            ? `${command} exceeded the ${MAX_OUTPUT_BYTES}-byte output limit`
            : failure.message,
      exitCode: typeof (failure as CommandFailure & { status?: unknown }).status === 'number'
        ? (failure as CommandFailure & { status: number }).status
        : undefined,
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
          // Availability is resolved against this project, so a tool pinned but
          // not installed reports unavailable even with a global copy on PATH.
          availableTools: TOOL_COMMANDS.filter((tool) => hasCommand(tool, current)),
        };
      }
      const parent = path.dirname(current);
      if (parent === current || !within(boundary, parent)) break;
      current = parent;
    }
    const fallbackRoot = path.resolve(root);
    return {
      root: fallbackRoot,
      files: {},
      availableTools: TOOL_COMMANDS.filter((tool) => hasCommand(tool, fallbackRoot)),
    };
  }

  validateScriptSource(source: string, fileName = 'script.server.lua'): { checks: QualityCheck[] } {
    if (typeof source !== 'string') throw new Error('source is required');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloxforge-quality-'));
    try {
      const file = path.join(dir, path.basename(fileName));
      fs.writeFileSync(file, source, 'utf8');
      return {
        checks: [
          run('luau-analyze', [file]),
          run('selene', [file]),
          run('stylua', ['--check', file]),
        ],
      };
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  formatScriptPreview(source: string, fileName = 'script.server.lua'): QualityCheck {
    if (typeof source !== 'string') throw new Error('source is required');
    const safeName = path.basename(fileName);
    if (safeName.startsWith('-')) {
      return { tool: 'stylua', available: hasCommand('stylua'), ok: false, error: 'fileName must not be an option' };
    }
    return run('stylua', ['--stdin-filepath', safeName], { input: source });
  }

  resolveInstanceSourceFile(instancePath: string, root = process.cwd()): Record<string, unknown> {
    const project = this.detectRobloxProject(root);
    const sourcemapPath = project.files['sourcemap.json'];
    if (!sourcemapPath) return { resolved: false, reason: 'sourcemap.json not found', instancePath };
    let sourcemap: SourcemapNode;
    try { sourcemap = JSON.parse(fs.readFileSync(sourcemapPath, 'utf8')) as SourcemapNode; } catch (error) {
      return { resolved: false, reason: `invalid sourcemap: ${error instanceof Error ? error.message : String(error)}`, instancePath };
    }
    const target = instancePath.split('.').filter(Boolean).reduce<SourcemapNode | undefined>((node, segment) => {
      if (!node || typeof node !== 'object') return undefined;
      return node.children?.find((child) => child.name === segment);
    }, sourcemap);
    return target ? { resolved: true, instancePath, node: target } : { resolved: false, instancePath, reason: 'instance not found' };
  }

  getDependencyGraph(root = process.cwd()): Record<string, unknown> {
    const project = this.detectRobloxProject(root);
    const lock = project.files['wally.lock'];
    // Was a line regexp that collected TOML key names ("name", "dependencies",
    // "registry") instead of packages. Delegates to the real lockfile reader now.
    let dependencies: string[] = [];
    let error: string | undefined;
    if (lock) {
      try {
        dependencies = new WallyTools().dependencyGraph(project.root).nodes.map((node) => node.id);
      } catch (parseError) {
        error = parseError instanceof Error ? parseError.message : String(parseError);
      }
    }
    return {
      root: project.root,
      manifest: project.files['wally.toml'],
      lockfile: lock,
      dependencies,
      ...(error ? { error } : {}),
    };
  }

  installWallyPackages(root = process.cwd(), confirm = false): QualityCheck {
    const project = this.detectRobloxProject(root);
    if (!confirm) return { tool: 'wally', available: hasCommand('wally', project.root), ok: false, error: 'Confirmation required: pass confirm=true to install packages' };
    return run('wally', ['install'], { cwd: project.root });
  }

  runProjectTests(root = process.cwd(), script?: string): QualityCheck {
    const project = this.detectRobloxProject(root);
    if (!script) return { tool: 'lune', available: hasCommand('lune', project.root), ok: false, error: 'script is required' };
    const checked = safeExistingPath(project.root, script, 'script');
    if (!checked.path) return { tool: 'lune', available: hasCommand('lune', project.root), ok: false, error: checked.error };
    return run('lune', ['run', checked.path], { cwd: project.root });
  }

  validateWithLuauLsp(root = process.cwd(), files: string[] = ['.']): QualityCheck {
    const project = this.detectRobloxProject(root);
    const checked = files.map(file => safeExistingPath(project.root, file, 'file'));
    const invalid = checked.find(result => !result.path);
    if (invalid) return { tool: 'luau-lsp', available: hasCommand('luau-lsp', project.root), ok: false, error: invalid.error };
    const args = ['analyze', ...checked.map(result => result.path!)];
    if (project.files['sourcemap.json']) args.push('--sourcemap', project.files['sourcemap.json']);
    return run('luau-lsp', args, { cwd: project.root });
  }

  generateRojoSourcemap(root = process.cwd(), output = 'sourcemap.json'): QualityCheck {
    const project = this.detectRobloxProject(root);
    const selected = selectedProjectFile(project);
    if (!selected.path) return { tool: 'rojo', available: hasCommand('rojo', project.root), ok: false, error: selected.error };
    const checked = safeOutputPath(project.root, output);
    if (!checked.path) return { tool: 'rojo', available: hasCommand('rojo', project.root), ok: false, error: checked.error };
    return run('rojo', ['sourcemap', selected.path, '--output', checked.path], { cwd: project.root });
  }

  buildRojoProject(root = process.cwd(), output?: string): QualityCheck {
    const project = this.detectRobloxProject(root);
    const selected = selectedProjectFile(project);
    if (!selected.path) return { tool: 'rojo', available: hasCommand('rojo', project.root), ok: false, error: selected.error };
    if (!output) return { tool: 'rojo', available: hasCommand('rojo', project.root), ok: false, error: 'output is required' };
    const checked = safeOutputPath(project.root, output);
    if (!checked.path) return { tool: 'rojo', available: hasCommand('rojo', project.root), ok: false, error: checked.error };
    return run('rojo', ['build', selected.path, '--output', checked.path], { cwd: project.root });
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
