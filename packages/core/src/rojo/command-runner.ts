import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { findManifest } from '../toolchain/manifest.js';

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

/** The shared bounded resolver: an upward search that leaves
 * `BLOXFORGE_PROJECT_ROOT` could pick up a stranger's toolchain manifest. */
function findToolchainManifest(startDirectory: string, fileName: string): string | undefined {
  try {
    return findManifest(startDirectory, fileName);
  } catch {
    return undefined;
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

function detectCommand(cwd?: string): RojoCommand {
  const configured = process.env.BLOXFORGE_ROJO_BIN?.trim();
  if (configured) return { executable: configured, prefixArgs: [], source: 'environment' };

  const start = cwd && fs.existsSync(cwd) ? fs.realpathSync(cwd) : process.cwd();
  let pending: RojoCommand | undefined;
  for (const toolchain of TOOLCHAINS) {
    const manifest = findToolchainManifest(start, toolchain.manifest);
    if (!manifest || !manifestDeclaresRojo(manifest)) continue;
    const shim = shimPath(toolchain.rootEnv, toolchain.home);
    if (fs.existsSync(shim)) {
      return { executable: shim, prefixArgs: [], source: toolchain.source, manifest };
    }
    // The manifest pins Rojo but the shim is missing. Remember why, so an ENOENT
    // later names the fix instead of silently falling back to a random global Rojo.
    // The *absolute* missing shim, never the bare name `rojo`: `execFile` looks a
    // bare name up on PATH, so a pinned project with no installed shim would
    // still run whatever global Rojo exists while reporting source: 'rokit'.
    // Spawning the absolute path fails with ENOENT, which surfaces installHint.
    pending ??= {
      executable: shim,
      prefixArgs: [],
      source: toolchain.source,
      manifest,
      installHint: `${manifest} declares rojo but no installed shim was found at ${shim}. Run the rokit_install tool (or \`${toolchain.source} install\` in ${path.dirname(manifest)}) and retry.`,
    };
  }

  // A pinned project outranks whatever global Rojo happens to be on PATH.
  // Running an unpinned 7.5 against a project pinned to 7.7 is precisely the
  // drift the pin exists to prevent, and it fails in ways nothing here can see.
  return pending ?? { executable: 'rojo', prefixArgs: [], source: 'path' };
}

interface CacheEntry {
  key: string;
  command: RojoCommand;
}

const resolutionCache = new Map<string, CacheEntry>();
const MAX_CACHED_ROOTS = 32;

function stamp(file: string): string {
  try {
    const stats = fs.statSync(file);
    return `${stats.mtimeMs}:${stats.size}`;
  } catch {
    return 'absent';
  }
}

/** Keyed by project root plus every toolchain manifest above it *and its shim*.
 * An external `rokit install` creates the shim without touching the manifest,
 * so keying on the manifest alone pinned the stale resolution until restart. */
function cacheKey(start: string): string {
  const parts = [process.env.BLOXFORGE_ROJO_BIN ?? '', process.env.ROKIT_ROOT ?? '', process.env.AFTMAN_ROOT ?? ''];
  for (const toolchain of TOOLCHAINS) {
    const manifest = findToolchainManifest(start, toolchain.manifest);
    parts.push(`${manifest ?? toolchain.manifest}:${manifest ? stamp(manifest) : 'absent'}`);
    const shim = shimPath(toolchain.rootEnv, toolchain.home);
    parts.push(`${shim}:${stamp(shim)}`);
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
