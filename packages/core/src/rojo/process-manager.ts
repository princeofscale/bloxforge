import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import * as net from 'node:net';
import * as path from 'node:path';
import { RojoCommandRunner, type RojoVersionResult } from './command-runner.js';
import { resolveProjectPath } from './source-mapper.js';

export interface RojoServeStatus {
  projectFile: string;
  host: string;
  port: number;
  pid?: number;
  version?: string;
  startedAt?: string;
  status: 'starting' | 'running' | 'stopped' | 'exited';
  exitCode?: number | null;
}

interface ManagedProcess {
  child: ChildProcessWithoutNullStreams;
  status: RojoServeStatus;
  logs: string[];
  logBytes: number;
}

const MAX_LOG_LINES = 200;
const MAX_LOG_BYTES = 256 * 1024;

async function assertPortAvailable(host: string, port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', () => reject(new Error(`Rojo serve port ${host}:${port} is already in use`)));
    server.listen(port, host, () => server.close(() => resolve()));
  });
}

function isLoopback(host: string): boolean {
  const normalized = host.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  return normalized === 'localhost' || normalized === '::1' || normalized.startsWith('127.');
}

export class RojoProcessManager {
  private readonly processes = new Map<string, ManagedProcess>();
  private version?: RojoVersionResult;

  constructor(private readonly runner = new RojoCommandRunner()) {}

  async getVersion(): Promise<RojoVersionResult> {
    this.version ??= await this.runner.version();
    return this.version;
  }

  async start(
    projectFile: string,
    options: {
      host?: string;
      port?: number;
      env?: NodeJS.ProcessEnv;
      readinessTimeoutMs?: number;
    } = {},
  ): Promise<RojoServeStatus> {
    const root = path.dirname(projectFile);
    const canonicalProject = resolveProjectPath(root, path.basename(projectFile));
    const existing = this.processes.get(canonicalProject);
    if (existing?.status.status === 'running' || existing?.status.status === 'starting') return { ...existing.status };
    if (existing) this.processes.delete(canonicalProject);

    const host = options.host ?? '127.0.0.1';
    const port = options.port ?? 34872;
    if (!isLoopback(host)) throw new Error('Managed Rojo serve must bind to a loopback address');
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Rojo serve port must be an integer from 1 to 65535');
    await assertPortAvailable(host, port);

    const version = await this.getVersion();
    if (!version.available || !version.ok) throw new Error(version.error ?? 'Rojo is unavailable');
    const child = this.runner.spawn(
      ['serve', canonicalProject, '--address', host, '--port', String(port)],
      { cwd: path.dirname(canonicalProject), env: options.env },
    );
    const managed: ManagedProcess = {
      child,
      logs: [],
      logBytes: 0,
      status: {
        projectFile: canonicalProject,
        host,
        port,
        pid: child.pid,
        version: version.version,
        startedAt: new Date().toISOString(),
        status: 'starting',
      },
    };
    this.processes.set(canonicalProject, managed);

    const append = (stream: 'stdout' | 'stderr', chunk: Buffer) => {
      for (const line of chunk.toString('utf8').split(/\r?\n/).filter(Boolean)) {
        const entry = `${stream}: ${line}`;
        managed.logs.push(entry);
        managed.logBytes += Buffer.byteLength(entry);
      }
      while (managed.logs.length > MAX_LOG_LINES || managed.logBytes > MAX_LOG_BYTES) {
        managed.logBytes -= Buffer.byteLength(managed.logs.shift() ?? '');
      }
    };
    child.stdout.on('data', (chunk: Buffer) => append('stdout', chunk));
    child.stderr.on('data', (chunk: Buffer) => append('stderr', chunk));
    child.once('exit', (exitCode) => {
      managed.status.status = 'exited';
      managed.status.exitCode = exitCode;
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        child.kill();
        reject(new Error(`Rojo serve did not become ready within ${options.readinessTimeoutMs ?? 10000}ms`));
      }, options.readinessTimeoutMs ?? 10000);
      const ready = (chunk: Buffer) => {
        if (!/listening|server started|web interface/i.test(chunk.toString('utf8'))) return;
        clearTimeout(timeout);
        child.stdout.off('data', ready);
        managed.status.status = 'running';
        resolve();
      };
      child.stdout.on('data', ready);
      child.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.once('exit', (code) => {
        if (managed.status.status === 'running') return;
        clearTimeout(timeout);
        reject(new Error(`Rojo serve exited before becoming ready (code ${code ?? 'unknown'})`));
      });
    }).catch((error) => {
      this.processes.delete(canonicalProject);
      throw error;
    });
    return { ...managed.status };
  }

  status(projectFile: string): RojoServeStatus | undefined {
    const canonicalProject = resolveProjectPath(path.dirname(projectFile), path.basename(projectFile));
    const managed = this.processes.get(canonicalProject);
    return managed ? { ...managed.status } : undefined;
  }

  logs(projectFile: string, limit = 100): { lines: string[]; truncated: boolean } {
    const canonicalProject = resolveProjectPath(path.dirname(projectFile), path.basename(projectFile));
    const lines = this.processes.get(canonicalProject)?.logs ?? [];
    const bounded = Math.max(1, Math.min(limit, MAX_LOG_LINES));
    return { lines: lines.slice(-bounded), truncated: lines.length > bounded };
  }

  async stop(projectFile: string): Promise<RojoServeStatus> {
    const canonicalProject = resolveProjectPath(path.dirname(projectFile), path.basename(projectFile));
    const managed = this.processes.get(canonicalProject);
    if (!managed) {
      return { projectFile: canonicalProject, host: '127.0.0.1', port: 34872, status: 'stopped' };
    }
    if (managed.child.exitCode === null) {
      managed.child.kill('SIGTERM');
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          managed.child.kill('SIGKILL');
          resolve();
        }, 2000);
        managed.child.once('exit', () => {
          clearTimeout(timeout);
          resolve();
        });
      });
    }
    managed.status.status = 'stopped';
    this.processes.delete(canonicalProject);
    return { ...managed.status };
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.processes.keys()].map((projectFile) => this.stop(projectFile)));
  }
}
