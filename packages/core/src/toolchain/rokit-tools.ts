import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { clearRojoCommandCache } from '../rojo/command-runner.js';
import { resolveProjectRoot } from '../rojo/source-mapper.js';
import { hasCommand, run, type QualityCheck } from '../quality-tools.js';
import { asStringMap, loadManifest, type ManifestFile } from './manifest.js';

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
      tools: Object.entries(tools).map(([name, spec]) => {
        const manifestVersion = TOOL_SPEC.exec(spec)?.groups?.version;
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
          runningVersion: probe?.version,
          probeOutput: probe?.output,
          matchesManifest: manifestVersion !== undefined && probe?.version !== undefined
            ? probe.version.includes(manifestVersion)
            : undefined,
        };
      }),
      installRequired: Object.entries(tools).some(([name]) =>
        !/^[\w.-]+$/.test(name) || !fs.existsSync(shimFor(kind, name))),
    };
  }

  install(root?: string, confirm = false): QualityCheck & { root?: string; manifestPath?: string } {
    const { detection, kind } = this.require(root);
    if (!confirm) {
      return {
        tool: kind,
        available: hasCommand(kind),
        ok: false,
        error: `Confirmation required: pass confirm=true to run "${kind} install" for ${detection.manifestPath}. It downloads tools from the network and writes executables into ${binDirectory(TOOLCHAINS.find((entry) => entry.kind === kind)!.rootEnv, TOOLCHAINS.find((entry) => entry.kind === kind)!.home)}.`,
      };
    }
    const result = run(kind, ['install'], { cwd: detection.root });
    // Newly installed shims change how Rojo resolves for this project.
    clearRojoCommandCache();
    return { ...result, root: detection.root, manifestPath: detection.manifestPath };
  }

  /**
   * Never edits the manifest directly: versions are resolved and written by
   * `rokit add`, so a hand-written pin cannot drift from the lock Rokit keeps.
   */
  addTool(root: string | undefined, spec: string, confirm = false): QualityCheck & { spec: string } {
    const { detection, kind } = this.require(root);
    const checked = requireSafeSpec(spec);
    if (!confirm) {
      return {
        tool: kind,
        available: hasCommand(kind),
        ok: false,
        error: `Confirmation required: pass confirm=true to run "${kind} add ${checked}" in ${detection.root}. It edits ${detection.manifestPath} and downloads the tool.`,
        spec: checked,
      };
    }
    const result = run(kind, ['add', checked], { cwd: detection.root });
    clearRojoCommandCache();
    return { ...result, spec: checked };
  }

  update(root: string | undefined, tool?: string, confirm = false): QualityCheck & { tool_name?: string } {
    const { detection, kind } = this.require(root);
    const checked = tool === undefined ? undefined : requireSafeTool(tool);
    if (!confirm) {
      return {
        tool: kind,
        available: hasCommand(kind),
        ok: false,
        error: `Confirmation required: pass confirm=true to run "${kind} update${checked ? ` ${checked}` : ''}" in ${detection.root}. It edits ${detection.manifestPath} and downloads new versions.`,
        tool_name: checked,
      };
    }
    const result = run(kind, checked ? ['update', checked] : ['update'], { cwd: detection.root });
    clearRojoCommandCache();
    return { ...result, tool_name: checked };
  }
}
