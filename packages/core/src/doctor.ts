// `--doctor` diagnostics. Pure helpers (checkNodeVersion, formatDoctorReport)
// are unit-tested; collectDoctorChecks performs the I/O (filesystem + a /health
// probe) and composes them into a report the CLI prints.

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { getPluginsFolder } from './install-plugin-helpers.js';
import { MCP_PROTOCOL_VERSION } from './bridge-service.js';

export type DoctorStatus = 'ok' | 'warn' | 'fail';

export interface DoctorCheck {
  name: string;
  status: DoctorStatus;
  detail: string;
  actionable?: {
    fix: string;
    verify?: string;
  };
}

const SYMBOL: Record<DoctorStatus, string> = { ok: '✓', warn: '!', fail: '✗' };

export function checkNodeVersion(version: string): DoctorCheck {
  const major = parseInt(version.replace(/^v/, '').split('.')[0] ?? '0', 10);
  if (Number.isNaN(major) || major < 18) {
    return { 
      name: 'Node version', 
      status: 'fail', 
      detail: `${version} — Node 18+ is required.`,
      actionable: {
        fix: 'Upgrade Node.js to version 18 or newer.',
        verify: 'Run "node -v" to verify your version, then run "npx @princeofscale/bloxforge verify".'
      }
    };
  }
  return { name: 'Node version', status: 'ok', detail: version };
}

export function formatDoctorReport(checks: DoctorCheck[]): string {
  const lines: string[] = [];
  for (const c of checks) {
    lines.push(`  ${SYMBOL[c.status]} ${c.name}: ${c.detail}`);
    if (c.status !== 'ok' && c.actionable) {
      lines.push(`      Fix: ${c.actionable.fix}`);
      if (c.actionable.verify) {
        lines.push(`      Verify: ${c.actionable.verify}`);
      }
    }
  }

  const worst: DoctorStatus = checks.some((c) => c.status === 'fail')
    ? 'fail'
    : checks.some((c) => c.status === 'warn')
      ? 'warn'
      : 'ok';
  const summary = worst === 'ok'
    ? 'All checks passed.'
    : worst === 'warn'
      ? 'Some checks need attention (warnings).'
      : 'Problems found — see failures above.';
  return ['bloxforge doctor / verify', ...lines, '', summary].join('\n');
}

export interface DoctorOptions {
  version?: string;
  port?: number;
  fetchImpl?: typeof fetch;
}

export async function collectDoctorChecks(options: DoctorOptions = {}): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  checks.push(checkNodeVersion(process.version));

  checks.push({
    name: 'Server package',
    status: 'ok',
    detail: options.version ? `v${options.version}` : 'version unknown',
  });

  // Plugin installed? Look for either variant in the resolved plugins folder.
  try {
    const folder = getPluginsFolder();
    const variants = ['MCPPlugin.rbxmx', 'MCPInspectorPlugin.rbxmx'];
    const found = variants.filter((v) => fs.existsSync(path.join(folder, v)));
    checks.push(found.length > 0
      ? { name: 'Studio plugin installed', status: 'ok', detail: `${found.join(', ')} in ${folder}` }
      : { 
          name: 'Studio plugin installed', 
          status: 'warn', 
          detail: `none found in ${folder}. Run with --install-plugin.`,
          actionable: {
            fix: 'Run "npx @princeofscale/bloxforge --install-plugin" to install the plugin to your local Roblox directory.',
            verify: 'Run "npx @princeofscale/bloxforge verify" again to confirm installation.'
          }
        });
  } catch (error) {
    checks.push({ 
      name: 'Studio plugin installed', 
      status: 'warn', 
      detail: `could not resolve plugins folder: ${error instanceof Error ? error.message : String(error)}`,
      actionable: {
        fix: 'Ensure your Roblox Studio installation is valid and accessible.',
        verify: 'Check if Roblox Studio opens correctly, then try again.'
      }
    });
  }

  // Local bridge running + Studio reachable via /health.
  const port = options.port ?? (process.env.ROBLOX_STUDIO_PORT ? parseInt(process.env.ROBLOX_STUDIO_PORT) : 58741);
  const doFetch = options.fetchImpl ?? fetch;
  try {
    const res = await doFetch(`http://localhost:${port}/health`);
    if (res.ok) {
      const health = await res.json() as {
        pluginConnected?: boolean;
        instanceCount?: number;
        version?: string;
        serverVersion?: string;
        lazyTools?: boolean;
        activeToolCount?: number;
        loadedToolsets?: string[];
        protocolVersion?: number;
        versionMismatch?: boolean;
        protocolMismatch?: boolean;
        instances?: Array<{
          pluginVersion?: string;
          pluginVariant?: string;
          pluginProtocolVersion?: number;
          serverProtocolVersion?: number;
          versionMismatch?: boolean;
          protocolMismatch?: boolean;
        }>;
      };
      checks.push({ name: 'Local bridge running', status: 'ok', detail: `responding on port ${port}` });
      checks.push(health.pluginConnected
        ? { name: 'Studio reachable', status: 'ok', detail: `${health.instanceCount ?? 0} place(s) connected` }
        : { 
            name: 'Studio reachable', 
            status: 'warn', 
            detail: 'bridge up but no Studio plugin connected.',
            actionable: {
              fix: 'Open Roblox Studio, open your place, and ensure "Allow HTTP Requests" is enabled in Game Settings -> Security. Play or Run the game.',
              verify: 'Ensure the BloxForge plugin shows "Connected" in Studio, then run verify again.'
            }
          });
      checks.push({
        name: 'Lazy tool loading',
        status: health.lazyTools === false ? 'warn' : 'ok',
        detail: health.lazyTools === false
          ? 'disabled via ROBLOX_MCP_LAZY_TOOLS opt-out; all schemas are advertised upfront'
          : `default path active (${health.activeToolCount ?? 0} active tools; loaded ${health.loadedToolsets?.join(', ') || 'core'})`,
      });
      const first = health.instances?.[0];
      if (first) {
        checks.push({
          name: 'Studio plugin version',
          status: health.versionMismatch || first.versionMismatch ? 'warn' : 'ok',
          detail: `plugin v${first.pluginVersion ?? 'unknown'} (${first.pluginVariant ?? 'unknown'}), server v${health.serverVersion ?? health.version ?? options.version ?? 'unknown'}`,
          actionable: (health.versionMismatch || first.versionMismatch) ? {
            fix: 'Run "npx @princeofscale/bloxforge --install-plugin" to synchronize the plugin version with your local server.',
            verify: 'Restart the Roblox Studio session and check the plugin version.'
          } : undefined
        });
        checks.push({
          name: 'Protocol version',
          status: health.protocolMismatch || first.protocolMismatch ? 'warn' : 'ok',
          detail: `plugin protocol ${first.pluginProtocolVersion ?? 'unknown'}, server protocol ${first.serverProtocolVersion ?? health.protocolVersion ?? 'unknown'}`,
          actionable: (health.protocolMismatch || first.protocolMismatch) ? {
            fix: 'Your server and plugin are using incompatible communication protocols. Please update both to the latest versions.',
            verify: 'Run "npx @princeofscale/bloxforge verify" after updating.'
          } : undefined
        });
      }
    } else {
      checks.push({ 
        name: 'Local bridge running', 
        status: 'fail', 
        detail: `port ${port} responded ${res.status}`,
        actionable: {
          fix: `Another application might be interfering on port ${port}, or the server is in an error state.`,
          verify: `Try running the server on a different port using --port <number>.`
        }
      });
    }
  } catch {
    checks.push({ 
      name: 'Local bridge running', 
      status: 'warn', 
      detail: `nothing responding on port ${port}. The bridge only runs while the MCP server is started.`,
      actionable: {
        fix: 'Start the BloxForge server in another terminal (e.g., via "npx @princeofscale/bloxforge") before running diagnostics.',
        verify: 'Keep the server running, then in a new terminal run "npx @princeofscale/bloxforge verify".'
      }
    });
  }

  return checks;
}

export async function runDoctor(options: DoctorOptions = {}): Promise<number> {
  const checks = await collectDoctorChecks(options);
  // eslint-disable-next-line no-console
  console.log(formatDoctorReport(checks));
  return checks.some((c) => c.status === 'fail') ? 1 : 0;
}

export async function generateDiagnosticReport(options: DoctorOptions = {}): Promise<string> {
  const checks = await collectDoctorChecks(options);
  const home = os.homedir();
  const sanitize = (text: string) => {
    const escapedHome = home.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return text.replace(new RegExp(escapedHome, 'g'), '<home>');
  };

  const lines: string[] = [];
  lines.push('==================================================');
  lines.push('            BLOXFORGE DIAGNOSTIC REPORT           ');
  lines.push('==================================================');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`OS: ${process.platform} (${os.type()} ${os.release()} ${os.arch()})`);
  lines.push(`Node Version: ${process.version}`);
  lines.push(`BloxForge Version: ${options.version ?? 'unknown'}`);
  lines.push(`Protocol Version: ${MCP_PROTOCOL_VERSION}`);
  lines.push(`Selected Profile: ${process.env.BLOXFORGE_TOOL_PROFILE || 'core'}`);
  lines.push('');
  lines.push('--- Doctor Results ---');
  for (const c of checks) {
    const statusSymbol = c.status === 'ok' ? '[ OK ]' : c.status === 'warn' ? '[WARN]' : '[FAIL]';
    lines.push(`${statusSymbol} ${c.name}: ${sanitize(c.detail)}`);
  }
  lines.push('');

  // Try to query the running server's health endpoint if it is up
  const port = options.port ?? (process.env.ROBLOX_STUDIO_PORT ? parseInt(process.env.ROBLOX_STUDIO_PORT) : 58741);
  const doFetch = options.fetchImpl ?? fetch;
  try {
    const res = await doFetch(`http://localhost:${port}/health`);
    if (res.ok) {
      const health = await res.json() as any;
      lines.push('--- Running Server Status ---');
      lines.push(`Server Uptime: ${Math.round((health.uptime ?? 0) / 1000)}s`);
      lines.push(`Lazy Tools Enabled: ${health.lazyTools ?? 'unknown'}`);
      lines.push(`Active Tool Count: ${health.activeToolCount ?? 'unknown'}`);
      lines.push(`Loaded Toolsets: ${health.loadedToolsets?.join(', ') ?? 'none'}`);
      lines.push(`Connected Instances: ${health.instanceCount ?? 0}`);
      if (health.instances && health.instances.length > 0) {
        for (const inst of health.instances) {
          lines.push(`  - Instance: ${inst.role} (variant: ${inst.pluginVariant ?? 'unknown'}, version: ${inst.pluginVersion ?? 'unknown'}, protocol: ${inst.pluginProtocolVersion ?? 'unknown'})`);
        }
      }
      lines.push('');
      if (health.recentDisconnects && health.recentDisconnects.length > 0) {
        lines.push('--- Recent Disconnects ---');
        for (const disc of health.recentDisconnects) {
          lines.push(`  - [${new Date(disc.disconnectedAt).toISOString()}] role: ${disc.role}, reason: ${disc.reason}`);
        }
        lines.push('');
      }
      if (health.session) {
        lines.push('--- Session Summary ---');
        lines.push(`Total Calls: ${health.session.totalCalls ?? 0}`);
        lines.push(`Failed Calls: ${health.session.failedCalls ?? 0}`);
        if (health.session.perToolStats) {
          for (const [tool, stats] of Object.entries(health.session.perToolStats)) {
            const s = stats as any;
            lines.push(`  - ${tool}: ${s.calls} calls, ${s.failures} failures, avg ${Math.round(s.averageDurationMs ?? 0)}ms`);
          }
        }
        lines.push('');
      }
    }
  } catch {
    lines.push('--- Running Server Status ---');
    lines.push('MCP server is not currently running on this port.');
    lines.push('');
  }

  lines.push('==================================================');
  lines.push('End of Report');
  return lines.join('\n');
}
