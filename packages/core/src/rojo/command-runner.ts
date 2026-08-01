import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { clearToolCommandCache, resolveToolCommand, type ToolCommand } from '../toolchain/resolver.js';

export type RojoCommand = ToolCommand;

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

/** Rojo resolves through the shared toolchain resolver like every other pinned
 * tool; this module only adds Rojo's version/feature detection on top. */
function resolveCommand(cwd?: string): RojoCommand {
  return resolveToolCommand('rojo', cwd);
}

/** Exposed for tests and for tooling that installs a toolchain mid-session. */
export function clearRojoCommandCache(): void {
  clearToolCommandCache();
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
