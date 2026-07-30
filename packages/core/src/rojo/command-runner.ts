import { execFile, spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export interface RojoCommand {
  executable: string;
  prefixArgs: string[];
  source: 'path' | 'environment' | 'rokit' | 'aftman' | 'test';
  /** Toolchain manifest that selected this command, when one did. */
  manifest?: string;
  /** Set when a manifest declares Rojo but no installed shim was found. */
  installHint?: string;
}

export interface RojoCommandResult {
  available: boolean;
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode?: number;
  error?: string;
}

export interface RojoVersionResult extends RojoCommandResult {
  version?: string;
  features: string[];
  command: RojoCommand;
}

const MAX_OUTPUT_BYTES = 1024 * 1024;
type CommandError = Error & { code?: string | number };

function commandErrorMessage(error: CommandError, timeoutMs: number, command: RojoCommand): string {
  if (error.code === 'ENOENT') {
    return command.installHint
      ?? 'Rojo is not installed. Install stable Rojo with Rokit or Aftman, then retry.';
  }
  if (error.code === 'ETIMEDOUT') return `Rojo command timed out after ${timeoutMs}ms`;
  if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
    return `Rojo output exceeded ${MAX_OUTPUT_BYTES} bytes`;
  }
  return error.message;
}

// Neither Rokit nor Aftman has a `run` subcommand — both work by installing
// per-tool shims into their own bin directory and putting it on PATH. Resolving
// a toolchain therefore means finding that shim, not inventing a wrapper call.
const TOOLCHAINS = [
  { manifest: 'rokit.toml', source: 'rokit' as const, rootEnv: 'ROKIT_ROOT', home: '.rokit' },
  { manifest: 'aftman.toml', source: 'aftman' as const, rootEnv: 'AFTMAN_ROOT', home: '.aftman' },
];

function findUpwards(startDirectory: string, fileName: string): string | undefined {
  let current = startDirectory;
  for (;;) {
    const candidate = path.join(current, fileName);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function manifestDeclaresRojo(manifest: string): boolean {
  try {
    // Deliberately not a full TOML parse: this only decides whether to prefer a
    // toolchain shim. RokitTools does the real parsing.
    return /^\s*rojo\s*=/m.test(fs.readFileSync(manifest, 'utf8'));
  } catch {
    return false;
  }
}

function shimPath(rootEnv: string, home: string): string {
  const root = process.env[rootEnv]?.trim() || path.join(os.homedir(), home);
  return path.join(root, 'bin', process.platform === 'win32' ? 'rojo.exe' : 'rojo');
}

function commandWorks(executable: string, prefixArgs: string[], cwd?: string): boolean {
  const result = spawnSync(executable, [...prefixArgs, '--version'], {
    cwd,
    encoding: 'utf8',
    timeout: 5000,
    stdio: 'pipe',
    windowsHide: true,
  });
  return !result.error && result.status === 0;
}

function detectCommand(cwd?: string): RojoCommand {
  const configured = process.env.BLOXFORGE_ROJO_BIN?.trim();
  if (configured) return { executable: configured, prefixArgs: [], source: 'environment' };

  const start = cwd && fs.existsSync(cwd) ? fs.realpathSync(cwd) : process.cwd();
  let pending: RojoCommand | undefined;
  for (const toolchain of TOOLCHAINS) {
    const manifest = findUpwards(start, toolchain.manifest);
    if (!manifest || !manifestDeclaresRojo(manifest)) continue;
    const shim = shimPath(toolchain.rootEnv, toolchain.home);
    if (fs.existsSync(shim)) {
      return { executable: shim, prefixArgs: [], source: toolchain.source, manifest };
    }
    // The manifest pins Rojo but the shim is missing. Remember why, so an ENOENT
    // later names the fix instead of silently falling back to a random global Rojo.
    pending ??= {
      executable: 'rojo',
      prefixArgs: [],
      source: toolchain.source,
      manifest,
      installHint: `${manifest} declares rojo but no installed shim was found at ${shim}. Run the rokit_install tool (or \`${toolchain.source} install\` in ${path.dirname(manifest)}) and retry.`,
    };
  }

  if (commandWorks('rojo', [], cwd)) return { executable: 'rojo', prefixArgs: [], source: 'path' };
  return pending ?? { executable: 'rojo', prefixArgs: [], source: 'path' };
}

interface CacheEntry {
  key: string;
  command: RojoCommand;
}

const resolutionCache = new Map<string, CacheEntry>();
const MAX_CACHED_ROOTS = 32;

/** Keyed by project root plus the mtime of every toolchain manifest above it, so
 * editing or installing a toolchain re-resolves without a process restart. */
function cacheKey(start: string): string {
  const parts = [process.env.BLOXFORGE_ROJO_BIN ?? '', process.env.ROKIT_ROOT ?? '', process.env.AFTMAN_ROOT ?? ''];
  for (const toolchain of TOOLCHAINS) {
    const manifest = findUpwards(start, toolchain.manifest);
    if (!manifest) {
      parts.push(`${toolchain.manifest}:absent`);
      continue;
    }
    let mtime = 'unreadable';
    try { mtime = String(fs.statSync(manifest).mtimeMs); } catch { /* fall through */ }
    parts.push(`${manifest}:${mtime}`);
  }
  return parts.join('\0');
}

function resolveCommand(cwd?: string): RojoCommand {
  const start = cwd && fs.existsSync(cwd) ? fs.realpathSync(cwd) : process.cwd();
  const key = cacheKey(start);
  const cached = resolutionCache.get(start);
  if (cached?.key === key) return cached.command;
  const command = detectCommand(start);
  if (resolutionCache.size >= MAX_CACHED_ROOTS) {
    resolutionCache.delete(resolutionCache.keys().next().value as string);
  }
  resolutionCache.set(start, { key, command });
  return command;
}

/** Exposed for tests and for tooling that installs a toolchain mid-session. */
export function clearRojoCommandCache(): void {
  resolutionCache.clear();
}

export class RojoCommandRunner {
  constructor(
    private readonly override?: RojoCommand,
    private readonly env: NodeJS.ProcessEnv = {},
  ) {}

  /** Resolution is per project root: a Rokit-managed project must not inherit
   * whatever global Rojo happened to be found when the server started. */
  resolve(cwd?: string): RojoCommand {
    return this.override ?? resolveCommand(cwd);
  }

  get command(): RojoCommand {
    return this.resolve();
  }

  run(args: string[], options: { cwd?: string; timeoutMs?: number } = {}): Promise<RojoCommandResult> {
    const command = this.resolve(options.cwd);
    return new Promise((resolve) => {
      execFile(
        command.executable,
        [...command.prefixArgs, ...args],
        {
          cwd: options.cwd,
          encoding: 'utf8',
          timeout: options.timeoutMs ?? 120000,
          maxBuffer: MAX_OUTPUT_BYTES,
          windowsHide: true,
          env: { ...process.env, ...this.env },
        },
        (error, stdout, stderr) => {
          if (!error) {
            resolve({ available: true, ok: true, stdout: stdout.trim(), stderr: stderr.trim(), exitCode: 0 });
            return;
          }
          const childError = error as CommandError;
          const code = childError.code;
          resolve({
            available: code !== 'ENOENT',
            ok: false,
            stdout: String(stdout).slice(0, MAX_OUTPUT_BYTES).trim(),
            stderr: String(stderr).slice(0, MAX_OUTPUT_BYTES).trim(),
            exitCode: typeof childError.code === 'number'
              ? childError.code
              : undefined,
            error: commandErrorMessage(childError, options.timeoutMs ?? 120000, command),
          });
        },
      );
    });
  }

  async version(cwd?: string): Promise<RojoVersionResult> {
    const result = await this.run(['--version'], { cwd, timeoutMs: 5000 });
    const version = result.ok ? result.stdout.match(/\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/)?.[0] : undefined;
    const [major = 0, minor = 0] = (version ?? '').split('.').map(Number);
    return {
      ...result,
      version,
      features: major > 7 || (major === 7 && minor >= 7) ? ['syncback'] : [],
      command: this.resolve(cwd),
    };
  }

  spawn(args: string[], options: { cwd: string; env?: NodeJS.ProcessEnv }): ChildProcessWithoutNullStreams {
    const command = this.resolve(options.cwd);
    return spawn(command.executable, [...command.prefixArgs, ...args], {
      cwd: options.cwd,
      env: { ...process.env, ...this.env, ...options.env },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
  }
}
