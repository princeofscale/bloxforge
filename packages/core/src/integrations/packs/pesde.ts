// pesde as a second package provider, beside Wally rather than instead of it.
//
// Roadmap 04, item 7. The contract already exists — read the manifest, read the
// lock, plan, never install silently — so this pack is that contract under a
// different manager, not a new set of ideas.
//
// Verified against the primary source rather than remembered (`pesde-pkg/pesde`
// at main):
//
//   - `src/lib.rs`: `MANIFEST_FILE_NAME = "pesde.toml"`, `LOCKFILE_FILE_NAME = "pesde.lock"`.
//   - `docs/…/reference/cli.mdx`: **`pesde install --locked` exists** — "whether
//     to error if the lockfile is out of date". Worth stating plainly, because
//     the equivalent assumption about Wally was wrong: `wally install --locked`
//     is absent from the released 0.3.2, and this repository has a workaround
//     for that. pesde needs no workaround.
//   - `docs/…/reference/manifest.mdx`: `[target] environment` is one of `luau`,
//     `lune`, `roblox`, `roblox_server`; dependencies are
//     `{ name = "scope/pkg", version, index }` for pesde packages and
//     `{ wally = "scope/pkg", version, index }` for Wally ones.

import { parseToml, type TomlTable, type TomlValue } from '../../toolchain/toml.js';
import { digestOf, type Check, type Detection, type DraftPlan, type IntegrationPack, type PackContext, type PackStep } from '../pack.js';

const MANIFEST = 'pesde.toml';
const LOCKFILE = 'pesde.lock';

/** Environments that put code inside a Roblox place. */
const ROBLOX_ENVIRONMENTS = new Set(['roblox', 'roblox_server']);

function at(ctx: PackContext, rel: string): string {
  return `${ctx.root}/${rel}`;
}

function table(value: TomlValue | undefined): TomlTable | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
}

interface Manifest {
  raw: TomlTable;
  name?: string;
  version?: string;
  environment?: string;
  dependencies: DependencyRow[];
  indices: Record<string, string>;
  wallyIndices: Record<string, string>;
}

export interface DependencyRow {
  alias: string;
  /** `pesde`, `wally`, or `other` for the git/path/workspace forms. */
  kind: 'pesde' | 'wally' | 'other';
  name?: string;
  version?: string;
  index?: string;
  section: 'dependencies' | 'dev_dependencies' | 'peer_dependencies';
}

/**
 * Read `pesde.toml`, or nothing.
 *
 * A manifest that does not parse comes back as `undefined` rather than as an
 * empty one: an empty manifest reports zero dependencies, which is a sentence
 * about the project rather than about the parse.
 */
function readManifest(ctx: PackContext): Manifest | undefined {
  const raw = ctx.readFile(at(ctx, MANIFEST));
  if (raw === null) return undefined;
  let parsed: TomlTable;
  try {
    parsed = parseToml(raw);
  } catch {
    return undefined;
  }

  const target = table(parsed.target);
  const dependencies: DependencyRow[] = [];
  for (const section of ['dependencies', 'dev_dependencies', 'peer_dependencies'] as const) {
    const block = table(parsed[section]);
    for (const [alias, spec] of Object.entries(block ?? {})) {
      const entry = table(spec);
      const name = typeof entry?.name === 'string' ? entry.name : undefined;
      const wally = typeof entry?.wally === 'string' ? entry.wally : undefined;
      dependencies.push({
        alias,
        kind: name ? 'pesde' : wally ? 'wally' : 'other',
        name: name ?? wally,
        version: typeof entry?.version === 'string' ? entry.version : undefined,
        index: typeof entry?.index === 'string' ? entry.index : undefined,
        section,
      });
    }
  }

  const stringMap = (value: TomlValue | undefined): Record<string, string> =>
    Object.fromEntries(Object.entries(table(value) ?? {}).filter(([, v]) => typeof v === 'string')) as Record<string, string>;

  return {
    raw: parsed,
    name: typeof parsed.name === 'string' ? parsed.name : undefined,
    version: typeof parsed.version === 'string' ? parsed.version : undefined,
    environment: typeof target?.environment === 'string' ? target.environment : undefined,
    dependencies: dependencies.sort((a, b) => a.alias.localeCompare(b.alias)),
    indices: stringMap(parsed.indices),
    wallyIndices: stringMap(parsed.wally_indices),
  };
}

async function detect(ctx: PackContext, _request: Readonly<Record<string, unknown>>): Promise<Detection> {
  const raw = ctx.readFile(at(ctx, MANIFEST));
  const manifest = readManifest(ctx);
  const lock = ctx.readFile(at(ctx, LOCKFILE));

  const evidence: string[] = [];
  if (raw === null) evidence.push(`no ${MANIFEST}`);
  else if (!manifest) evidence.push(`${MANIFEST} exists but does not parse as TOML`);
  else {
    evidence.push(`${MANIFEST} declares ${manifest.name ?? '(unnamed)'}${manifest.version ? `@${manifest.version}` : ''}`);
    evidence.push(`target environment ${manifest.environment ?? '(unset)'}`);
    evidence.push(`${manifest.dependencies.length} dependency row(s)`);
  }
  evidence.push(lock === null ? `no ${LOCKFILE}` : `${LOCKFILE} present`);

  return {
    present: manifest !== undefined,
    evidence,
    ...(manifest?.version ? { version: manifest.version } : {}),
    variant: manifest === undefined ? 'absent' : lock === null ? 'unlocked' : 'locked',
    detail: {
      packageName: manifest?.name,
      environment: manifest?.environment,
      // Two providers in one manifest is normal for pesde and worth surfacing:
      // a Wally-sourced dependency resolves through a different index, so
      // "which registry did this come from" has two possible answers.
      dependencies: manifest?.dependencies,
      indices: manifest?.indices,
      wallyIndices: manifest?.wallyIndices,
      hasLockfile: lock !== null,
    },
  };
}

async function plan(ctx: PackContext, request: Readonly<Record<string, unknown>>): Promise<DraftPlan> {
  const manifest = readManifest(ctx);
  const lock = ctx.readFile(at(ctx, LOCKFILE));
  const expectations = [MANIFEST, LOCKFILE].map((rel) => ({ path: at(ctx, rel), digest: digestOf(ctx.readFile(at(ctx, rel))) }));

  if (!manifest) {
    return {
      steps: [],
      expectations,
      detail: { reason: `No usable ${MANIFEST} at ${ctx.root}; there is nothing to install.` },
    };
  }

  const steps: PackStep[] = [];
  if (lock === null) {
    // Installing without a lock resolves versions — that is choosing, not
    // restoring, and it is the same line `project_reconcile` draws.
    steps.push({
      id: 'resolve-lockfile',
      summary: 'Resolve a new pesde.lock. No lockfile exists, so an install would pick versions rather than reproduce them.',
      kind: 'blocked',
      blockedBy: '[automation] allowDependencyResolution — resolving versions is a decision, not a repair',
      touches: [at(ctx, MANIFEST), at(ctx, LOCKFILE)],
    });
  } else {
    steps.push({
      id: 'install-locked',
      summary: 'Run `pesde install --locked`, which errors rather than silently updating an out-of-date lockfile.',
      kind: 'automatic',
      touches: [at(ctx, MANIFEST), at(ctx, LOCKFILE)],
    });
  }

  return {
    steps,
    expectations,
    detail: {
      locked: lock !== null,
      // Named so a caller can see the flag is real rather than take it on
      // trust; `wally install` has no equivalent in 0.3.2, and this repository
      // carries a workaround for exactly that.
      lockedFlagSupported: true,
      dependencies: manifest.dependencies.length,
      requestedTimeoutMs: typeof request.timeoutMs === 'number' ? request.timeoutMs : undefined,
    },
  };
}

async function apply(ctx: PackContext, step: PackStep): Promise<Record<string, unknown>> {
  if (step.id !== 'install-locked') throw new Error(`pesde: no automatic implementation for step ${step.id}`);
  if (!ctx.exec) throw new Error('pesde: this context cannot run commands, so the install cannot be performed.');

  const command = resolveCommand(ctx);
  if (!command) {
    throw new Error('pesde: no pinned pesde was found. Pin it in rokit.toml so the resolved shim is used; a bare `pesde` from PATH is a different install than the project declared.');
  }
  const result = await ctx.exec(command.executable, [...command.prefixArgs, 'install', '--locked'], { cwd: ctx.root, timeoutMs: 600_000 });
  return {
    ranCommand: command.executable,
    source: command.source,
    exitCode: result.code,
    ok: result.code === 0,
    // `--locked` fails on an out-of-date lockfile, so a non-zero exit here is
    // usually "the manifest moved and the lock did not" rather than a network
    // problem. Both are reported rather than interpreted.
    stderrTail: result.stderr.split(/\r?\n/).filter(Boolean).slice(-8),
  };
}

/**
 * The pesde a toolchain manifest pinned, never a bare name.
 *
 * Invariant 4 of this repository: `execFile('pesde')` searches PATH even when
 * the resolved metadata says the project pinned something else.
 */
function resolveCommand(ctx: PackContext): { executable: string; prefixArgs: string[]; source: string } | undefined {
  const resolver = ctx.host?.resolveToolCommand as
    | ((tool: string, cwd?: string) => { executable: string; prefixArgs: string[]; source: string })
    | undefined;
  if (!resolver) return undefined;
  const command = resolver('pesde', ctx.root);
  return command.source === 'path' ? undefined : command;
}

async function validate(ctx: PackContext): Promise<Check[]> {
  const raw = ctx.readFile(at(ctx, MANIFEST));
  if (raw === null) {
    return [{ id: 'manifest', status: 'unknown', message: `No ${MANIFEST} at ${ctx.root}.` }];
  }
  const manifest = readManifest(ctx);
  if (!manifest) {
    return [{ id: 'manifest', status: 'fail', message: `${MANIFEST} exists but does not parse as TOML, so nothing about this project can be read from it.` }];
  }

  const checks: Check[] = [{ id: 'manifest', status: 'pass', message: `${MANIFEST} parses; ${manifest.dependencies.length} dependency row(s).` }];

  checks.push(ctx.readFile(at(ctx, LOCKFILE)) === null
    ? { id: 'lockfile', status: 'fail', message: `No ${LOCKFILE}. Without it an install resolves versions, so two machines can end up with different code from the same manifest.` }
    : { id: 'lockfile', status: 'pass', message: `${LOCKFILE} is present, so \`pesde install --locked\` reproduces rather than resolves.` });

  const unpinned = manifest.dependencies.filter((d) => d.kind !== 'other' && !d.version);
  checks.push(unpinned.length === 0
    ? { id: 'versions', status: 'pass', message: 'Every registry dependency names a version.' }
    : { id: 'versions', status: 'fail', message: `No version on: ${unpinned.map((d) => d.alias).join(', ')}. What gets installed then depends on when it was installed.` });

  const unknownIndex = manifest.dependencies.filter((d) => {
    if (!d.index) return false;
    const known = d.kind === 'wally' ? manifest.wallyIndices : manifest.indices;
    return !(d.index in known);
  });
  checks.push(unknownIndex.length === 0
    ? { id: 'indices', status: 'pass', message: 'Every named index is declared in the manifest.' }
    : { id: 'indices', status: 'fail', message: `Dependencies name undeclared indices: ${unknownIndex.map((d) => `${d.alias} -> ${d.index}`).join(', ')}.` });

  if (!manifest.environment) {
    checks.push({ id: 'target', status: 'unknown', message: '[target].environment is not set, so which runtime this package is for cannot be read.' });
  } else if (ROBLOX_ENVIRONMENTS.has(manifest.environment)) {
    checks.push({ id: 'target', status: 'pass', message: `[target].environment is ${manifest.environment}.` });
  } else {
    checks.push({
      id: 'target', status: 'fail',
      message: `[target].environment is ${manifest.environment}, which is not a Roblox target. Its code is not meant to run in a place; the Roblox targets are ${[...ROBLOX_ENVIRONMENTS].join(' and ')}.`,
    });
  }

  const resolved = resolveCommand(ctx);
  checks.push(resolved
    ? { id: 'pinned-pesde', status: 'pass', message: `pesde resolves through ${resolved.source} at ${resolved.executable}.` }
    : { id: 'pinned-pesde', status: 'fail', message: 'No pinned pesde. Pin it in rokit.toml; a bare `pesde` from PATH is a different install than the project declared.' });

  return checks;
}

export const PESDE_PACK: IntegrationPack = {
  id: 'pesde',
  title: 'pesde package provider',
  version: '1.0.0',
  license: 'MIT',
  sourceOfTruth: 'https://github.com/pesde-pkg/pesde — src/lib.rs (pesde.toml, pesde.lock) and docs/reference/{manifest,cli}.mdx at main',
  effects: ['local.files.read', 'local.files.write', 'local.process.execute', 'network.external'],
  requestKeys: {
    timeoutMs: 'How long to allow the install before giving up. Defaults to ten minutes.',
  },
  detect,
  plan,
  apply,
  validate,
};
