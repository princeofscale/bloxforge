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
    const known = new Map(lock.packages.map((entry) => [entry.name, entry] as const));
    const edges = lock.packages.flatMap((entry) => entry.dependencies.map((dependency) => {
      const target = known.get(packageName(dependency.package));
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
        missing: manifestDependencies(manifest.data).map((entry) => entry.spec),
      };
    }
    const packages = lockPackages(lock.data);
    const locked = new Set(packages.map((entry) => entry.name));
    const declared = manifestDependencies(manifest.data);
    const missing = declared.filter((entry) => !locked.has(packageName(entry.spec)));
    const withoutChecksum = packages.filter((entry) => !entry.checksum).map((entry) => entry.name);
    return {
      root: manifest.directory,
      lockPath: lock.path,
      ok: missing.length === 0,
      present: true,
      declared: declared.length,
      locked: packages.length,
      missing: missing.map((entry) => `${entry.alias} = ${entry.spec}`),
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
    const tree = JSON.stringify(project.tree);
    const present = PACKAGE_DIRECTORIES.filter((name) => fs.existsSync(path.join(manifest.directory, name)));
    const mapped = present.filter((name) => tree.includes(name));
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

  installPlan(root?: string) {
    const { manifest, lock } = this.load(root);
    return {
      root: manifest.directory,
      command: `wally install${lock ? ' --locked' : ''}`,
      lockPresent: lock !== undefined,
      validation: this.validateLock(root),
      confirmationRequired: true,
      warning: lock
        ? 'Runs with --locked: the install fails rather than silently rewriting wally.lock.'
        : 'No wally.lock exists, so --locked cannot be used. The install will resolve versions and create one.',
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
