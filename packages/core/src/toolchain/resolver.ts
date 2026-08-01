import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { findManifest, readTomlFile, asStringMap } from './manifest.js';

/**
 * One project-aware resolver for every tool a Rokit/Aftman manifest can pin.
 *
 * Rojo used to be the only tool with a resolver; Wally, Selene, StyLua, Lune and
 * luau-lsp were invoked by bare name and therefore found on `PATH` only. After
 * `rokit install` created the shims, the running process kept its original
 * `PATH`, so Rojo started working while everything else still reported "not
 * installed" until a restart.
 */
export type ToolchainSource = 'path' | 'environment' | 'rokit' | 'aftman' | 'test';

export interface ToolCommand {
  /** Absolute shim path when a manifest pins the tool — even if it is missing. */
  executable: string;
  prefixArgs: string[];
  source: ToolchainSource;
  /** Toolchain manifest that selected this command, when one did. */
  manifest?: string;
  /** Set when a manifest declares the tool but no installed shim was found. */
  installHint?: string;
}

// Neither Rokit nor Aftman has a `run` subcommand — both work by installing
// per-tool shims into their own bin directory and putting it on PATH. Resolving
// a toolchain therefore means finding that shim, not inventing a wrapper call.
export const TOOLCHAINS = [
  { manifest: 'rokit.toml', source: 'rokit' as const, rootEnv: 'ROKIT_ROOT', home: '.rokit' },
  { manifest: 'aftman.toml', source: 'aftman' as const, rootEnv: 'AFTMAN_ROOT', home: '.aftman' },
];

/** Per-tool override, checked before any manifest. */
const BIN_OVERRIDE_ENV: Record<string, string> = {
  rojo: 'BLOXFORGE_ROJO_BIN',
};

export function toolchainRoot(rootEnv: string, home: string): string {
  return process.env[rootEnv]?.trim() || path.join(os.homedir(), home);
}

export function shimPath(rootEnv: string, home: string, tool: string): string {
  return path.join(toolchainRoot(rootEnv, home), 'bin', process.platform === 'win32' ? `${tool}.exe` : tool);
}

/** The bounded search: an upward walk that leaves `BLOXFORGE_PROJECT_ROOT` could
 * pick up a stranger's toolchain manifest. */
function findToolchainManifest(startDirectory: string, fileName: string): string | undefined {
  try {
    return findManifest(startDirectory, fileName);
  } catch {
    return undefined;
  }
}

/**
 * The project root to search from, or the server's own cwd when it cannot be
 * resolved. `existsSync` followed by `realpathSync` is not atomic — the
 * temporary project directories these paths run against are created and removed
 * constantly — and `quality-tools` calls the resolver outside a `try`, so an
 * ENOENT here would escape as an unhandled tool error instead of `available:
 * false`.
 */
function startDirectory(cwd?: string): string {
  if (!cwd) return process.cwd();
  try {
    return fs.realpathSync(cwd);
  } catch {
    return process.cwd();
  }
}

/**
 * Whether the manifest's `[tools]` table declares `tool`, by alias or by the
 * repository name in its spec — `luau-lsp = "JohnnyMorganz/luau-lsp@1.x"` and
 * `lsp = "JohnnyMorganz/luau-lsp@1.x"` both install a `luau-lsp` shim under the
 * alias, so the alias is what a shim is named after.
 */
function manifestDeclares(manifest: string, tool: string): boolean {
  try {
    const tools = asStringMap(readTomlFile(manifest).tools);
    return Object.prototype.hasOwnProperty.call(tools, tool);
  } catch {
    // A manifest we cannot parse must not silently downgrade to a global tool.
    // Fall back to the cheap check rather than pretending nothing is pinned.
    try {
      return new RegExp(`^\\s*${tool.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')}\\s*=`, 'm')
        .test(fs.readFileSync(manifest, 'utf8'));
    } catch {
      return false;
    }
  }
}

function detect(tool: string, cwd?: string): ToolCommand {
  const override = process.env[BIN_OVERRIDE_ENV[tool] ?? '']?.trim();
  if (override) return { executable: override, prefixArgs: [], source: 'environment' };

  const start = startDirectory(cwd);
  for (const toolchain of TOOLCHAINS) {
    const manifest = findToolchainManifest(start, toolchain.manifest);
    if (!manifest || !manifestDeclares(manifest, tool)) continue;
    const shim = shimPath(toolchain.rootEnv, toolchain.home, tool);
    if (fs.existsSync(shim)) {
      return { executable: shim, prefixArgs: [], source: toolchain.source, manifest };
    }
    // The first manifest that declares the tool is authoritative, installed or
    // not — the same precedence `RokitTools.detect` uses. Falling through to a
    // second toolchain's *installed* shim would run an aftman-pinned version
    // against a rokit-pinned project, which is the drift the pin prevents.
    //
    // The *absolute* missing shim, never the bare tool name: `execFile` looks a
    // bare name up on PATH, so a pinned project with no installed shim would
    // still run whatever global copy exists while reporting source: 'rokit'.
    return {
      executable: shim,
      prefixArgs: [],
      source: toolchain.source,
      manifest,
      installHint: `${manifest} declares ${tool} but no installed shim was found at ${shim}. Run the rokit_install tool (or \`${toolchain.source} install\` in ${path.dirname(manifest)}) and retry.`,
    };
  }

  // Nothing pins it, so whatever is on PATH is the honest answer.
  return { executable: tool, prefixArgs: [], source: 'path' };
}

interface CacheEntry {
  key: string;
  command: ToolCommand;
}

const resolutionCache = new Map<string, CacheEntry>();
const MAX_CACHED_ENTRIES = 128;

function stamp(file: string): string {
  try {
    const stats = fs.statSync(file);
    return `${stats.mtimeMs}:${stats.size}`;
  } catch {
    return 'absent';
  }
}

/** Keyed by project root and tool, plus every manifest above it *and its shim*.
 * An external `rokit install` creates the shim without touching the manifest,
 * so keying on the manifest alone pinned the stale resolution until restart. */
function cacheKey(tool: string, start: string): string {
  const parts = [
    process.env[BIN_OVERRIDE_ENV[tool] ?? ''] ?? '',
    process.env.ROKIT_ROOT ?? '',
    process.env.AFTMAN_ROOT ?? '',
  ];
  for (const toolchain of TOOLCHAINS) {
    const manifest = findToolchainManifest(start, toolchain.manifest);
    parts.push(`${manifest ?? toolchain.manifest}:${manifest ? stamp(manifest) : 'absent'}`);
    const shim = shimPath(toolchain.rootEnv, toolchain.home, tool);
    parts.push(`${shim}:${stamp(shim)}`);
  }
  return parts.join('\0');
}

/**
 * Resolve `tool` for the project at `cwd`. Never throws: an unreadable root
 * falls back to the server's own working directory.
 */
export function resolveToolCommand(tool: string, cwd?: string): ToolCommand {
  const start = startDirectory(cwd);
  const key = cacheKey(tool, start);
  const cacheId = `${tool}\0${start}`;
  const cached = resolutionCache.get(cacheId);
  if (cached?.key === key) return cached.command;
  const command = detect(tool, start);
  if (resolutionCache.size >= MAX_CACHED_ENTRIES) {
    resolutionCache.delete(resolutionCache.keys().next().value as string);
  }
  resolutionCache.set(cacheId, { key, command });
  return command;
}

/** Exposed for tests and for tooling that installs a toolchain mid-session. */
export function clearToolCommandCache(): void {
  resolutionCache.clear();
}
