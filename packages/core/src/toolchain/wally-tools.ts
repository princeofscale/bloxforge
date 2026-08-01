import * as fs from 'node:fs';
import * as path from 'node:path';
import { selectRojoProject } from '../rojo/project-discovery.js';
import { resolveProjectRoot } from '../rojo/source-mapper.js';
import { hasCommand, run, type QualityCheck } from '../quality-tools.js';
import { asStringMap, loadManifest } from './manifest.js';
import type { TomlTable, TomlValue } from './toml.js';

const DEPENDENCY_SECTIONS = ['dependencies', 'server-dependencies', 'dev-dependencies'] as const;
const REALM_BY_SECTION: Record<string, string> = {
  dependencies: 'shared',
  'server-dependencies': 'server',
  'dev-dependencies': 'dev',
};
/** Rojo project trees conventionally mount Wally output under these names. */
const PACKAGE_DIRECTORIES = ['Packages', 'ServerPackages', 'DevPackages'];

export interface WallyPackage {
  name: string;
  version: string;
  realm?: string;
  checksum?: string;
  registry?: string;
  dependencies: Array<{ alias: string; package: string }>;
}

function requireSafeArgument(value: string, label: string): string {
  if (!value || value.startsWith('-')) throw new Error(`${label} must not be empty or option-shaped`);
  if (!/^[\w./@^~=<>* +-]+$/.test(value)) throw new Error(`${label} contains unsupported characters`);
  return value;
}

/** `dependencies = [["Alias", "scope/name@1.0.0"], ...]` in a real wally.lock. */
function lockDependencies(value: TomlValue | undefined): Array<{ alias: string; package: string }> {
  if (!Array.isArray(value)) return [];
  const out: Array<{ alias: string; package: string }> = [];
  for (const entry of value) {
    if (Array.isArray(entry) && typeof entry[0] === 'string' && typeof entry[1] === 'string') {
      out.push({ alias: entry[0], package: entry[1] });
    } else if (typeof entry === 'string') {
      out.push({ alias: entry, package: entry });
    }
  }
  return out;
}

function lockPackages(lock: TomlTable): WallyPackage[] {
  const blocks = lock.package;
  if (!Array.isArray(blocks)) return [];
  const packages: WallyPackage[] = [];
  for (const block of blocks) {
    if (!block || typeof block !== 'object' || Array.isArray(block)) continue;
    const entry = block as TomlTable;
    if (typeof entry.name !== 'string' || typeof entry.version !== 'string') continue;
    packages.push({
      name: entry.name,
      version: entry.version,
      realm: typeof entry.realm === 'string' ? entry.realm : undefined,
      checksum: typeof entry.checksum === 'string' ? entry.checksum : undefined,
      registry: typeof entry.registry === 'string' ? entry.registry : undefined,
      dependencies: lockDependencies(entry.dependencies),
    });
  }
  return packages;
}

function manifestDependencies(manifest: TomlTable): Array<{ alias: string; spec: string; realm: string; section: string }> {
  const out: Array<{ alias: string; spec: string; realm: string; section: string }> = [];
  for (const section of DEPENDENCY_SECTIONS) {
    for (const [alias, spec] of Object.entries(asStringMap(manifest[section]))) {
      out.push({ alias, spec, realm: REALM_BY_SECTION[section], section });
    }
  }
  return out;
}

/** "scope/name@^1.2.3" -> "scope/name". */
function packageName(spec: string): string {
  return spec.split('@')[0];
}

/** "scope/name@^1.2.3" -> "^1.2.3", or undefined when the spec has no version. */
function packageRequirement(spec: string): string | undefined {
  const at = spec.indexOf('@');
  return at < 0 ? undefined : spec.slice(at + 1);
}

/**
 * Whether a locked version satisfies a manifest requirement.
 *
 * ponytail: handles the forms Wally manifests actually use — an exact version,
 * a caret or tilde range, a partial `1.2` prefix, and `*`. Anything else, and
 * any locked prerelease, is reported as unverifiable rather than silently
 * passing. Swap in a real semver matcher if manifests start carrying compound
 * ranges or prerelease requirements.
 */
function satisfiesRequirement(locked: string, requirement: string): boolean | undefined {
  const wanted = requirement.trim();
  if (!wanted || wanted === '*') return true;
  const match = /^([\^~]?)(\d+(?:\.\d+){0,2})$/.exec(wanted);
  if (!match) return undefined;
  const [, operator, version] = match;
  // Cargo excludes prereleases from a plain requirement: 1.0.0-alpha does not
  // satisfy ^1.0.0. Stripping the suffix and comparing numbers said it did, so
  // say "cannot verify" instead of guessing at Cargo's prerelease rules.
  if (/[-+]/.test(locked)) return undefined;
  const lockedParts = locked.split('.').slice(0, 3).map(Number);
  const wantedParts = version.split('.').map(Number);
  if (lockedParts.some(Number.isNaN) || wantedParts.some(Number.isNaN)) return undefined;
  const [lockedMajor = 0, lockedMinor = 0, lockedPatch = 0] = lockedParts;
  const [wantedMajor = 0, wantedMinor = 0, wantedPatch = 0] = wantedParts;
  const atLeast = lockedMajor > wantedMajor
    || (lockedMajor === wantedMajor && (lockedMinor > wantedMinor
      || (lockedMinor === wantedMinor && lockedPatch >= wantedPatch)));
  if (operator === '^') {
    // Wally follows Cargo: below 1.0.0 a caret pins the leading non-zero field.
    if (wantedMajor > 0) return lockedMajor === wantedMajor && atLeast;
    if (wantedMinor > 0) return lockedMajor === 0 && lockedMinor === wantedMinor && atLeast;
    return lockedMajor === 0 && lockedMinor === 0 && lockedPatch === wantedPatch;
  }
  if (operator === '~') {
    // Cargo again: `~1.2.3` and `~1.2` are >=x, <1.3.0, but a bare `~1` widens
    // to the whole major — >=1.0.0, <2.0.0.
    if (wantedParts.length === 1) return lockedMajor === wantedMajor;
    return lockedMajor === wantedMajor && lockedMinor === wantedMinor && atLeast;
  }
  // A bare "1.2" is a prefix; a bare "1.2.3" is exact.
  return wantedParts.every((part, index) => part === lockedParts[index]);
}

/** Windows and macOS fold path case by default; Linux does not, and there
 * `Packages` and `packages` really are different directories. Folding
 * everywhere reported a mount Rojo would fail to resolve as mapped. */
function casePath(value: string): string {
  return process.platform === 'linux' ? value : value.toLowerCase();
}

/** Every `$path` value in a Rojo project tree, at any depth. */
function collectProjectPaths(node: unknown, out: string[] = []): string[] {
  if (!node || typeof node !== 'object') return out;
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === '$path' && typeof value === 'string') out.push(value);
    else if (key === '$path' && value && typeof value === 'object') {
      const optional = (value as { optional?: unknown }).optional;
      if (typeof optional === 'string') out.push(optional);
    } else if (value && typeof value === 'object') collectProjectPaths(value, out);
  }
  return out;
}

export class WallyTools {
  private load(root?: string) {
    const canonicalRoot = resolveProjectRoot(root ?? process.cwd());
    const manifest = loadManifest(canonicalRoot, 'wally.toml');
    if (!manifest) throw new Error(`No wally.toml found at or above ${canonicalRoot}`);
    const lock = loadManifest(manifest.directory, 'wally.lock');
    return { root: manifest.directory, manifest, lock };
  }

  getManifest(root?: string) {
    const { manifest } = this.load(root);
    const meta = (manifest.data.package ?? {}) as TomlTable;
    return {
      root: manifest.directory,
      manifestPath: manifest.path,
      mtimeMs: manifest.mtimeMs,
      package: {
        name: typeof meta.name === 'string' ? meta.name : undefined,
        version: typeof meta.version === 'string' ? meta.version : undefined,
        registry: typeof meta.registry === 'string' ? meta.registry : undefined,
        realm: typeof meta.realm === 'string' ? meta.realm : undefined,
      },
      dependencies: manifestDependencies(manifest.data),
    };
  }

  getLock(root?: string) {
    const { manifest, lock } = this.load(root);
    if (!lock) {
      return { root: manifest.directory, lockPath: undefined, present: false, packages: [] as WallyPackage[] };
    }
    return {
      root: manifest.directory,
      lockPath: lock.path,
      mtimeMs: lock.mtimeMs,
      present: true,
      registry: typeof lock.data.registry === 'string' ? lock.data.registry : undefined,
      packages: lockPackages(lock.data),
    };
  }

  /**
   * Real package identities and edges from the `[[package]]` blocks. The previous
   * implementation matched `key =` lines and returned TOML field names such as
   * "name" and "dependencies" instead of packages.
   */
  dependencyGraph(root?: string) {
    const lock = this.getLock(root);
    const nodes = lock.packages.map((entry) => ({
      id: `${entry.name}@${entry.version}`,
      name: entry.name,
      version: entry.version,
      realm: entry.realm,
      checksum: entry.checksum,
    }));
    // Keyed by name@version, not by name: a lockfile legitimately carries two
    // versions of one package, and a name-keyed map kept whichever came last and
    // pointed every edge at it.
    const known = new Map<string, WallyPackage>(lock.packages.map((entry) => [`${entry.name}@${entry.version}`, entry]));
    const byName = new Map<string, WallyPackage[]>();
    for (const entry of lock.packages) {
      byName.set(entry.name, [...(byName.get(entry.name) ?? []), entry]);
    }
    const edges = lock.packages.flatMap((entry) => entry.dependencies.map((dependency) => {
      const name = packageName(dependency.package);
      const requirement = packageRequirement(dependency.package);
      const candidates = byName.get(name) ?? [];
      // No trailing single-candidate fallback: it used to resolve an edge whose
      // only candidate did *not* satisfy the requirement, so `unresolved` stayed
      // empty and validateLock could report ok for a lock whose transitive edge
      // points at a version the parent package rejects. Declared requirements
      // are already treated strictly; edges get the same rule.
      const target = known.get(dependency.package)
        ?? (requirement === undefined
          ? (candidates.length === 1 ? candidates[0] : undefined)
          : candidates.find((candidate) => satisfiesRequirement(candidate.version, requirement) === true));
      return {
        from: `${entry.name}@${entry.version}`,
        alias: dependency.alias,
        to: target ? `${target.name}@${target.version}` : dependency.package,
        resolved: target !== undefined,
      };
    }));
    return {
      root: lock.root,
      lockPath: lock.lockPath,
      registry: lock.registry,
      nodes,
      edges,
      unresolved: edges.filter((edge) => !edge.resolved).map((edge) => edge.to),
    };
  }

  validateLock(root?: string) {
    const { manifest, lock } = this.load(root);
    if (!lock) {
      return {
        root: manifest.directory,
        ok: false,
        present: false,
        error: 'wally.lock is missing; run wally_install_apply (which uses --locked in CI) to produce one',
        // Same shape as the present-lock branch below, so one parser handles both.
        missing: manifestDependencies(manifest.data).map((entry) => `${entry.alias} = ${entry.spec}`),
      };
    }
    const packages = lockPackages(lock.data);
    const byName = new Map<string, WallyPackage[]>();
    for (const entry of packages) byName.set(entry.name, [...(byName.get(entry.name) ?? []), entry]);
    const declared = manifestDependencies(manifest.data);

    // Names alone are not enough: a manifest asking for roblox/roact@2.0.0
    // against a lock pinning 1.4.4 matched on the name and validated as ok.
    const missing: typeof declared = [];
    const mismatched: Array<{ alias: string; spec: string; locked: string }> = [];
    const unverifiable: Array<{ alias: string; spec: string; locked: string }> = [];
    for (const entry of declared) {
      const candidates = byName.get(packageName(entry.spec)) ?? [];
      if (candidates.length === 0) {
        missing.push(entry);
        continue;
      }
      const requirement = packageRequirement(entry.spec);
      if (requirement === undefined) continue;
      const results = candidates.map((candidate) => ({
        candidate,
        satisfied: satisfiesRequirement(candidate.version, requirement),
      }));
      if (results.some((result) => result.satisfied === true)) continue;
      const versions = candidates.map((candidate) => candidate.version).join(', ');
      // A requirement shape the matcher does not understand is reported as
      // unverified, never as satisfied.
      if (results.every((result) => result.satisfied === undefined)) {
        unverifiable.push({ alias: entry.alias, spec: entry.spec, locked: versions });
      } else {
        mismatched.push({ alias: entry.alias, spec: entry.spec, locked: versions });
      }
    }

    const withoutChecksum = packages
      .filter((entry) => !entry.checksum)
      .map((entry) => `${entry.name}@${entry.version}`);
    const graph = this.dependencyGraph(root);
    return {
      root: manifest.directory,
      lockPath: lock.path,
      ok: missing.length === 0
        && mismatched.length === 0
        && unverifiable.length === 0
        && graph.unresolved.length === 0,
      present: true,
      declared: declared.length,
      locked: packages.length,
      missing: missing.map((entry) => `${entry.alias} = ${entry.spec}`),
      mismatched,
      unverifiable,
      unresolved: graph.unresolved,
      withoutChecksum,
    };
  }

  /**
   * Confirms the installed package directories are actually mounted by the
   * selected Rojo project; an install nothing references is invisible in Studio.
   */
  verifyRojoMapping(root?: string, projectFile?: string) {
    const { manifest } = this.load(root);
    const project = selectRojoProject(manifest.directory, projectFile);
    // Compare resolved $path values, not a substring of the stringified tree:
    // "Packages" is a substring of "ServerPackages", so a project mounting only
    // ServerPackages reported both as mapped.
    const mountedPaths = new Set(
      collectProjectPaths(project.tree).map((value) =>
        casePath(path.resolve(manifest.directory, value))),
    );
    const present = PACKAGE_DIRECTORIES.filter((name) => fs.existsSync(path.join(manifest.directory, name)));
    const mapped = present.filter((name) =>
      mountedPaths.has(casePath(path.resolve(manifest.directory, name))));
    return {
      root: manifest.directory,
      projectFile: project.projectFile,
      packageDirectories: present,
      mapped,
      unmapped: present.filter((name) => !mapped.includes(name)),
      ok: present.length > 0 && present.length === mapped.length,
      reason: present.length === 0
        ? 'No Packages/ServerPackages/DevPackages directory exists yet; run a Wally install first'
        : undefined,
    };
  }

  search(root: string | undefined, query: string): QualityCheck & { query: string } {
    const { manifest } = this.load(root);
    const checked = requireSafeArgument(query, 'query');
    return { ...run('wally', ['search', checked], { cwd: manifest.directory }), query: checked };
  }

  /**
   * `--locked` is not in released Wally 0.3.2 — it landed after it. Probing
   * beats assuming: silently dropping the flag would rewrite the lockfile,
   * which is the exact outcome `--locked` exists to prevent.
   */
  supportsLocked(root?: string): boolean {
    const { manifest } = this.load(root);
    const help = run('wally', ['install', '--help'], { cwd: manifest.directory });
    return help.available && (help.output ?? '').includes('--locked');
  }

  installPlan(root?: string) {
    const { manifest, lock } = this.load(root);
    const lockedSupported = this.supportsLocked(root);
    const useLocked = lockedSupported && lock !== undefined;
    return {
      root: manifest.directory,
      command: `wally install${useLocked ? ' --locked' : ''}`,
      lockPresent: lock !== undefined,
      lockedSupported,
      validation: this.validateLock(root),
      confirmationRequired: true,
      warning: useLocked
        ? 'Runs with --locked: the install fails rather than silently rewriting wally.lock.'
        : lockedSupported
          ? 'No wally.lock exists, so --locked cannot be used. The install will resolve versions and create one.'
          : 'The installed Wally does not support --locked (it is missing from 0.3.2). This install can rewrite wally.lock; review the diff afterwards or install a Wally build that supports --locked.',
    };
  }

  /** `--locked` is the default so an install can never silently move the lock. */
  installApply(root?: string, confirm = false, locked = true): QualityCheck & { root?: string; locked?: boolean } {
    const { manifest, lock } = this.load(root);
    if (!confirm) {
      return {
        tool: 'wally',
        available: hasCommand('wally'),
        ok: false,
        error: 'Confirmation required: review wally_install_plan, then pass confirm=true. Installing downloads packages from the registry and writes into the project.',
      };
    }
    if (locked && lock !== undefined && !this.supportsLocked(root)) {
      return {
        tool: 'wally',
        available: hasCommand('wally'),
        ok: false,
        error: 'The installed Wally does not support "wally install --locked" (it is missing from the 0.3.2 release). Refusing to run an unlocked install that could rewrite wally.lock; pass locked=false to accept that, or install a Wally build that supports --locked.',
        locked: true,
      };
    }
    const useLocked = locked && lock !== undefined;
    const result = run('wally', useLocked ? ['install', '--locked'] : ['install'], { cwd: manifest.directory });
    return { ...result, root: manifest.directory, locked: useLocked };
  }

  updatePlan(root?: string, packages: string[] = []) {
    const { manifest } = this.load(root);
    const checked = packages.map((entry) => requireSafeArgument(entry, 'package'));
    return {
      root: manifest.directory,
      command: `wally update${checked.length ? ` ${checked.join(' ')}` : ''}`,
      packages: checked,
      before: this.dependencyGraph(root),
      confirmationRequired: true,
      warning: 'Updating rewrites wally.lock and can change every transitive version.',
    };
  }

  updateApply(root: string | undefined, packages: string[] = [], confirm = false): QualityCheck & { packages: string[] } {
    const { manifest } = this.load(root);
    const checked = packages.map((entry) => requireSafeArgument(entry, 'package'));
    if (!confirm) {
      return {
        tool: 'wally',
        available: hasCommand('wally'),
        ok: false,
        error: 'Confirmation required: review wally_update_plan, then pass confirm=true. Updating rewrites wally.lock.',
        packages: checked,
      };
    }
    return {
      ...run('wally', ['update', ...checked], { cwd: manifest.directory }),
      packages: checked,
    };
  }
}
