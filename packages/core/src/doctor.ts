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

/** Must match `engines.node` in every published package. */
const MINIMUM_NODE_MAJOR = 20;

export function checkNodeVersion(version: string): DoctorCheck {
  const major = parseInt(version.replace(/^v/, '').split('.')[0] ?? '0', 10);
  if (Number.isNaN(major) || major < MINIMUM_NODE_MAJOR) {
    return {
      name: 'Node version',
      status: 'fail',
      detail: `${version} — Node ${MINIMUM_NODE_MAJOR}+ is required.`,
      actionable: {
        fix: `Upgrade Node.js to version ${MINIMUM_NODE_MAJOR} or newer.`,
        verify: 'Run "node -v" to verify your version, then run "npx @princeofscale/bloxforge verify".'
      }
    };
  }
  return { name: 'Node version', status: 'ok', detail: version };
}

/**
 * Toolchain and project readiness, for a caller that has a file-backed project.
 * Skipped entirely when `project` is not given, so the plain `verify` stays a
 * Studio/bridge check.
 */
export async function collectProjectChecks(project: string): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  const add = (name: string, status: DoctorStatus, detail: string, fix?: string, verify?: string) => {
    checks.push({ name, status, detail, ...(fix ? { actionable: { fix, verify: verify ?? '' } } : {}) });
  };

  const { RokitTools } = await import('./toolchain/rokit-tools.js');
  const { WallyTools } = await import('./toolchain/wally-tools.js');
  const { discoverRojoProjects } = await import('./rojo/project-discovery.js');
  const { RojoTools } = await import('./rojo/rojo-tools.js');

  try {
    const projects = discoverRojoProjects(project);
    if (projects.length === 0) add('Rojo project', 'warn', `no *.project.json under ${project}`);
    else if (projects.length > 1) {
      add('Rojo project', 'warn', `${projects.length} project files found; tools need an explicit projectFile`,
        'Pass projectFile to the rojo_* tools, or narrow BLOXFORGE_PROJECT_ROOT.');
    } else add('Rojo project', 'ok', projects[0].projectFile);
  } catch (error) {
    add('Rojo project', 'fail', errorText(error));
  }

  try {
    const status = new RokitTools().status(project);
    add('Toolchain pins', status.healthy ? 'ok' : 'fail',
      status.healthy ? `${status.tools.length} tool(s) match the manifest` : status.reasons.join('; '),
      status.healthy ? undefined : status.action === 'install'
        ? 'Run the rokit_install tool with confirm=true (and allowPinnedToolDownloads=true for exact pins).'
        : 'Fix the tool specs in the manifest, then re-run verify.');
  } catch (error) {
    add('Toolchain pins', 'warn', errorText(error));
  }

  try {
    const rojo = await new RojoTools().getVersion(project);
    add('Rojo binary', rojo.available && rojo.ok ? 'ok' : 'fail',
      rojo.available && rojo.ok ? `${rojo.version} (${rojo.command.source})` : rojo.error ?? 'unavailable',
      rojo.available ? undefined : 'Install the pinned toolchain with rokit_install.');
  } catch (error) {
    add('Rojo binary', 'fail', errorText(error));
  }

  // Only "this project does not use Wally" is a pass. An unparsable manifest or
  // lockfile must fail closed: a readiness gate that reports `ok` with the parse
  // error as its detail is worse than no gate at all. `WallyTools.load` searches
  // upward, so absence is its error rather than a check on this directory.
  const noWally = (error: unknown) => /No wally\.toml found at or above/.test(errorText(error));
  let wallyInUse = true;
  try {
    const validation = new WallyTools().validateLock(project);
    add('Wally lockfile', validation.ok ? 'ok' : 'fail',
      validation.ok ? `${validation.locked ?? 0} locked package(s)` : JSON.stringify({
        missing: validation.missing,
        mismatched: validation.mismatched,
        unresolved: validation.unresolved,
      }),
      validation.ok ? undefined : 'Run wally_install_plan, review it, then wally_install_apply.');
  } catch (error) {
    wallyInUse = !noWally(error);
    if (wallyInUse) {
      add('Wally lockfile', 'fail', errorText(error),
        'Fix wally.toml/wally.lock so they parse, then re-run verify.');
    } else {
      add('Wally lockfile', 'ok', 'no wally.toml; this project does not use Wally');
    }
  }

  // Its own try: a throw here used to append a *second* check named "Wally
  // lockfile", so the JSON report carried a duplicate name and an `ok` verdict
  // sitting on top of a failure.
  if (wallyInUse) {
    try {
      const mapping = new WallyTools().verifyRojoMapping(project);
      add('Wally package mapping', mapping.ok ? 'ok' : 'warn',
        mapping.ok ? mapping.mapped.join(', ') : mapping.reason ?? `unmapped: ${mapping.unmapped.join(', ')}`,
        mapping.ok ? undefined : 'Add a $path entry for each unmapped package directory to the Rojo project.');
    } catch (error) {
      add('Wally package mapping', 'warn', errorText(error),
        'Select the Rojo project explicitly, or fix the project tree, then re-run verify.');
    }
  }

  return checks;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
  /** Project root to additionally check the Rojo/Rokit/Wally setup of. */
  project?: string;
  /** Treat warnings as failures, so automation gets a usable exit code. */
  strict?: boolean;
  /** Emit a machine-readable report instead of the human one. */
  json?: boolean;
}

const HEALTH_TIMEOUT_MS = 3_000;

function fetchHealth(fetchImpl: typeof fetch, port: number): Promise<Response> {
  return fetchImpl(`http://localhost:${port}/health`, {
    signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
  });
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
    const res = await fetchHealth(doFetch, port);
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
      const versionInstance = health.instances?.find((instance) => instance.versionMismatch) ?? first;
      const protocolInstance = health.instances?.find((instance) => instance.protocolMismatch) ?? first;
      if (versionInstance) {
        checks.push({
          name: 'Studio plugin version',
          status: health.versionMismatch || versionInstance.versionMismatch ? 'warn' : 'ok',
          detail: `plugin v${versionInstance.pluginVersion ?? 'unknown'} (${versionInstance.pluginVariant ?? 'unknown'}), server v${health.serverVersion ?? health.version ?? options.version ?? 'unknown'}`,
          actionable: (health.versionMismatch || versionInstance.versionMismatch) ? {
            fix: 'Run "npx @princeofscale/bloxforge --install-plugin" to synchronize the plugin version with your local server.',
            verify: 'Restart Roblox Studio, then run "npx @princeofscale/bloxforge verify" and confirm this check passes.'
          } : undefined
        });
      }
      if (protocolInstance) {
        checks.push({
          name: 'Protocol version',
          status: health.protocolMismatch || protocolInstance.protocolMismatch ? 'warn' : 'ok',
          detail: `plugin protocol ${protocolInstance.pluginProtocolVersion ?? 'unknown'}, server protocol ${protocolInstance.serverProtocolVersion ?? health.protocolVersion ?? 'unknown'}`,
          actionable: (health.protocolMismatch || protocolInstance.protocolMismatch) ? {
            fix: 'Your server and plugin are using incompatible communication protocols. Please update both to the latest versions.',
            verify: 'Restart Roblox Studio, then run "npx @princeofscale/bloxforge verify" and confirm both protocol versions match.'
          } : undefined
        });
      }
    } else {
      checks.push({
        name: 'Local bridge running',
        status: 'fail',
        detail: `port ${port} responded ${res.status}`,
        actionable: {
          fix: `Another application might be using port ${port}. Try running the server on a different port using --port <number>.`,
          verify: 'Run "npx @princeofscale/bloxforge verify --port <number>" on the new port and confirm this check passes.'
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

/**
 * The one check an agent should act on, and that same check's fix.
 *
 * This used to be four independent `find` calls, so `check` resolved to the
 * first failure while `fix` fell through to an unrelated warning's fix whenever
 * that failure carried no `actionable` — and `collectProjectChecks` produces
 * exactly those. Automation following `nextAction` then ran the wrong step.
 */
export function nextAction(checks: DoctorCheck[]): { check?: string; fix?: string } {
  const blocking = checks.find((c) => c.status === 'fail') ?? checks.find((c) => c.status === 'warn');
  return { check: blocking?.name, fix: blocking?.actionable?.fix };
}

export async function runDoctor(options: DoctorOptions = {}): Promise<number> {
  const checks = await collectDoctorChecks(options);
  if (options.project) checks.push(...await collectProjectChecks(options.project));
  const failed = checks.some((c) => c.status === 'fail');
  const warned = checks.some((c) => c.status === 'warn');
  const ready = !failed && !(options.strict === true && warned);

  if (options.json === true) {
    console.log(JSON.stringify({
      ready,
      strict: options.strict === true,
      checks,
      nextAction: ready ? null : nextAction(checks),
    }, null, 2));
  } else {
    console.log(formatDoctorReport(checks));
  }
  // Without --strict a warning still exits 0, which is right for a human and
  // ambiguous for a script; --strict is what automation should use.
  return ready ? 0 : 1;
}

export async function generateDiagnosticReport(options: DoctorOptions = {}): Promise<string> {
  const checks = await collectDoctorChecks(options);
  // `verify --project` already reported the Rojo/Rokit/Wally state; the report a
  // user actually pastes into a bug did not, so every toolchain question had to
  // be asked again by hand.
  if (options.project) checks.push(...await collectProjectChecks(options.project));
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
    const res = await fetchHealth(doFetch, port);
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
        lines.push(`Failed Calls: ${health.session.failures ?? 0}`);
        if (health.session.byTool) {
          for (const stats of health.session.byTool) {
            lines.push(`  - ${stats.toolName}: ${stats.calls} calls, ${stats.failures} failures, avg ${Math.round(stats.averageDurationMs ?? 0)}ms`);
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
