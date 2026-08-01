import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import * as http from 'node:http';
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
  /** From Rojo's own `/api/rojo`, so readiness names the server it found. */
  sessionId?: string;
  projectName?: string;
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

export interface RojoServerInfo {
  sessionId?: string;
  serverVersion?: string;
  protocolVersion?: number;
  projectName?: string;
}

/**
 * Readiness is "*this* Rojo answers on the port" — not "stdout said listening",
 * and not "something accepts TCP".
 *
 * The banner wording is not API and has moved between releases. A bare TCP
 * connect is not enough either: the port is checked free before the child
 * spawns, but another process can bind it in between, and BloxForge would then
 * adopt a stranger's listener while the real child died of EADDRINUSE.
 *
 * `/api/rojo` is Rojo's own server-info route and returns `sessionId`,
 * `serverVersion`, `protocolVersion` and `projectName`, so a valid response
 * proves both that it is Rojo and which project it serves.
 */
function readServerInfo(host: string, port: number, timeoutMs = 1500): Promise<RojoServerInfo | undefined> {
  return new Promise((resolve) => {
    const request = http.get(
      { host, port, path: '/api/rojo', timeout: timeoutMs, agent: false },
      (response) => {
        if (response.statusCode !== 200) {
          response.resume();
          resolve(undefined);
          return;
        }
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => {
          body += chunk;
          // A stranger streaming megabytes must not become a memory problem.
          if (body.length > 64 * 1024) request.destroy();
        });
        response.on('end', () => {
          try {
            const parsed = JSON.parse(body) as RojoServerInfo;
            resolve(typeof parsed?.sessionId === 'string' && typeof parsed?.serverVersion === 'string'
              ? parsed
              : undefined);
          } catch {
            resolve(undefined);
          }
        });
        response.on('error', () => resolve(undefined));
      },
    );
    request.once('timeout', () => request.destroy());
    request.once('error', () => resolve(undefined));
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

  constructor(private readonly runner = new RojoCommandRunner()) {}

  // Not cached: the resolved command depends on the project's toolchain manifest,
  // which can change (or be installed) while the server is running.
  async getVersion(cwd?: string): Promise<RojoVersionResult> {
    return this.runner.version(cwd);
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

    const version = await this.getVersion(path.dirname(project));
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
    child.once('error', (error) => {
      managed.status.status = 'exited';
      append('stderr', Buffer.from(`spawn failed: ${error.message}`));
    });

    const readinessTimeoutMs = options.readinessTimeoutMs ?? 10000;
    const deadline = Date.now() + readinessTimeoutMs;
    let foreignListener = false;
    while (managed.status.status === 'starting') {
      const info = await readServerInfo(host, port);
      // The child must still be alive: a response from a port our own process
      // never took belongs to somebody else's server.
      if (info && child.exitCode === null) {
        managed.status.status = 'running';
        managed.status.sessionId = info.sessionId;
        managed.status.projectName = info.projectName;
        if (info.serverVersion) managed.status.version = info.serverVersion;
        break;
      }
      if (info) foreignListener = true;
      if (Date.now() >= deadline) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    if (managed.status.status !== 'running') {
      const reason = managed.status.status === 'exited'
        ? `Rojo serve exited before becoming ready (code ${managed.status.exitCode ?? 'unknown'})`
        : foreignListener
          ? `Another Rojo already answers on ${host}:${port}; the managed process did not take the port`
          : `Rojo serve did not become ready within ${readinessTimeoutMs}ms`;
      const tail = managed.logs.slice(-20).join('\n');
      await terminateChild(child);
      this.processes.delete(project);
      throw new Error(tail ? `${reason}\n${tail}` : reason);
    }
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
