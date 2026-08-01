import { BloxForgeServer, getAllTools, runDoctor, generateDiagnosticReport } from '@princeofscale/bloxforge-core';
import { createRequire } from 'module';

const argFlagValue = (flag: string): string | undefined => {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 && idx + 1 < process.argv.length ? process.argv[idx + 1] : undefined;
};
const warnSecretFlag = (flag: string, envName: string): void => {
  if (process.argv.includes(flag)) {
    console.error(`[security] ${flag} is retained for compatibility but can leak through shell history or process listings. Prefer ${envName}.`);
  }
};

// --port / --debug are honored by setting env the core server reads.
const portArg = argFlagValue('--port');
if (portArg) process.env.ROBLOX_STUDIO_PORT = portArg;
const hostArg = argFlagValue('--host');
if (hostArg) process.env.ROBLOX_STUDIO_HOST = hostArg;
const sessionTokenArg = argFlagValue('--session-token');
if (sessionTokenArg) {
  warnSecretFlag('--session-token', 'BLOXFORGE_SESSION_TOKEN');
  process.env.BLOXFORGE_SESSION_TOKEN = sessionTokenArg;
}
if (process.argv.includes('--debug')) process.env.ROBLOX_STUDIO_DEBUG = '1';

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`BloxForge MCP Server

Usage:
  npx @princeofscale/bloxforge [options]
  npx @princeofscale/bloxforge <command>

Options:
  --port <port>                 Port to run the HTTP bridge on (default: 58741)
  --host <host>                 Bind host (default: 127.0.0.1; non-loopback requires auth)
  --session-token <token>       Compatibility only; prefer BLOXFORGE_SESSION_TOKEN
  --debug                       Enable debug logging (stack traces, verbose output)
  --open-cloud-key <key>        Compatibility only; prefer ROBLOX_OPEN_CLOUD_API_KEY
  --pollinations-key <key>      Compatibility only; prefer POLLINATIONS_API_KEY
  --creator-id <id>             Roblox Creator User ID
  --creator-group-id <id>       Roblox Creator Group ID
  --profile <profile>           core|builder|tester|full|inspector
  --help, -h                    Show this help message

Commands:
  verify, --doctor              Run diagnostics to verify installation and connection
  report                        Generate a detailed diagnostic report for bug reports
  verify [--project <dir>]      Check Node, plugin, bridge and Studio; --project also checks the
                                Rojo/Rokit/Wally setup of that directory
  verify --strict               Exit non-zero on warnings too (use this from automation)
  verify --json                 Machine-readable report with a nextAction
  --install-plugin              Manually install the Studio plugin to your local Roblox directory
  --auto-install-plugin         Install the bundled plugin before starting (legacy/convenience)
  `);
  process.exit(0);
}

if (process.argv.includes('--doctor') || process.argv.includes('verify')) {
  const require = createRequire(import.meta.url);
  const { version } = require('../package.json');
  const projectIndex = process.argv.indexOf('--project');
  process.exitCode = await runDoctor({
    version,
    port: portArg ? parseInt(portArg) : undefined,
    project: projectIndex >= 0 ? (process.argv[projectIndex + 1] ?? process.cwd()) : undefined,
    strict: process.argv.includes('--strict'),
    json: process.argv.includes('--json'),
  });
} else if (process.argv.includes('--report') || process.argv.includes('report')) {
  const require = createRequire(import.meta.url);
  const { version } = require('../package.json');
  const reportText = await generateDiagnosticReport({
    version,
    port: portArg ? parseInt(portArg) : undefined,
  });
  console.log(reportText);
  process.exit(0);
} else if (process.argv.includes('--install-plugin')) {
  const { installPlugin } = await import('./install-plugin.js');
  await installPlugin().catch((err) => {
    console.error(`[install-plugin] What happened: Failed to install plugin.`);
    console.error(`[install-plugin] Why: ${err instanceof Error ? err.message : String(err)}`);
    console.error(`[install-plugin] Fix: Ensure your Roblox Studio plugins folder is accessible and you have write permissions.`);
    console.error(`[install-plugin] Verify: Run 'npx @princeofscale/bloxforge verify' to check if the plugin is installed.`);
    if (process.env.ROBLOX_STUDIO_DEBUG) console.error(err);
    process.exitCode = 1;
  });
} else {
  if (process.argv.includes('--auto-install-plugin')) {
    const { installBundledPlugin } = await import('./install-plugin.js');
    await installBundledPlugin({
      log: (message) => console.error(`[install-plugin] ${message}`),
      warn: (message) => console.error(message),
    }).catch((err) => {
      console.error(
        `[install-plugin] Auto-install skipped. Why: ${err instanceof Error ? err.message : String(err)}`
      );
    });
  }

  const flagValue = (flag: string): string | undefined => {
    const idx = process.argv.indexOf(flag);
    return idx !== -1 && idx + 1 < process.argv.length ? process.argv[idx + 1] : undefined;
  };

  const openCloudKey = flagValue('--open-cloud-key');
  const creatorId = flagValue('--creator-id');
  const creatorGroupId = flagValue('--creator-group-id');
  const pollinationsKey = flagValue('--pollinations-key');
  const toolProfile = flagValue('--profile');

  if (openCloudKey) {
    warnSecretFlag('--open-cloud-key', 'ROBLOX_OPEN_CLOUD_API_KEY');
    process.env.ROBLOX_OPEN_CLOUD_API_KEY = openCloudKey;
  }
  if (creatorId) process.env.ROBLOX_CREATOR_USER_ID = creatorId;
  if (creatorGroupId) process.env.ROBLOX_CREATOR_GROUP_ID = creatorGroupId;
  if (pollinationsKey) {
    warnSecretFlag('--pollinations-key', 'POLLINATIONS_API_KEY');
    process.env.POLLINATIONS_API_KEY = pollinationsKey;
  }
  if (toolProfile) process.env.BLOXFORGE_TOOL_PROFILE = toolProfile;

  const require = createRequire(import.meta.url);
  const { version: VERSION } = require('../package.json');

  const server = new BloxForgeServer({
    name: 'bloxforge',
    version: VERSION,
    tools: getAllTools(),
  });

  server.run().catch((error) => {
    console.error(`\n[Fatal Error] What happened: BloxForge Server failed to start.`);
    console.error(`[Fatal Error] Why: ${error instanceof Error ? error.message : String(error)}`);
    console.error(`[Fatal Error] Fix: Check if another instance is already running on port ${process.env.ROBLOX_STUDIO_PORT || 58741}.`);
    console.error(`[Fatal Error] Verify: Run 'npx @princeofscale/bloxforge verify' to diagnose the issue.`);
    if (process.env.ROBLOX_STUDIO_DEBUG) console.error(error);
    process.exit(1);
  });
}
