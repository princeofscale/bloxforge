import { execFile, spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';

export interface RojoCommand {
  executable: string;
  prefixArgs: string[];
  source: 'path' | 'environment' | 'rokit' | 'aftman' | 'test';
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

function detectCommand(): RojoCommand {
  const configured = process.env.BLOXFORGE_ROJO_BIN?.trim();
  if (configured) return { executable: configured, prefixArgs: [], source: 'environment' };
  const candidates: RojoCommand[] = [
    { executable: 'rojo', prefixArgs: [], source: 'path' },
    { executable: 'rokit', prefixArgs: ['run', 'rojo', '--'], source: 'rokit' },
    { executable: 'aftman', prefixArgs: ['run', 'rojo', '--'], source: 'aftman' },
  ];
  return candidates.find((candidate) => {
    const result = spawnSync(candidate.executable, [...candidate.prefixArgs, '--version'], {
      encoding: 'utf8',
      timeout: 3000,
      stdio: 'pipe',
    });
    return !result.error && result.status === 0;
  }) ?? candidates[0];
}

export class RojoCommandRunner {
  readonly command: RojoCommand;

  constructor(command = detectCommand(), private readonly env: NodeJS.ProcessEnv = {}) {
    this.command = command;
  }

  run(args: string[], options: { cwd?: string; timeoutMs?: number } = {}): Promise<RojoCommandResult> {
    return new Promise((resolve) => {
      execFile(
        this.command.executable,
        [...this.command.prefixArgs, ...args],
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
          const code = (error as NodeJS.ErrnoException).code;
          resolve({
            available: code !== 'ENOENT',
            ok: false,
            stdout: String(stdout).slice(0, MAX_OUTPUT_BYTES).trim(),
            stderr: String(stderr).slice(0, MAX_OUTPUT_BYTES).trim(),
            exitCode: typeof (error as { code?: unknown }).code === 'number'
              ? (error as unknown as { code: number }).code
              : undefined,
            error: code === 'ENOENT'
              ? 'Rojo is not installed. Install stable Rojo with Rokit or Aftman, then retry.'
              : code === 'ETIMEDOUT'
                ? `Rojo command timed out after ${options.timeoutMs ?? 120000}ms`
                : code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
                  ? `Rojo output exceeded ${MAX_OUTPUT_BYTES} bytes`
                  : error.message,
          });
        },
      );
    });
  }

  async version(): Promise<RojoVersionResult> {
    const result = await this.run(['--version'], { timeoutMs: 5000 });
    const version = result.ok ? result.stdout.match(/\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/)?.[0] : undefined;
    const [major = 0, minor = 0] = (version ?? '').split('.').map(Number);
    return {
      ...result,
      version,
      features: major > 7 || (major === 7 && minor >= 7) ? ['syncback'] : [],
      command: this.command,
    };
  }

  spawn(args: string[], options: { cwd: string; env?: NodeJS.ProcessEnv }): ChildProcessWithoutNullStreams {
    return spawn(this.command.executable, [...this.command.prefixArgs, ...args], {
      cwd: options.cwd,
      env: { ...process.env, ...this.env, ...options.env },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
  }
}
