// roblox-ts as an integration pack.
//
// Roadmap 04, item 2. BloxForge already compiles its *own* Studio plugin with
// roblox-ts, but it does not recognise a user's rbxts project as a distinct
// kind of project — and that is the hole. An agent that lands in one and edits
// the generated `.luau` has edited a build artifact: the next compile deletes
// the work, and nothing reports that it happened.
//
// So this pack is mostly `inspect` and `validate`. Detecting the project
// correctly, and naming the four ways an agent silently ruins one, is worth
// more than another way to run a compiler.
//
// Verified against the primary source (roblox-ts `package.json` at master,
// 3.0.0): the binary is `rbxtsc`, and the compiler ships its own
// `@roblox-ts/rojo-resolver` and `@roblox-ts/path-translator` — which is why
// this pack does not try to re-derive the Rojo mapping itself.

import { parseJsonc } from '../../rojo/project-discovery.js';
import { digestOf, type Check, type Detection, type DraftPlan, type IntegrationPack, type PackContext, type PackStep } from '../pack.js';

const PACKAGE_JSON = 'package.json';
const TSCONFIG = 'tsconfig.json';
const DEFAULT_PROJECT = 'default.project.json';

/** Where the compiler that this project pinned actually lives. */
const LOCAL_BIN = ['node_modules', '.bin', 'rbxtsc'].join('/');
const LOCAL_BIN_WINDOWS = `${LOCAL_BIN}.cmd`;
const INSTALLED_MANIFEST = ['node_modules', 'roblox-ts', 'package.json'].join('/');

function at(ctx: PackContext, rel: string): string {
  return `${ctx.root}/${rel}`;
}

function readJson(ctx: PackContext, rel: string): Record<string, unknown> | null {
  const raw = ctx.readFile(at(ctx, rel));
  if (raw === null) return null;
  try {
    const parsed = parseJsonc(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    // A tsconfig that does not parse is not a tsconfig with defaults. Fail
    // closed: the caller gets `null` and every check that needed it says so.
    return null;
  }
}

function dependencyRanges(pkg: Record<string, unknown> | null): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const field of ['dependencies', 'devDependencies']) {
    const block = pkg?.[field];
    if (block && typeof block === 'object') {
      for (const [name, range] of Object.entries(block as Record<string, unknown>)) {
        if (typeof range === 'string') merged[name] = range;
      }
    }
  }
  return merged;
}

function compilerOptions(tsconfig: Record<string, unknown> | null): Record<string, unknown> {
  const options = tsconfig?.compilerOptions;
  return options && typeof options === 'object' ? options as Record<string, unknown> : {};
}

/** The compiled output directory the tsconfig declares, normalized without a trailing slash. */
function outDirOf(tsconfig: Record<string, unknown> | null): string | undefined {
  const raw = compilerOptions(tsconfig).outDir;
  if (typeof raw !== 'string' || raw.trim() === '') return undefined;
  return raw.replace(/^\.\//, '').replace(/\/+$/, '');
}

function projectFileOf(request: Readonly<Record<string, unknown>>): string {
  const named = request.projectFile;
  return typeof named === 'string' && named.trim() !== '' ? named.trim() : DEFAULT_PROJECT;
}

/**
 * Which TypeScript file a compiled Luau file came from.
 *
 * This is the other half of `no-handwritten-luau`. That check says an edit in
 * the compiled tree will vanish; this one says where to make it instead, which
 * is the difference between a warning and a fix.
 *
 * The rules are `PathTranslator.getInputPaths` in `roblox-ts/path-translator`,
 * read rather than remembered:
 *
 *   - `out/X.luau` → `src/X.ts`, then `src/X.tsx`.
 *   - `out/Foo/init.luau` also → `src/Foo/index.ts` and `src/Foo/index.tsx`,
 *     because roblox-ts renames `index` to `init` on the way out.
 *   - A file named `index.luau` is **not** mapped at all: the translator guards
 *     on `fileName !== INDEX_NAME`, since no `.ts` compiles to that name.
 *   - The extension is `.lua` or `.luau` depending on the project's setting, so
 *     both are accepted.
 *
 * Candidates are returned in the translator's own order and each is reported
 * with whether it exists, rather than collapsing to a single guess: two of them
 * existing at once is a real (if odd) project state, and picking one silently
 * would be a guess wearing the shape of an answer.
 */
export function resolveSourceCandidates(outPath: string, outDir: string, rootDir: string): string[] {
  const normalized = outPath.replace(/^\.\//, '');
  const prefix = `${outDir}/`;
  if (!normalized.startsWith(prefix)) return [];

  const relative = normalized.slice(prefix.length);
  const matched = /^(.*?)([^/]+)\.(lua|luau)$/.exec(relative);
  if (!matched) return [];
  const [, directory, stem] = matched;
  if (stem === 'index') return [];

  const names = stem === 'init' ? ['init', 'index'] : [stem];
  return names.flatMap((name) => ['ts', 'tsx'].map((ext) => `${rootDir}/${directory}${name}.${ext}`));
}

/**
 * The compiler this project pinned, or nothing.
 *
 * A bare `rbxtsc` on PATH is deliberately not a fallback. That is invariant 4
 * of this repository in npm clothing: a globally installed compiler and the one
 * the project's lockfile resolved are different programs, and silently
 * preferring whichever is on PATH is how a build becomes unreproducible without
 * anybody choosing that.
 */
function localCompiler(ctx: PackContext): string | undefined {
  const exists = ctx.exists ?? ((p: string) => ctx.readFile(p) !== null);
  for (const rel of [LOCAL_BIN, LOCAL_BIN_WINDOWS]) {
    if (exists(at(ctx, rel))) return rel;
  }
  return undefined;
}

async function detect(ctx: PackContext, request: Readonly<Record<string, unknown>>): Promise<Detection> {
  const pkg = readJson(ctx, PACKAGE_JSON);
  const tsconfig = readJson(ctx, TSCONFIG);
  const ranges = dependencyRanges(pkg);
  const declared = ranges['roblox-ts'];
  const rbxtsPackages = Object.keys(ranges).filter((name) => name.startsWith('@rbxts/')).sort();
  const installed = readJson(ctx, INSTALLED_MANIFEST);
  const installedVersion = typeof installed?.version === 'string' ? installed.version : undefined;

  const evidence: string[] = [];
  if (declared) evidence.push(`${PACKAGE_JSON} depends on roblox-ts ${declared}`);
  if (tsconfig) evidence.push(`${TSCONFIG} parses`);
  if (rbxtsPackages.length > 0) evidence.push(`${rbxtsPackages.length} @rbxts/* package(s): ${rbxtsPackages.slice(0, 5).join(', ')}`);
  const compiler = localCompiler(ctx);
  if (compiler) evidence.push(`project-local compiler at ${compiler}`);
  if (installedVersion) evidence.push(`node_modules/roblox-ts is ${installedVersion}`);
  if (!declared) evidence.push(`${PACKAGE_JSON} does not depend on roblox-ts`);
  if (!tsconfig) evidence.push(`no readable ${TSCONFIG}`);

  // Both, not either. A tsconfig alone is an ordinary TypeScript project, and
  // treating one as rbxts is how a pack starts giving Roblox advice about a web
  // app.
  const present = Boolean(declared) && tsconfig !== null;

  return {
    present,
    evidence,
    ...(installedVersion ?? declared ? { version: installedVersion ?? declared } : {}),
    variant: installedVersion ? 'installed' : declared ? 'declared-not-installed' : 'absent',
    detail: {
      declaredRange: declared,
      installedVersion,
      // Two different facts. "Declared ^3.0.0" is what the project asked for;
      // "installed 3.0.0" is what would actually run. A pack that reported one
      // number could not tell a caller which it had.
      rbxtsPackages,
      outDir: outDirOf(tsconfig),
      localCompiler: compiler,
      ...(typeof request.resolve === 'string' ? { resolved: resolveFor(ctx, tsconfig, request.resolve) } : {}),
    },
  };
}

/** Answer `request.resolve`, or say why it could not be answered. */
function resolveFor(
  ctx: PackContext,
  tsconfig: Record<string, unknown> | null,
  outPath: string,
): Record<string, unknown> {
  const outDir = outDirOf(tsconfig);
  const rootDirRaw = compilerOptions(tsconfig).rootDir;
  const rootDir = typeof rootDirRaw === 'string' && rootDirRaw.trim() !== ''
    ? rootDirRaw.replace(/^\.\//, '').replace(/\/+$/, '')
    : undefined;
  if (!outDir || !rootDir) {
    return { outPath, candidates: [], note: 'compilerOptions.outDir and rootDir are both needed to map a compiled file back to its source.' };
  }

  const exists = ctx.exists ?? ((p: string) => ctx.readFile(p) !== null);
  const candidates = resolveSourceCandidates(outPath, outDir, rootDir)
    .map((path) => ({ path, exists: exists(at(ctx, path)) }));
  const present = candidates.filter((c) => c.exists);

  return {
    outPath,
    candidates,
    // Reported, not chosen. Two candidates existing at once is a real if odd
    // project state, and silently picking one would be a guess in the shape of
    // an answer.
    source: present.length === 1 ? present[0].path : undefined,
    ...(present.length === 0
      ? { note: candidates.length === 0
        ? `${outPath} is not a compiled file this mapping covers; a file named index.luau has no TypeScript source, and anything outside ${outDir} was not produced by this compiler.`
        : 'No candidate exists on disk. The compiled tree may be stale, or the source was deleted without a rebuild.' }
      : {}),
    ...(present.length > 1 ? { note: `${present.length} candidates exist at once; which one the compiler used is not something this mapping can decide.` } : {}),
  };
}

async function plan(ctx: PackContext, request: Readonly<Record<string, unknown>>): Promise<DraftPlan> {
  const projectFile = projectFileOf(request);
  const tsconfig = readJson(ctx, TSCONFIG);
  const compiler = localCompiler(ctx);
  const inputs = [PACKAGE_JSON, TSCONFIG, projectFile];

  const steps: PackStep[] = [];
  if (!compiler) {
    steps.push({
      id: 'install-dependencies',
      summary: `Install the project's own dependencies so ${LOCAL_BIN} exists.`,
      kind: 'blocked',
      // Restoring what a lockfile already resolved would be a repair; there is
      // no lockfile guarantee to lean on from here, and `npm install` may
      // resolve and rewrite one. That makes it a decision, and decisions come
      // back blocked.
      blockedBy: '[automation] allowPackageInstall — installing resolves and can rewrite the lockfile, which is the user\'s state',
      touches: [PACKAGE_JSON],
    });
  } else {
    steps.push({
      id: 'compile',
      summary: `Run ${compiler} against ${TSCONFIG} and report diagnostics as JSON.`,
      kind: 'automatic',
      // Inputs only. The outDir is generated, not reconciled: recording an
      // expectation per output file would claim the pack knows what the
      // compiler is about to write, and it does not.
      touches: [PACKAGE_JSON, TSCONFIG],
    });
  }

  return {
    steps,
    expectations: inputs.map((rel) => ({ path: at(ctx, rel), digest: digestOf(ctx.readFile(at(ctx, rel))) })),
    detail: {
      projectFile,
      outDir: outDirOf(tsconfig),
      note: 'Compiled output is generated, so the plan pins the inputs it read rather than the files the compiler will write.',
    },
  };
}

async function apply(ctx: PackContext, step: PackStep): Promise<Record<string, unknown>> {
  if (step.id !== 'compile') throw new Error(`roblox-ts: no automatic implementation for step ${step.id}`);
  const compiler = localCompiler(ctx);
  if (!compiler) throw new Error(`roblox-ts: ${LOCAL_BIN} disappeared between plan and apply. Re-plan.`);
  if (!ctx.exec) throw new Error('roblox-ts: this context cannot run commands, so the compiler cannot be invoked.');

  const result = await ctx.exec(at(ctx, compiler), ['--verbose'], { cwd: ctx.root, timeoutMs: 300_000 });
  return {
    ranCommand: compiler,
    exitCode: result.code,
    ok: result.code === 0,
    diagnostics: parseDiagnostics(`${result.stdout}\n${result.stderr}`),
  };
}

export interface CompilerDiagnostic {
  file?: string;
  line?: number;
  column?: number;
  severity: 'error' | 'warning';
  /** `TS2304` and the like, kept as its own field so a caller can branch on it. */
  code?: string;
  message: string;
}

/**
 * Turn compiler output into rows a caller can branch on.
 *
 * ponytail: line-oriented, matching the `file(line,col): severity message`
 * shape TypeScript emits and roblox-ts passes through. Ceiling: a diagnostic
 * whose message itself wraps onto a second line keeps only its first line, and
 * anything unrecognised is dropped rather than guessed at. Upgrade path is
 * `rbxtsc`'s own machine-readable output if it ever grows one — parsing prose
 * harder is the wrong direction.
 */
export function parseDiagnostics(output: string): CompilerDiagnostic[] {
  const located = /^(?<file>[^\s(][^(]*)\((?<line>\d+),(?<column>\d+)\):\s*(?<severity>error|warning)(?:\s+(?<code>[A-Za-z]+\d+))?:\s*(?<message>.+)$/;
  const bare = /^(?<severity>error|warning)(?:\s+(?<code>[A-Za-z]+\d+))?:\s*(?<message>.+)$/;

  const rows: CompilerDiagnostic[] = [];
  for (const raw of output.split(/\r?\n/)) {
    const line = stripAnsi(raw).trim();
    const g = (located.exec(line) ?? bare.exec(line))?.groups;
    if (!g) continue;
    rows.push({
      ...(g.file ? { file: g.file, line: Number(g.line), column: Number(g.column) } : {}),
      severity: g.severity as 'error' | 'warning',
      ...(g.code ? { code: g.code } : {}),
      message: g.message.trim(),
    });
  }
  return rows;
}

// eslint-disable-next-line no-control-regex
const ANSI = /\[[0-9;]*m/g;
function stripAnsi(value: string): string {
  return value.replace(ANSI, '');
}

async function validate(ctx: PackContext, request: Readonly<Record<string, unknown>> = {}): Promise<Check[]> {
  const pkg = readJson(ctx, PACKAGE_JSON);
  const tsconfig = readJson(ctx, TSCONFIG);
  const ranges = dependencyRanges(pkg);
  const checks: Check[] = [];

  const compiler = localCompiler(ctx);
  checks.push(compiler
    ? { id: 'project-local-compiler', status: 'pass', message: `${compiler} is present; the pack never falls back to a PATH rbxtsc.` }
    : { id: 'project-local-compiler', status: 'fail', message: `${LOCAL_BIN} is missing. A global rbxtsc is a different compiler from the one this project pinned and is deliberately not used instead.` });

  checks.push(ranges['@rbxts/compiler-types']
    ? { id: 'compiler-types', status: 'pass', message: `@rbxts/compiler-types ${ranges['@rbxts/compiler-types']}` }
    : { id: 'compiler-types', status: 'fail', message: 'No @rbxts/compiler-types dependency; the Roblox globals are untyped and every one of them compiles to whatever TypeScript guesses.' });

  const outDir = outDirOf(tsconfig);
  if (!tsconfig) {
    checks.push({ id: 'out-dir', status: 'unknown', message: `${TSCONFIG} is missing or does not parse, so the output directory could not be read.` });
  } else if (!outDir) {
    checks.push({ id: 'out-dir', status: 'fail', message: 'compilerOptions.outDir is not set, so compiled Luau lands beside the TypeScript it was compiled from.' });
  } else {
    checks.push({ id: 'out-dir', status: 'pass', message: `compilerOptions.outDir is ${outDir}` });
  }

  checks.push(rojoMountsOutDir(ctx, projectFileOf(request), outDir));
  checks.push(handwrittenLuauCheck(ctx, tsconfig, outDir));
  checks.push(pluginAllowlistCheck(tsconfig, request));

  return checks;
}

/**
 * The compiled tree has to be somewhere Rojo actually syncs.
 *
 * A textual search of the project file, not a resolution of the Rojo tree:
 * roblox-ts ships its own `@roblox-ts/rojo-resolver` precisely because that
 * resolution is not trivial, and a second half-implementation of it here would
 * be a confident answer with no method behind it. So the check says "the
 * project file mentions this path" — and says `unknown`, never `pass`, when it
 * cannot read the file.
 */
function rojoMountsOutDir(ctx: PackContext, projectFile: string, outDir: string | undefined): Check {
  if (!outDir) return { id: 'rojo-mounts-out-dir', status: 'unknown', message: 'No outDir to look for.' };
  const raw = ctx.readFile(at(ctx, projectFile));
  if (raw === null) return { id: 'rojo-mounts-out-dir', status: 'unknown', message: `${projectFile} not found; pass request.projectFile if the project uses another name.` };
  return raw.includes(outDir)
    ? { id: 'rojo-mounts-out-dir', status: 'pass', message: `${projectFile} references ${outDir}.` }
    : { id: 'rojo-mounts-out-dir', status: 'fail', message: `${projectFile} never mentions ${outDir}, so the compiled output is not synced and the place runs whatever was there before.` };
}

/**
 * Luau in the output directory that no TypeScript file explains.
 *
 * This is the failure the pack exists for: an agent writes Luau into the
 * compiled tree, the edit works, and the next compile deletes it with no error
 * anywhere. A generated `Foo.luau` has a `Foo.ts` (or `.tsx`) at the matching
 * place under `rootDir`; one that does not was put there by hand.
 *
 * ponytail: the output root only, not a recursive walk, and it will not catch
 * Luau a `.ts` legitimately emitted under another name. Ceiling accepted
 * because the common case — an agent editing or adding a file at the top of
 * `out/` — is caught, and a false accusation is worse than a missed one here.
 * Upgrade path: walk both trees and pair them through the compiler's own
 * `@roblox-ts/path-translator` rather than by guessing the mapping.
 */
function handwrittenLuauCheck(ctx: PackContext, tsconfig: Record<string, unknown> | null, outDir: string | undefined): Check {
  if (!outDir) return { id: 'no-handwritten-luau', status: 'unknown', message: 'No outDir to inspect.' };
  const list = ctx.list?.(at(ctx, outDir));
  if (!list) return { id: 'no-handwritten-luau', status: 'unknown', message: `${outDir} could not be listed; it may not have been compiled yet.` };

  const rootDirRaw = compilerOptions(tsconfig).rootDir;
  const rootDir = typeof rootDirRaw === 'string' && rootDirRaw.trim() !== ''
    ? rootDirRaw.replace(/^\.\//, '').replace(/\/+$/, '')
    : undefined;
  if (!rootDir) {
    return { id: 'no-handwritten-luau', status: 'unknown', message: 'compilerOptions.rootDir is not set, so a generated file cannot be told from a hand-written one.' };
  }

  const exists = ctx.exists ?? ((p: string) => ctx.readFile(p) !== null);
  const orphans = list
    .filter((name) => /\.luau?$/.test(name))
    .filter((name) => {
      const stem = name.replace(/\.luau?$/, '');
      return !['ts', 'tsx', 'd.ts'].some((ext) => exists(at(ctx, `${rootDir}/${stem}.${ext}`)));
    });

  return orphans.length === 0
    ? { id: 'no-handwritten-luau', status: 'pass', message: `Every Luau file at the root of ${outDir} has a source file under ${rootDir}.` }
    : {
      id: 'no-handwritten-luau',
      status: 'fail',
      message: `${orphans.join(', ')} in ${outDir} has no source under ${rootDir}. Written by hand into the compiled tree, it disappears on the next build with no error. Edit the TypeScript instead.`,
    };
}

/**
 * Compiler plugins transform the AST, so an unlisted one is arbitrary code in
 * the build. `fail`, not `unknown`: the plugin is right there in the tsconfig,
 * and what is missing is the approval, not the information.
 */
function pluginAllowlistCheck(tsconfig: Record<string, unknown> | null, request: Readonly<Record<string, unknown>>): Check {
  if (!tsconfig) return { id: 'compiler-plugins', status: 'unknown', message: `${TSCONFIG} is missing or does not parse, so its plugins could not be read.` };
  const raw = compilerOptions(tsconfig).plugins;
  const plugins = Array.isArray(raw)
    ? raw.map((entry) => (entry && typeof entry === 'object' ? String((entry as { transform?: unknown; name?: unknown }).transform ?? (entry as { name?: unknown }).name ?? '') : String(entry))).filter(Boolean)
    : [];
  if (plugins.length === 0) return { id: 'compiler-plugins', status: 'pass', message: 'No compiler plugins configured.' };

  const allowedRaw = request.allowedPlugins;
  const allowed = new Set(Array.isArray(allowedRaw) ? allowedRaw.map(String) : []);
  const unlisted = plugins.filter((name) => !allowed.has(name));
  return unlisted.length === 0
    ? { id: 'compiler-plugins', status: 'pass', message: `All ${plugins.length} plugin(s) are on the caller's allowlist.` }
    : { id: 'compiler-plugins', status: 'fail', message: `Unlisted compiler plugin(s): ${unlisted.join(', ')}. A plugin rewrites the AST, so it runs arbitrary code in the build; pass request.allowedPlugins to approve them by name.` };
}

export const ROBLOX_TS_PACK: IntegrationPack = {
  id: 'roblox-ts',
  title: 'roblox-ts TypeScript project',
  version: '1.0.0',
  license: 'MIT',
  sourceOfTruth: 'https://github.com/roblox-ts/roblox-ts — package.json@master (3.0.0), bin.rbxtsc',
  effects: ['local.files.read', 'local.process.execute'],
  requestKeys: {
    projectFile: 'Rojo project file name when the project does not use default.project.json.',
    allowedPlugins: 'Compiler plugins approved by name. Without this every configured plugin fails the compiler-plugins check.',
    resolve: 'A path under outDir, such as "out/Foo/Bar.luau". Returns which TypeScript file it was compiled from.',
  },
  detect,
  plan,
  apply,
  validate,
};
