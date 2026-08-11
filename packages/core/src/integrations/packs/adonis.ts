// Adonis, checked rather than installed.
//
// Roadmap 04, item 6. The valuable half of this pack is `validate`, not
// `apply`: Adonis installs in about a minute and then ships to production with
// the wrong two settings, and neither of them announces itself. Its own README
// says both out loud, which is how they were verified here rather than
// remembered.
//
// Verified against `Epix-Incorporated/Adonis@master`:
//
//   - `Loader/Loader/Loader.server.luau` line 125: `DebugMode = true;`. The
//     README's warning that repository and release builds ship with DebugMode
//     enabled is not folklore — it is in the file.
//   - `Loader/Config/Settings/General.luau` line 18:
//     `DataStoreKey = "CHANGE_THIS";  -- CHANGE THIS TO ANYTHING RANDOM!`
//   - README: the loader belongs in `ServerScriptService` — "Do not leave it in
//     the `Workspace`!"
//   - README: "Method 3 compiles the *bleeding edge* version of Adonis, which
//     may not be fully tested and is highly unstable."
//
// This pack sees the filesystem installation (the Rojo route). An Adonis
// inserted as a model lives inside the place, and reaching a place is outside
// `PACK_EFFECT_CEILING` — so this pack reports that it cannot see one rather
// than reporting that there is none.

import { digestOf, type Check, type Detection, type DraftPlan, type IntegrationPack, type PackContext, type PackStep } from '../pack.js';

const LOADER_SCRIPT = 'Loader/Loader/Loader.server.luau';
const GENERAL_SETTINGS = 'Loader/Config/Settings/General.luau';
const VERSION_FILE = 'Loader/Version.model.json';
const MAIN_MODULE = 'MainModule/Server/Server.luau';

/** The value Adonis ships, and the one that must not survive to production. */
const PLACEHOLDER_KEY = 'CHANGE_THIS';

/** Where an Adonis checkout usually sits inside a project. */
const SEARCH_PATHS = ['', 'Adonis', 'src/Adonis', 'ServerScriptService/Adonis', 'vendor/Adonis'];

function basePathOf(ctx: PackContext, request: Readonly<Record<string, unknown>>): string | undefined {
  const named = request.path;
  const candidates = typeof named === 'string' && named.trim() !== ''
    ? [named.trim().replace(/\/+$/, '')]
    : SEARCH_PATHS;
  for (const base of candidates) {
    if (ctx.readFile(join(ctx, base, LOADER_SCRIPT)) !== null) return base;
  }
  return undefined;
}

function join(ctx: PackContext, base: string, rel: string): string {
  return base === '' ? `${ctx.root}/${rel}` : `${ctx.root}/${base}/${rel}`;
}

async function detect(ctx: PackContext, request: Readonly<Record<string, unknown>> = {}): Promise<Detection> {
  const base = basePathOf(ctx, request);
  if (base === undefined) {
    return {
      present: false,
      // Not "there is no Adonis". A model inserted into the place is invisible
      // from here, and saying otherwise would be a confident wrong answer.
      evidence: [
        `No ${LOADER_SCRIPT} under ${SEARCH_PATHS.filter(Boolean).join(', ')} or the project root.`,
        'An Adonis inserted as a model lives inside the place and cannot be seen from the filesystem; pass request.path if the checkout is elsewhere.',
      ],
      variant: 'not-on-disk',
    };
  }

  const version = versionOf(ctx, base);
  const evidence = [`${join(ctx, base, LOADER_SCRIPT)} exists`];
  if (ctx.readFile(join(ctx, base, MAIN_MODULE)) !== null) evidence.push(`${MAIN_MODULE} present, so this is a full checkout rather than a loader alone`);
  if (version) evidence.push(`${VERSION_FILE} reports ${version}`);

  return {
    present: true,
    evidence,
    ...(version ? { version } : {}),
    variant: 'filesystem',
    detail: { basePath: base || '.', hasMainModule: ctx.readFile(join(ctx, base, MAIN_MODULE)) !== null },
  };
}

function versionOf(ctx: PackContext, base: string): string | undefined {
  const raw = ctx.readFile(join(ctx, base, VERSION_FILE));
  if (raw === null) return undefined;
  try {
    const parsed = JSON.parse(raw) as { Properties?: { Value?: unknown }; Value?: unknown };
    const value = parsed.Properties?.Value ?? parsed.Value;
    return typeof value === 'string' || typeof value === 'number' ? String(value) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Adonis has no repair this pack is willing to perform unattended.
 *
 * Both settings that matter are secrets or safety switches, and writing either
 * one from here would mean this pack choosing a datastore key or deciding that
 * a place is production. Those come back blocked, which is the honest answer:
 * the plan names the file and the line, and a person makes the change.
 */
async function plan(ctx: PackContext, request: Readonly<Record<string, unknown>>): Promise<DraftPlan> {
  const base = basePathOf(ctx, request);
  if (base === undefined) {
    return { steps: [], expectations: [], detail: { reason: 'No Adonis checkout on disk; there is nothing to plan against.' } };
  }

  const files = [LOADER_SCRIPT, GENERAL_SETTINGS];
  const expectations = files.map((rel) => ({ path: join(ctx, base, rel), digest: digestOf(ctx.readFile(join(ctx, base, rel))) }));
  const steps: PackStep[] = [];

  if (debugModeEnabled(ctx, base) === true) {
    steps.push({
      id: 'disable-debug-mode',
      summary: `Set DebugMode = false in ${LOADER_SCRIPT}. Adonis ships it enabled in repository and release builds.`,
      kind: 'blocked',
      blockedBy: '[automation] allowAdonisSettingsEdit — whether this place is production is not something a pack can read off the disk',
      touches: [join(ctx, base, LOADER_SCRIPT)],
    });
  }
  if (dataStoreKeyState(ctx, base) === 'placeholder') {
    steps.push({
      id: 'set-datastore-key',
      summary: `Replace the placeholder DataStoreKey in ${GENERAL_SETTINGS} with a random value.`,
      kind: 'blocked',
      // Generating it here would put a secret in a plan, a response and a log.
      blockedBy: '[automation] allowAdonisSettingsEdit — a datastore key is a secret, and a pack that generated one would put it in a plan, a response and a log',
      touches: [join(ctx, base, GENERAL_SETTINGS)],
    });
  }

  return {
    steps,
    expectations,
    detail: {
      basePath: base || '.',
      note: 'Every step here is blocked by design: both settings are a person\'s decision, and one of them is a secret.',
    },
  };
}

async function apply(_ctx: PackContext, step: PackStep): Promise<Record<string, unknown>> {
  throw new Error(`adonis: ${step.id} has no automatic implementation, and the engine should not have reached this. Every step this pack plans is blocked.`);
}

/** `true`, `false`, or `undefined` when the loader could not be read. */
function debugModeEnabled(ctx: PackContext, base: string): boolean | undefined {
  const source = ctx.readFile(join(ctx, base, LOADER_SCRIPT));
  if (source === null) return undefined;
  // Matches the assignment Adonis actually ships (`DebugMode = true;`) and
  // tolerates whitespace. A commented-out line is not an assignment.
  const matched = /^[^\-\n]*\bDebugMode\s*=\s*(true|false)\b/m.exec(source);
  return matched ? matched[1] === 'true' : undefined;
}

type KeyState = 'placeholder' | 'set' | 'empty' | 'unreadable';

/**
 * Whether the datastore key is still the shipped placeholder.
 *
 * The value itself is never returned, logged or included in a message — only
 * which of four states it is in. That is invariant 7, and a check that proved
 * the key was set by quoting it would be the leak it exists to prevent.
 */
function dataStoreKeyState(ctx: PackContext, base: string): KeyState {
  const source = ctx.readFile(join(ctx, base, GENERAL_SETTINGS));
  if (source === null) return 'unreadable';
  const matched = /\bDataStoreKey\s*=\s*(["'])([\s\S]*?)\1/.exec(source);
  if (!matched) return 'unreadable';
  const value = matched[2];
  if (value.trim() === '') return 'empty';
  return value === PLACEHOLDER_KEY ? 'placeholder' : 'set';
}

/**
 * Whether a Rojo project mounts the loader into `ServerScriptService`.
 *
 * Textual, and `unknown` rather than `pass` when the project file cannot be
 * read — resolving a Rojo tree properly is not something to half-implement
 * here, and a confident wrong answer about where the loader lands is worse than
 * an admitted gap.
 */
function loaderPlacement(ctx: PackContext, request: Readonly<Record<string, unknown>>): Check {
  const projectFile = typeof request.projectFile === 'string' && request.projectFile.trim() !== ''
    ? request.projectFile.trim()
    : 'default.project.json';
  const raw = ctx.readFile(`${ctx.root}/${projectFile}`);
  if (raw === null) {
    return { id: 'loader-placement', status: 'unknown', message: `${projectFile} not found; pass request.projectFile if the project uses another name.` };
  }
  if (!/ServerScriptService/.test(raw)) {
    return {
      id: 'loader-placement', status: 'fail',
      message: `${projectFile} never mentions ServerScriptService. Adonis's own README says the loader belongs there — "Do not leave it in the Workspace!" — because anything in Workspace replicates to every client.`,
    };
  }
  return { id: 'loader-placement', status: 'pass', message: `${projectFile} mounts something into ServerScriptService.` };
}

async function validate(ctx: PackContext, request: Readonly<Record<string, unknown>> = {}): Promise<Check[]> {
  const base = basePathOf(ctx, request);
  if (base === undefined) {
    return [{
      id: 'installed',
      status: 'unknown',
      message: 'No Adonis on disk. It may be installed as a model inside the place, which this pack cannot see — a place is outside the effect ceiling every pack is bounded by.',
    }];
  }

  const checks: Check[] = [{ id: 'installed', status: 'pass', message: `Adonis checkout at ${base || '.'}` }];

  const debug = debugModeEnabled(ctx, base);
  checks.push(
    debug === undefined ? { id: 'debug-mode', status: 'unknown', message: `Could not read a DebugMode assignment in ${LOADER_SCRIPT}.` }
      : debug ? {
        id: 'debug-mode', status: 'fail',
        message: `DebugMode is enabled in ${LOADER_SCRIPT}. Adonis ships repository and release builds this way and its README calls the feature development-only, so this is the default rather than somebody's choice — which is exactly why it survives to production.`,
      }
        : { id: 'debug-mode', status: 'pass', message: 'DebugMode is disabled.' },
  );

  const key = dataStoreKeyState(ctx, base);
  checks.push({
    id: 'datastore-key',
    status: key === 'set' ? 'pass' : key === 'unreadable' ? 'unknown' : 'fail',
    // The state, never the value.
    message: {
      set: 'DataStoreKey has been changed from the shipped placeholder. Its value is deliberately not read back here.',
      placeholder: `DataStoreKey is still the shipped placeholder "${PLACEHOLDER_KEY}". Anyone who knows Adonis knows it, so every saved entry is readable and writable by anyone who can reach the datastore.`,
      empty: 'DataStoreKey is empty, which is the placeholder problem without even the placeholder.',
      unreadable: `Could not find a DataStoreKey assignment in ${GENERAL_SETTINGS}.`,
    }[key],
  });

  checks.push(loaderPlacement(ctx, request));

  const version = versionOf(ctx, base);
  checks.push(version
    ? { id: 'version', status: 'pass', message: `Version ${version}.`, advisory: true }
    : {
      id: 'version', status: 'unknown', advisory: true,
      message: `No readable ${VERSION_FILE}. A checkout compiled from the repository is the bleeding-edge build its README calls "highly unstable"; a release snapshot carries a version.`,
    });

  return checks;
}

export const ADONIS_PACK: IntegrationPack = {
  id: 'adonis',
  title: 'Adonis admin system',
  version: '1.0.0',
  license: 'MIT',
  sourceOfTruth: 'https://github.com/Epix-Incorporated/Adonis — Loader/Loader/Loader.server.luau, Loader/Config/Settings/General.luau and README.md at master',
  effects: ['local.files.read'],
  requestKeys: {
    path: 'Where the Adonis checkout is, when it is not under one of the usual paths.',
    projectFile: 'Rojo project file name, for the loader-placement check.',
  },
  detect,
  plan,
  apply,
  validate,
};
