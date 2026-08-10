import { digestOf, type PackContext } from '../integrations/pack.js';
import { parseDiagnostics, ROBLOX_TS_PACK } from '../integrations/packs/roblox-ts.js';

const ROOT = '/proj';

/** A project that lives in a Map, so a test can remove one file and see what the checks say. */
function projectOf(over: Record<string, string | null> = {}): PackContext & { files: Map<string, string> } {
  const base: Record<string, string> = {
    [`${ROOT}/package.json`]: JSON.stringify({
      name: 'game',
      devDependencies: { 'roblox-ts': '^3.0.0', '@rbxts/compiler-types': '^3.0.0' },
      dependencies: { '@rbxts/services': '^1.5.5' },
    }),
    [`${ROOT}/tsconfig.json`]: '{\n  // rbxts defaults\n  "compilerOptions": { "outDir": "out", "rootDir": "src" },\n}',
    [`${ROOT}/default.project.json`]: JSON.stringify({ name: 'game', tree: { $path: 'out' } }),
    [`${ROOT}/node_modules/.bin/rbxtsc`]: '#!/usr/bin/env node',
    [`${ROOT}/node_modules/roblox-ts/package.json`]: JSON.stringify({ name: 'roblox-ts', version: '3.0.0' }),
    [`${ROOT}/src/Main.ts`]: 'export {}',
    [`${ROOT}/out/Main.luau`]: '-- generated',
  };
  for (const [path, content] of Object.entries(over)) {
    if (content === null) delete base[path];
    else base[path] = content;
  }
  const files = new Map(Object.entries(base));
  return {
    root: ROOT,
    files,
    readFile: (p) => files.get(p) ?? null,
    exists: (p) => files.has(p),
    list: (dir) => {
      const prefix = `${dir}/`;
      const names = [...files.keys()]
        .filter((p) => p.startsWith(prefix))
        .map((p) => p.slice(prefix.length))
        .filter((rest) => !rest.includes('/'));
      return names.length > 0 ? names : null;
    },
  };
}

const checkOf = async (ctx: PackContext, id: string, request: Record<string, unknown> = {}) => {
  const checks = await ROBLOX_TS_PACK.validate(ctx, request);
  const found = checks.find((c) => c.id === id);
  if (!found) throw new Error(`no check ${id} in ${checks.map((c) => c.id).join(', ')}`);
  return found;
};

describe('detection', () => {
  it('needs both a roblox-ts dependency and a tsconfig, not either', async () => {
    // A tsconfig alone is an ordinary TypeScript project, and treating one as
    // rbxts is how a pack starts giving Roblox advice about a web app.
    expect((await ROBLOX_TS_PACK.detect(projectOf(), {})).present).toBe(true);
    expect((await ROBLOX_TS_PACK.detect(projectOf({ [`${ROOT}/tsconfig.json`]: null }), {})).present).toBe(false);
    expect((await ROBLOX_TS_PACK.detect(projectOf({
      [`${ROOT}/package.json`]: JSON.stringify({ devDependencies: { typescript: '5.5.3' } }),
    }), {})).present).toBe(false);
  });

  it('separates the version declared from the version installed', async () => {
    // "^3.0.0" is what the project asked for; "3.0.0" is what would run. A pack
    // reporting one number could not tell a caller which it had.
    const installed = await ROBLOX_TS_PACK.detect(projectOf(), {});
    expect(installed.variant).toBe('installed');
    expect(installed.detail).toMatchObject({ declaredRange: '^3.0.0', installedVersion: '3.0.0' });

    const declaredOnly = await ROBLOX_TS_PACK.detect(projectOf({
      [`${ROOT}/node_modules/roblox-ts/package.json`]: null,
      [`${ROOT}/node_modules/.bin/rbxtsc`]: null,
    }), {});
    expect(declaredOnly.variant).toBe('declared-not-installed');
    expect(declaredOnly.detail).toMatchObject({ declaredRange: '^3.0.0', installedVersion: undefined });
  });

  it('reads a tsconfig with comments and a trailing comma', async () => {
    expect((await ROBLOX_TS_PACK.detect(projectOf(), {})).detail).toMatchObject({ outDir: 'out' });
  });

  it('treats an unparsable tsconfig as absent rather than as defaults', async () => {
    // Guessing the defaults of a file that does not parse is how a pack reports
    // an outDir nobody configured.
    const broken = await ROBLOX_TS_PACK.detect(projectOf({ [`${ROOT}/tsconfig.json`]: '{ "compilerOptions": ' }), {});
    expect(broken.present).toBe(false);
    expect(broken.evidence).toContain('no readable tsconfig.json');
  });

  it('lists the evidence rather than only the verdict', async () => {
    const found = await ROBLOX_TS_PACK.detect(projectOf(), {});
    expect(found.evidence.join(' ')).toMatch(/project-local compiler at node_modules\/\.bin\/rbxtsc/);
  });
});

describe('planning', () => {
  it('blocks the install rather than running npm on the user\'s lockfile', async () => {
    const ctx = projectOf({ [`${ROOT}/node_modules/.bin/rbxtsc`]: null });
    const draft = await ROBLOX_TS_PACK.plan(ctx, {});
    expect(draft.steps).toEqual([expect.objectContaining({ id: 'install-dependencies', kind: 'blocked' })]);
    expect(draft.steps[0].blockedBy).toMatch(/rewrite the lockfile/);
  });

  it('pins the inputs it read, not the files the compiler will write', async () => {
    // Recording an expectation per output would claim the pack knows what the
    // compiler is about to emit.
    const ctx = projectOf();
    const draft = await ROBLOX_TS_PACK.plan(ctx, {});
    expect(draft.expectations.map((e) => e.path)).toEqual([
      `${ROOT}/package.json`, `${ROOT}/tsconfig.json`, `${ROOT}/default.project.json`,
    ]);
    expect(draft.expectations[1].digest).toBe(digestOf(ctx.readFile(`${ROOT}/tsconfig.json`)));
  });

  it('records an absent project file as absent instead of skipping it', async () => {
    const draft = await ROBLOX_TS_PACK.plan(projectOf({ [`${ROOT}/default.project.json`]: null }), {});
    expect(draft.expectations.find((e) => e.path.endsWith('default.project.json'))!.digest).toBeNull();
  });
});

describe('applying', () => {
  it('runs the project-local binary by absolute path, never a bare name', async () => {
    // A bare `rbxtsc` searches PATH, and a global compiler is not the one this
    // project pinned.
    const calls: string[] = [];
    const ctx: PackContext = {
      ...projectOf(),
      exec: async (file) => {
        calls.push(file);
        return { code: 0, stdout: '', stderr: '' };
      },
    };
    const result = await ROBLOX_TS_PACK.apply(ctx, { id: 'compile', summary: '', kind: 'automatic', touches: [] });
    expect(calls).toEqual([`${ROOT}/node_modules/.bin/rbxtsc`]);
    expect(result.ok).toBe(true);
  });

  it('reports a failing compile as diagnostics rather than throwing', async () => {
    const ctx: PackContext = {
      ...projectOf(),
      exec: async () => ({ code: 1, stdout: 'src/Main.ts(3,10): error TS2304: Cannot find name "wrold".', stderr: '' }),
    };
    const result = await ROBLOX_TS_PACK.apply(ctx, { id: 'compile', summary: '', kind: 'automatic', touches: [] });
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toEqual([
      { file: 'src/Main.ts', line: 3, column: 10, severity: 'error', code: 'TS2304', message: 'Cannot find name "wrold".' },
    ]);
  });

  it('says so when the context cannot run commands', async () => {
    await expect(ROBLOX_TS_PACK.apply(projectOf(), { id: 'compile', summary: '', kind: 'automatic', touches: [] }))
      .rejects.toThrow(/cannot run commands/);
  });
});

describe('diagnostic parsing', () => {
  it('keeps the rows it recognises and drops the prose', () => {
    expect(parseDiagnostics([
      'Compiling...',
      'src/a.ts(1,2): error TS1005: ";" expected.',
      'error: Unable to find Rojo project',
      'Done in 1.2s',
    ].join('\n'))).toEqual([
      { file: 'src/a.ts', line: 1, column: 2, severity: 'error', code: 'TS1005', message: '";" expected.' },
      { severity: 'error', message: 'Unable to find Rojo project' },
    ]);
  });

  it('keeps the error code as its own field so a caller can branch on it', () => {
    // Folded into the message it is prose; on its own it is a value.
    expect(parseDiagnostics('a.ts(1,1): error TS2304: nope')[0].code).toBe('TS2304');
  });

  it('sees through the colour codes the compiler writes to a terminal', () => {
    expect(parseDiagnostics('[31msrc/a.ts(1,2): error TS1005: bad[0m')).toEqual([
      { file: 'src/a.ts', line: 1, column: 2, severity: 'error', code: 'TS1005', message: 'bad' },
    ]);
  });
});

describe('validation', () => {
  it('refuses to accept a PATH compiler in place of the project one', async () => {
    const missing = await checkOf(projectOf({ [`${ROOT}/node_modules/.bin/rbxtsc`]: null }), 'project-local-compiler');
    expect(missing.status).toBe('fail');
    expect(missing.message).toMatch(/A global rbxtsc is a different compiler/);
  });

  it('accepts the Windows shim as the same compiler', async () => {
    const windows = projectOf({
      [`${ROOT}/node_modules/.bin/rbxtsc`]: null,
      [`${ROOT}/node_modules/.bin/rbxtsc.cmd`]: '@echo off',
    });
    expect((await checkOf(windows, 'project-local-compiler')).status).toBe('pass');
  });

  it('fails when the Rojo project never mounts the output directory', async () => {
    const unmounted = projectOf({ [`${ROOT}/default.project.json`]: JSON.stringify({ tree: { $path: 'src' } }) });
    const check = await checkOf(unmounted, 'rojo-mounts-out-dir');
    expect(check.status).toBe('fail');
    expect(check.message).toMatch(/the compiled output is not synced/);
  });

  it('says unknown, not pass, when it cannot read the project file', async () => {
    const check = await checkOf(projectOf({ [`${ROOT}/default.project.json`]: null }), 'rojo-mounts-out-dir');
    expect(check.status).toBe('unknown');
    expect(check.message).toMatch(/pass request.projectFile/);
  });

  it('takes the project file name from the request', async () => {
    const renamed = projectOf({
      [`${ROOT}/default.project.json`]: null,
      [`${ROOT}/game.project.json`]: JSON.stringify({ tree: { $path: 'out' } }),
    });
    expect((await checkOf(renamed, 'rojo-mounts-out-dir', { projectFile: 'game.project.json' })).status).toBe('pass');
  });

  it('names Luau in the compiled tree that no TypeScript explains', async () => {
    // The failure the pack exists for: the edit works, and the next compile
    // deletes it with no error anywhere.
    const handwritten = projectOf({ [`${ROOT}/out/Patch.luau`]: '-- written by an agent' });
    const check = await checkOf(handwritten, 'no-handwritten-luau');
    expect(check.status).toBe('fail');
    expect(check.message).toMatch(/Patch\.luau in out has no source under src/);
  });

  it('does not accuse a file that has its source beside it', async () => {
    expect((await checkOf(projectOf(), 'no-handwritten-luau')).status).toBe('pass');
  });

  it('says unknown rather than guessing when rootDir is unset', async () => {
    const noRoot = projectOf({ [`${ROOT}/tsconfig.json`]: '{"compilerOptions":{"outDir":"out"}}' });
    expect((await checkOf(noRoot, 'no-handwritten-luau')).status).toBe('unknown');
  });

  it('fails an unlisted compiler plugin, because what is missing is approval, not information', async () => {
    const withPlugin = projectOf({
      [`${ROOT}/tsconfig.json`]: JSON.stringify({
        compilerOptions: { outDir: 'out', rootDir: 'src', plugins: [{ transform: 'rbxts-transformer-flamework' }] },
      }),
    });
    const check = await checkOf(withPlugin, 'compiler-plugins');
    expect(check.status).toBe('fail');
    expect(check.message).toMatch(/rbxts-transformer-flamework/);
    expect(check.message).toMatch(/runs arbitrary code in the build/);

    const approved = await checkOf(withPlugin, 'compiler-plugins', { allowedPlugins: ['rbxts-transformer-flamework'] });
    expect(approved.status).toBe('pass');
  });

  it('passes a project with no plugins without asking for an allowlist', async () => {
    expect((await checkOf(projectOf(), 'compiler-plugins')).status).toBe('pass');
  });

  it('reports the untyped-globals case as a failure, not a style note', async () => {
    const untyped = projectOf({
      [`${ROOT}/package.json`]: JSON.stringify({ devDependencies: { 'roblox-ts': '^3.0.0' } }),
    });
    expect((await checkOf(untyped, 'compiler-types')).status).toBe('fail');
  });
});
