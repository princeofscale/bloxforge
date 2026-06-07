#!/usr/bin/env node

import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const STUDIO_PROCESS = 'RobloxStudioBeta';

export function isWsl() {
  if (process.platform !== 'linux') return false;
  try {
    return /microsoft|wsl/i.test(readFileSync('/proc/version', 'utf8'));
  } catch {
    return false;
  }
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  }).trim();
}

function powershell(script) {
  const exe = process.platform === 'win32' ? 'powershell.exe' : 'powershell.exe';
  return run(exe, ['-NoProfile', '-Command', script], {
    cwd: isWsl() && existsSync('/mnt/c/Windows') ? '/mnt/c/Windows' : process.cwd(),
  });
}

function windowsLocalAppData() {
  if (process.platform === 'win32') return process.env.LOCALAPPDATA;
  if (!isWsl()) return undefined;
  try {
    return run('cmd.exe', ['/c', 'echo %LOCALAPPDATA%'], {
      cwd: existsSync('/mnt/c/Windows') ? '/mnt/c/Windows' : process.cwd(),
    });
  } catch {
    return undefined;
  }
}

function toWslPath(windowsPath) {
  if (!windowsPath || process.platform === 'win32') return windowsPath;
  if (!isWsl()) return windowsPath;
  return run('wslpath', ['-u', windowsPath]);
}

function toStudioLaunchArg(arg) {
  if (!isWsl() || !path.isAbsolute(arg) || !existsSync(arg)) return arg;
  return run('wslpath', ['-w', arg]);
}

export function resolvePluginsDir() {
  if (process.env.MCP_PLUGINS_DIR) return process.env.MCP_PLUGINS_DIR;
  if (process.platform === 'win32') {
    return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Roblox', 'Plugins');
  }
  if (isWsl()) {
    const localAppData = windowsLocalAppData();
    if (localAppData) return path.join(toWslPath(localAppData), 'Roblox', 'Plugins');
  }
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Documents', 'Roblox', 'Plugins');
  return path.join(os.homedir(), 'Documents', 'Roblox', 'Plugins');
}

export function resolveStudioExe() {
  if (process.env.ROBLOX_STUDIO_EXE) return process.env.ROBLOX_STUDIO_EXE;

  if (process.platform === 'darwin') {
    return '/Applications/RobloxStudio.app/Contents/MacOS/RobloxStudio';
  }

  const localAppData = windowsLocalAppData();
  const root = localAppData
    ? path.join(toWslPath(localAppData), 'Roblox', 'Versions')
    : path.join(os.homedir(), 'AppData', 'Local', 'Roblox', 'Versions');
  if (!existsSync(root)) {
    throw new Error(`Roblox Studio Versions folder not found: ${root}. Set ROBLOX_STUDIO_EXE.`);
  }

  const candidates = readdirSync(root)
    .filter((name) => name.startsWith('version-'))
    .map((name) => path.join(root, name, 'RobloxStudioBeta.exe'))
    .filter((candidate) => existsSync(candidate))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);

  if (candidates.length === 0) {
    throw new Error(`RobloxStudioBeta.exe not found under ${root}. Set ROBLOX_STUDIO_EXE.`);
  }
  return candidates[0];
}

export function listStudioProcesses() {
  if (process.platform === 'darwin') {
    let out = '';
    try {
      out = run('pgrep', ['-fl', 'RobloxStudio']);
    } catch {
      return [];
    }
    return out
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [pid, ...rest] = line.trim().split(/\s+/);
        return { Id: Number(pid), Path: rest.join(' '), MainWindowTitle: '' };
      });
  }

  let out = '';
  try {
    out = powershell(
      `Get-Process ${STUDIO_PROCESS} -ErrorAction SilentlyContinue | ` +
        'Select-Object Id,Path,MainWindowTitle | ConvertTo-Json -Compress',
    );
  } catch {
    return [];
  }
  if (!out) return [];
  const parsed = JSON.parse(out);
  return Array.isArray(parsed) ? parsed : [parsed];
}

export async function closeAllStudio({ requireEnv = true, timeoutMs = 30000 } = {}) {
  if (requireEnv && process.env.RSMCP_E2E_CLOSE_ALL_STUDIO !== '1') {
    throw new Error('Refusing to close Studio. Set RSMCP_E2E_CLOSE_ALL_STUDIO=1.');
  }

  if (process.platform === 'darwin') {
    try {
      run('pkill', ['-f', 'RobloxStudio']);
    } catch {
      // No matching process.
    }
  } else {
    try {
      powershell(`Get-Process ${STUDIO_PROCESS} -ErrorAction SilentlyContinue | Stop-Process -Force`);
    } catch {
      // No matching process.
    }
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (listStudioProcesses().length === 0) return;
    await delay(500);
  }
  throw new Error(`Studio processes still running: ${JSON.stringify(listStudioProcesses())}`);
}

export function launchStudio(args = []) {
  const exe = resolveStudioExe();
  const studioArgs = args.map(toStudioLaunchArg);
  const proc = spawn(exe, studioArgs, {
    cwd: isWsl() && existsSync('/mnt/c/Windows') ? '/mnt/c/Windows' : process.cwd(),
    detached: true,
    stdio: 'ignore',
  });
  proc.unref();
  return { pid: proc.pid, exe, args: studioArgs };
}

function readHealth(port = 58741) {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:${port}/health`, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(2000, () => req.destroy(new Error('health timeout')));
  });
}

export async function waitConnected({ timeoutMs = 120000, variant, version } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      const health = await readHealth();
      last = health;
      const instances = Array.isArray(health.instances) ? health.instances : [];
      const edit = instances.find((inst) => inst.role === 'edit');
      if (edit) {
        if (variant && edit.pluginVariant !== variant) {
          throw new Error(`Connected plugin variant ${edit.pluginVariant}, expected ${variant}`);
        }
        if (version && edit.pluginVersion !== version) {
          throw new Error(`Connected plugin version ${edit.pluginVersion}, expected ${version}`);
        }
        return health;
      }
    } catch (err) {
      last = err instanceof Error ? err.message : String(err);
    }
    await delay(1000);
  }
  throw new Error(`Studio did not connect within ${timeoutMs}ms. Last health: ${JSON.stringify(last)}`);
}

function argValue(name, fallback) {
  const idx = process.argv.indexOf(name);
  return idx !== -1 && idx + 1 < process.argv.length ? process.argv[idx + 1] : fallback;
}

async function main() {
  const command = process.argv[2] ?? 'status';
  if (command === 'status') {
    let studioExe;
    try {
      studioExe = resolveStudioExe();
    } catch {
      studioExe = undefined;
    }
    console.log(JSON.stringify({
      processes: listStudioProcesses(),
      pluginsDir: resolvePluginsDir(),
      studioExe: studioExe && existsSync(studioExe) ? studioExe : undefined,
    }, null, 2));
    return;
  }
  if (command === 'close-all') {
    await closeAllStudio();
    console.log(JSON.stringify({ processes: listStudioProcesses() }, null, 2));
    return;
  }
  if (command === 'launch') {
    console.log(JSON.stringify(launchStudio(process.argv.slice(3)), null, 2));
    return;
  }
  if (command === 'wait-connected') {
    const timeoutMs = Number(argValue('--timeout-ms', '120000'));
    const variant = argValue('--variant', undefined);
    const version = argValue('--version', undefined);
    console.log(JSON.stringify(await waitConnected({ timeoutMs, variant, version }), null, 2));
    return;
  }
  throw new Error(`Unknown command: ${command}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
