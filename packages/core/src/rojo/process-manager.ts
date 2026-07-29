import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import * as net from 'node:net';
import * as path from 'node:path';
import { RojoCommandRunner, type RojoVersionResult } from './command-runner.js';
import { resolveProjectPath } from './source-mapper.js';
import { isLoopbackHost } from '../network.js';

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
    server.once('error', (error: NodeJS.ErrnoException) => reject(
      error.code === 'EADDRINUSE'
        ? new Error(`Rojo serve port ${host}:${port} is already in use`)
        : error,
    ));
    server.listen(port, host, () => server.close(() => resolve()));
  });
}

function canonicalProject(projectFile: string): string {
  return resolveProjectPath(path.dirname(projectFile), path.basename(projectFile));
}

async function terminateChild(child: ChildProcessWithoutNullStreams, graceMs = 2000): Promise<void> {
  if (child.exitCode !== null) return;
  const waitForExit = (timeoutMs: number) => new Promise<boolean>((resolve) => {
    const onExit = () => {
      clearTimeout(timeout);
      resolve(true);
    };
    const timeout = setTimeout(() => {
      child.off('exit', onExit);
      resolve(false);
    }, timeoutMs);
    child.once('exit', onExit);
  });
  child.kill('SIGTERM');
  if (await waitForExit(graceMs)) return;
  child.kill('SIGKILL');
  await waitForExit(500);
}

export class RojoProcessManager {
  private readonly processes = new Map<string, ManagedProcess>();
  private readonly starts = new Map<string, Promise<RojoServeStatus>>();
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
    const project = canonicalProject(projectFile);
    const starting = this.starts.get(project);
    if (starting) return starting;
    const promise = this.startOnce(project, options);
    this.starts.set(project, promise);
    try {
      return await promise;
    } finally {
      if (this.starts.get(project) === promise) this.starts.delete(project);
    }
  }

  private async startOnce(
    project: string,
    options: {
      host?: string;
      port?: number;
      env?: NodeJS.ProcessEnv;
      readinessTimeoutMs?: number;
    },
  ): Promise<RojoServeStatus> {
    const existing = this.processes.get(project);
    if (existing?.status.status === 'running' || existing?.status.status === 'starting') return { ...existing.status };
    if (existing) this.processes.delete(project);

    const host = (options.host ?? '127.0.0.1').replace(/^\[|\]$/g, '');
    const port = options.port ?? 34872;
    if (!isLoopbackHost(host)) throw new Error('Managed Rojo serve must bind to a loopback address');
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Rojo serve port must be an integer from 1 to 65535');
    await assertPortAvailable(host, port);

    const version = await this.getVersion();
    if (!version.available || !version.ok) throw new Error(version.error ?? 'Rojo is unavailable');
    const child = this.runner.spawn(
      ['serve', project, '--address', host, '--port', String(port)],
      { cwd: path.dirname(project), env: options.env },
    );
    const managed: ManagedProcess = {
      child,
      logs: [],
      logBytes: 0,
      status: {
        projectFile: project,
        host,
        port,
        pid: child.pid,
        version: version.version,
        startedAt: new Date().toISOString(),
        status: 'starting',
      },
    };
    this.processes.set(project, managed);

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

    const readinessTimeoutMs = options.readinessTimeoutMs ?? 10000;
    await new Promise<void>((resolve, reject) => {
      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        void terminateChild(child).then(() =>
          reject(new Error(`Rojo serve did not become ready within ${readinessTimeoutMs}ms`)));
      }, readinessTimeoutMs);
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
        if (managed.status.status === 'running' || timedOut) return;
        clearTimeout(timeout);
        reject(new Error(`Rojo serve exited before becoming ready (code ${code ?? 'unknown'})`));
      });
    }).catch((error) => {
      this.processes.delete(project);
      throw error;
    });
    return { ...managed.status };
  }

  status(projectFile: string): RojoServeStatus | undefined {
    const managed = this.processes.get(canonicalProject(projectFile));
    return managed ? { ...managed.status } : undefined;
  }

  logs(projectFile: string, limit = 100): { lines: string[]; truncated: boolean } {
    const lines = this.processes.get(canonicalProject(projectFile))?.logs ?? [];
    const bounded = Math.max(1, Math.min(limit, MAX_LOG_LINES));
    return { lines: lines.slice(-bounded), truncated: lines.length > bounded };
  }

  async stop(projectFile: string): Promise<RojoServeStatus> {
    const project = canonicalProject(projectFile);
    const starting = this.starts.get(project);
    if (starting) await starting.catch(() => {});
    const managed = this.processes.get(project);
    if (!managed) {
      return { projectFile: project, host: '127.0.0.1', port: 34872, status: 'stopped' };
    }
    await terminateChild(managed.child);
    managed.status.status = 'stopped';
    this.processes.delete(project);
    return { ...managed.status };
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.processes.keys()].map((projectFile) => this.stop(projectFile)));
  }
}
