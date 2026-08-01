import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { clearRojoCommandCache } from '../rojo/command-runner.js';
import { resolveProjectRoot } from '../rojo/source-mapper.js';
import { hasCommand, run, type QualityCheck } from '../quality-tools.js';
import { asStringMap, fileHash, loadManifest, planHashMismatch, planHashOf, type ManifestFile } from './manifest.js';

type ToolchainKind = 'rokit' | 'aftman';

const TOOLCHAINS: Array<{ kind: ToolchainKind; manifest: string; rootEnv: string; home: string }> = [
  { kind: 'rokit', manifest: 'rokit.toml', rootEnv: 'ROKIT_ROOT', home: '.rokit' },
  { kind: 'aftman', manifest: 'aftman.toml', rootEnv: 'AFTMAN_ROOT', home: '.aftman' },
];

// `<tool> = "owner/repo@version"`. Version is optional in a manifest entry.
const TOOL_SPEC = /^(?<owner>[\w.-]+)\/(?<repo>[\w.-]+)(?:@(?<version>[\w.+-]+))?$/;

export interface RokitDetection {
  root: string;
  kind?: ToolchainKind;
  manifestPath?: string;
  mtimeMs?: number;
  legacy: boolean;
  cliAvailable: boolean;
}

function binDirectory(rootEnv: string, home: string): string {
  return path.join(process.env[rootEnv]?.trim() || path.join(os.homedir(), home), 'bin');
}

function shimFor(kind: ToolchainKind, tool: string): string {
  const toolchain = TOOLCHAINS.find((entry) => entry.kind === kind)!;
  return path.join(
    binDirectory(toolchain.rootEnv, toolchain.home),
    process.platform === 'win32' ? `${tool}.exe` : tool,
  );
}

/** Runs an already-resolved absolute shim path, never a name from a manifest. */
function probeVersion(shim: string, cwd: string): { version?: string; output?: string } {
  try {
    const output = execFileSync(shim, ['--version'], {
      cwd,
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 5000,
      maxBuffer: 64 * 1024,
      windowsHide: true,
    }).trim();
    return { version: output.match(/\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/)?.[0], output };
  } catch (error) {
    return { output: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Substring matching said "17.7.0" satisfies a 7.7.0 pin, and that "7.70.1"
 * satisfies 7.7. A manifest pin matches only when it is a component-wise
 * prefix of the running version.
 *
 * ponytail: prefix compare, not a range solver. Rokit pins exact versions; if
 * caret/tilde requirements ever land in rokit.toml, use a real semver matcher.
 */
function versionMatches(running: string, pinned: string): boolean {
  const wanted = pinned.split('.');
  const actual = running.split('.');
  return wanted.length <= actual.length && wanted.every((part, index) => part === actual[index]);
}

function requireSafeTool(tool: string): string {
  if (!/^[\w.-]+$/.test(tool)) throw new Error(`Tool name must match [A-Za-z0-9_.-]+; got ${JSON.stringify(tool)}`);
  return tool;
}

function requireSafeSpec(spec: string): string {
  if (!TOOL_SPEC.test(spec)) {
    throw new Error(`Tool spec must be "owner/repo" or "owner/repo@version"; got ${JSON.stringify(spec)}`);
  }
  return spec;
}

/**
 * Rokit and Aftman have no `run` subcommand: they install per-tool shims into
 * their own bin directory. These tools therefore inspect the manifest and the
 * shims rather than trying to wrap tool invocations.
 */
export interface ToolStatus {
  name: string;
  spec: string;
  manifestVersion?: string;
  shim?: string;
  shimInstalled: boolean;
  unsafeToolName: boolean;
  /** The spec parses as `owner/repo` or `owner/repo@version`. */
  validSpec: boolean;
  /** The spec pins an exact `x.y.z` — the only shape an unattended install accepts. */
  exactPin: boolean;
  runningVersion?: string;
  probeOutput?: string;
  matchesManifest?: boolean;
}

const EXACT_VERSION = /^\d+\.\d+\.\d+$/;

/**
 * `installRequired` used to mean only "a shim file is missing", so a shim of the
 * wrong version reported `matchesManifest: false` next to
 * `installRequired: false` — contradictory for anything deciding automatically.
 * It now covers every state an install would fix, and `healthy`/`reasons` say
 * which, so a caller never has to combine three fields itself.
 *
 * A manifest problem is not an install problem. `rojo = "rojo-rbx/rojo"` and
 * `rojo = "nonsense"` both left `manifestVersion` and `matchesManifest`
 * undefined, which matched no branch here, so an installed shim made the whole
 * manifest report `healthy: true, action: 'none'` — while `install()` refuses
 * `allowPinnedToolDownloads` for exactly those specs. `verify --strict` passed a
 * toolchain that cannot be restored unattended.
 */
function summarize(tools: ToolStatus[]) {
  const reasons: string[] = [];
  for (const tool of tools) {
    if (tool.unsafeToolName) reasons.push(`${tool.name}: unsafe tool name in the manifest`);
    else if (!tool.validSpec) reasons.push(`${tool.name}: spec ${JSON.stringify(tool.spec)} is not "owner/repo" or "owner/repo@version"`);
    else if (!tool.exactPin) {
      reasons.push(`${tool.name}: spec ${JSON.stringify(tool.spec)} is not pinned to an exact version, so an unattended install is refused`);
    } else if (!tool.shimInstalled) reasons.push(`${tool.name}: no installed shim`);
    else if (tool.runningVersion === undefined) reasons.push(`${tool.name}: shim did not report a version`);
    else if (tool.matchesManifest === false) {
      reasons.push(`${tool.name}: running ${tool.runningVersion}, manifest pins ${tool.manifestVersion}`);
    }
  }
  // Installing cannot fix any of these; only editing the manifest can.
  const manifestProblem = tools.some((tool) => tool.unsafeToolName || !tool.validSpec || !tool.exactPin);
  return {
    tools,
    installRequired: reasons.length > 0 && !manifestProblem,
    healthy: reasons.length === 0,
    action: reasons.length === 0 ? 'none' : manifestProblem ? 'fix-manifest' : 'install',
    reasons,
  };
}

export class RokitTools {
  detect(root?: string): RokitDetection {
    const canonicalRoot = resolveProjectRoot(root ?? process.cwd());
    for (const toolchain of TOOLCHAINS) {
      const manifest = loadManifest(canonicalRoot, toolchain.manifest);
      if (!manifest) continue;
      return {
        root: canonicalRoot,
        kind: toolchain.kind,
        manifestPath: manifest.path,
        mtimeMs: manifest.mtimeMs,
        // aftman.toml is read as-is. Migrating it to rokit.toml is the user's
        // decision, never a side effect of reading.
        legacy: toolchain.kind === 'aftman',
        cliAvailable: hasCommand(toolchain.kind),
      };
    }
    return { root: canonicalRoot, legacy: false, cliAvailable: hasCommand('rokit') };
  }

  private require(root?: string): { detection: RokitDetection; manifest: ManifestFile; kind: ToolchainKind } {
    const detection = this.detect(root);
    if (!detection.kind || !detection.manifestPath) {
      throw new Error(`No rokit.toml or aftman.toml found at or above ${detection.root}`);
    }
    const toolchain = TOOLCHAINS.find((entry) => entry.kind === detection.kind)!;
    const manifest = loadManifest(detection.root, toolchain.manifest)!;
    return { detection, manifest, kind: detection.kind };
  }

  /** Read-only: never rewrites the manifest, never installs anything. */
  getManifest(root?: string) {
    const { detection, manifest } = this.require(root);
    const tools = asStringMap(manifest.data.tools);
    return {
      ...detection,
      tools: Object.entries(tools).map(([name, spec]) => {
        const parsed = TOOL_SPEC.exec(spec)?.groups;
        return {
          name,
          spec,
          owner: parsed?.owner,
          repo: parsed?.repo,
          version: parsed?.version,
          valid: parsed !== undefined,
        };
      }),
    };
  }

  listTools(root?: string) {
    const { detection, kind } = this.require(root);
    return { ...detection, ...run(kind, ['list'], { cwd: detection.root }) };
  }

  /**
   * Reports the three versions that can disagree: what the manifest pins, what
   * the installed shim is, and what actually runs when the tool is invoked.
   */
  status(root?: string) {
    const { detection, manifest, kind } = this.require(root);
    const tools = asStringMap(manifest.data.tools);
    return {
      ...detection,
      binDirectory: binDirectory(
        TOOLCHAINS.find((entry) => entry.kind === kind)!.rootEnv,
        TOOLCHAINS.find((entry) => entry.kind === kind)!.home,
      ),
      ...summarize(Object.entries(tools).map(([name, spec]) => {
        const parsed = TOOL_SPEC.exec(spec)?.groups;
        const manifestVersion = parsed?.version;
        // The name comes from project data, so it is validated before it is ever
        // turned into a path — and only the resolved shim path is executed.
        const safeName = /^[\w.-]+$/.test(name) ? name : undefined;
        const shim = safeName ? shimFor(kind, safeName) : undefined;
        const shimInstalled = shim !== undefined && fs.existsSync(shim);
        const probe = shim && shimInstalled ? probeVersion(shim, detection.root) : undefined;
        return {
          name,
          spec,
          manifestVersion,
          shim,
          shimInstalled,
          unsafeToolName: safeName === undefined,
          validSpec: parsed !== undefined,
          exactPin: EXACT_VERSION.test(manifestVersion ?? ''),
          runningVersion: probe?.version,
          probeOutput: probe?.output,
          matchesManifest: manifestVersion !== undefined && probe?.version !== undefined
            ? versionMatches(probe.version, manifestVersion)
            : undefined,
        };
      })),
    };
  }

  /**
   * Runs the manifest's install.
   *
   * Rokit asks for trust before downloading a source it has not seen. A prompt
   * has nowhere to go here — stdin is not a terminal — so the run would hang or
   * fail on a fresh machine. Trust is skipped only when every declared tool is
   * an exact `owner/repo@x.y.z` pin from the manifest the caller just reviewed,
   * and only when the caller opts in with `allowPinnedToolDownloads`. A loose
   * requirement or an unparsable spec is refused, never silently trusted.
   */
  install(
    root?: string,
    confirm = false,
    allowPinnedToolDownloads = false,
  ): QualityCheck & { root?: string; manifestPath?: string; trustedSources?: string[] } {
    const { detection, manifest, kind } = this.require(root);
    const toolchain = TOOLCHAINS.find((entry) => entry.kind === kind)!;
    const specs = Object.entries(asStringMap(manifest.data.tools));
    const parsed = specs.map(([name, spec]) => ({ name, spec, groups: TOOL_SPEC.exec(spec)?.groups }));
    const loose = parsed.filter((entry) => !entry.groups || !/^\d+\.\d+\.\d+$/.test(entry.groups.version ?? ''));
    const sources = parsed.map((entry) => `${entry.groups?.owner}/${entry.groups?.repo}@${entry.groups?.version}`);

    if (!confirm) {
      return {
        tool: kind,
        available: hasCommand(kind, detection.root),
        ok: false,
        error: `Confirmation required: pass confirm=true to run "${kind} install" for ${detection.manifestPath}. It downloads ${specs.length} tool(s) from the network and writes executables into ${binDirectory(toolchain.rootEnv, toolchain.home)}.`,
        ...(loose.length === 0 ? { trustedSources: sources } : {}),
      };
    }

    const nonInteractive = allowPinnedToolDownloads && loose.length > 0
      ? undefined
      : allowPinnedToolDownloads;
    if (allowPinnedToolDownloads && loose.length > 0) {
      return {
        tool: kind,
        available: hasCommand(kind, detection.root),
        ok: false,
        error: `allowPinnedToolDownloads requires every tool to be pinned to an exact version. ${loose.map((entry) => `${entry.name} = "${entry.spec}"`).join(', ')} ${loose.length === 1 ? 'is' : 'are'} not.`,
      };
    }

    const result = run(kind, nonInteractive ? ['install', '--no-trust-check'] : ['install'], { cwd: detection.root });
    // Newly installed shims change how every pinned tool resolves for this project.
    clearRojoCommandCache();
    return {
      ...result,
      root: detection.root,
      manifestPath: detection.manifestPath,
      ...(nonInteractive ? { trustedSources: sources } : {}),
    };
  }

  /**
   * Never edits the manifest directly: versions are resolved and written by
   * `rokit add`, so a hand-written pin cannot drift from the lock Rokit keeps.
   */
  addTool(
    root: string | undefined,
    spec: string,
    confirm = false,
    expectedPlanHash?: string,
  ): QualityCheck & { spec: string; manifestHash?: string; planHash?: string } {
    const { detection, kind } = this.require(root);
    const checked = requireSafeSpec(spec);
    const manifestHash = fileHash(detection.manifestPath);
    const planHash = planHashOf('rokit_add_tool', { spec: checked }, [detection.manifestPath]);
    if (!confirm) {
      return {
        tool: kind,
        available: hasCommand(kind, detection.root),
        ok: false,
        error: `Confirmation required: pass confirm=true to run "${kind} add ${checked}" in ${detection.root}. It edits ${detection.manifestPath} and downloads the tool.`,
        spec: checked,
        manifestHash,
        planHash,
      };
    }
    const mismatch = planHashMismatch(expectedPlanHash, planHash, 'rokit_add_tool_plan');
    if (mismatch) {
      return { tool: kind, available: hasCommand(kind, detection.root), ok: false, error: mismatch, spec: checked, manifestHash, planHash };
    }
    const result = run(kind, ['add', checked], { cwd: detection.root });
    clearRojoCommandCache();
    return { ...result, spec: checked, manifestHash, planHash };
  }

  update(
    root: string | undefined,
    tool?: string,
    confirm = false,
    expectedPlanHash?: string,
  ): QualityCheck & { tool_name?: string; manifestHash?: string; planHash?: string } {
    const { detection, kind } = this.require(root);
    const checked = tool === undefined ? undefined : requireSafeTool(tool);
    const manifestHash = fileHash(detection.manifestPath);
    const planHash = planHashOf('rokit_update', { tool: checked ?? null }, [detection.manifestPath]);
    if (!confirm) {
      return {
        tool: kind,
        available: hasCommand(kind, detection.root),
        ok: false,
        error: `Confirmation required: pass confirm=true to run "${kind} update${checked ? ` ${checked}` : ''}" in ${detection.root}. It edits ${detection.manifestPath} and downloads new versions.`,
        tool_name: checked,
        manifestHash,
        planHash,
      };
    }
    const mismatch = planHashMismatch(expectedPlanHash, planHash, 'rokit_update_plan');
    if (mismatch) {
      return { tool: kind, available: hasCommand(kind, detection.root), ok: false, error: mismatch, tool_name: checked, manifestHash, planHash };
    }
    const result = run(kind, checked ? ['update', checked] : ['update'], { cwd: detection.root });
    clearRojoCommandCache();
    return { ...result, tool_name: checked, manifestHash, planHash };
  }
}
