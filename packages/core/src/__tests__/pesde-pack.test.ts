import { PESDE_PACK } from '../integrations/packs/pesde.js';
import type { PackContext } from '../integrations/pack.js';

const ROOT = '/proj';

const MANIFEST = `
name = "acme/game"
version = "1.2.3"
license = "MIT"

[target]
environment = "roblox"
lib = "init.luau"

[indices]
default = "https://github.com/pesde-pkg/index"

[wally_indices]
default = "https://github.com/UpliftGames/wally-index"

[dependencies]
vide = { name = "centau/vide", version = "0.4.0" }
signal = { wally = "sleitnick/signal", version = "2.0.1" }

[dev_dependencies]
jest = { name = "jsdotlua/jest", version = "3.6.1" }
`;

function projectOf(over: Record<string, string | null> = {}, host?: Record<string, unknown>): PackContext & { files: Map<string, string> } {
  const base: Record<string, string> = {
    [`${ROOT}/pesde.toml`]: MANIFEST,
    [`${ROOT}/pesde.lock`]: 'graph = {}\n',
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
    host: {
      resolveToolCommand: () => ({ executable: '/home/u/.rokit/bin/pesde', prefixArgs: [], source: 'rokit' }),
      ...host,
    },
  };
}

const checkOf = async (ctx: PackContext, id: string) => {
  const checks = await PESDE_PACK.validate(ctx, {});
  const found = checks.find((c) => c.id === id);
  if (!found) throw new Error(`no check ${id} in ${checks.map((c) => c.id).join(', ')}`);
  return found;
};

describe('detection', () => {
  it('reads the manifest and separates pesde dependencies from Wally ones', async () => {
    // Two providers in one manifest is normal for pesde, and "which registry
    // did this come from" therefore has two possible answers.
    const found = await PESDE_PACK.detect(projectOf(), {});
    expect(found.present).toBe(true);
    expect(found.detail!.packageName).toBe('acme/game');
    expect(found.detail!.dependencies).toEqual([
      { alias: 'jest', kind: 'pesde', name: 'jsdotlua/jest', version: '3.6.1', index: undefined, section: 'dev_dependencies' },
      { alias: 'signal', kind: 'wally', name: 'sleitnick/signal', version: '2.0.1', index: undefined, section: 'dependencies' },
      { alias: 'vide', kind: 'pesde', name: 'centau/vide', version: '0.4.0', index: undefined, section: 'dependencies' },
    ]);
  });

  it('says locked or unlocked, since it decides what an install would do', async () => {
    expect((await PESDE_PACK.detect(projectOf(), {})).variant).toBe('locked');
    expect((await PESDE_PACK.detect(projectOf({ [`${ROOT}/pesde.lock`]: null }), {})).variant).toBe('unlocked');
  });

  it('treats a manifest that does not parse as unusable, not as an empty one', async () => {
    // An empty manifest reports zero dependencies, which is a sentence about
    // the project rather than about the parse.
    const broken = await PESDE_PACK.detect(projectOf({ [`${ROOT}/pesde.toml`]: '[target\nenvironment =' }), {});
    expect(broken.present).toBe(false);
    expect(broken.evidence.join(' ')).toMatch(/exists but does not parse as TOML/);
  });
});

describe('planning', () => {
  it('installs with --locked when a lockfile exists', async () => {
    const draft = await PESDE_PACK.plan(projectOf(), {});
    expect(draft.steps).toEqual([expect.objectContaining({ id: 'install-locked', kind: 'automatic' })]);
    // Stated rather than assumed: the equivalent claim about Wally was wrong.
    expect(draft.detail!.lockedFlagSupported).toBe(true);
  });

  it('blocks resolving a lockfile that does not exist yet', async () => {
    // Installing without a lock picks versions. That is choosing, not
    // restoring, and it is the same line project_reconcile draws.
    const draft = await PESDE_PACK.plan(projectOf({ [`${ROOT}/pesde.lock`]: null }), {});
    expect(draft.steps[0]).toMatchObject({ id: 'resolve-lockfile', kind: 'blocked' });
    expect(draft.steps[0].blockedBy).toMatch(/a decision, not a repair/);
  });

  it('plans nothing when there is no usable manifest', async () => {
    const draft = await PESDE_PACK.plan(projectOf({ [`${ROOT}/pesde.toml`]: null }), {});
    expect(draft.steps).toEqual([]);
    expect(String(draft.detail!.reason)).toMatch(/nothing to install/);
  });

  it('records the lockfile as absent rather than omitting it', async () => {
    const draft = await PESDE_PACK.plan(projectOf({ [`${ROOT}/pesde.lock`]: null }), {});
    expect(draft.expectations.find((e) => e.path.endsWith('pesde.lock'))!.digest).toBeNull();
  });
});

describe('applying', () => {
  const step = { id: 'install-locked', summary: '', kind: 'automatic' as const, touches: [] };

  it('runs the pinned shim with --locked', async () => {
    const calls: [string, readonly string[]][] = [];
    const ctx: PackContext = {
      ...projectOf(),
      exec: async (file, args) => {
        calls.push([file, args]);
        return { code: 0, stdout: '', stderr: '' };
      },
    };
    const result = await PESDE_PACK.apply(ctx, step);
    expect(calls).toEqual([['/home/u/.rokit/bin/pesde', ['install', '--locked']]]);
    expect(result).toMatchObject({ ok: true, source: 'rokit' });
  });

  it('refuses a pesde that was only found on PATH', async () => {
    // Invariant 4: a bare name searches PATH even when the project pinned
    // something else, and the two are different installs.
    const ctx: PackContext = {
      ...projectOf({}, { resolveToolCommand: () => ({ executable: 'pesde', prefixArgs: [], source: 'path' }) }),
      exec: async () => ({ code: 0, stdout: '', stderr: '' }),
    };
    await expect(PESDE_PACK.apply(ctx, step)).rejects.toThrow(/no pinned pesde was found/);
  });

  it('reports a non-zero exit rather than interpreting it', async () => {
    // With --locked a failure is usually "the manifest moved and the lock did
    // not", but it can also be the network, and the pack does not know which.
    const ctx: PackContext = {
      ...projectOf(),
      exec: async () => ({ code: 1, stdout: '', stderr: 'error: lockfile is out of date\n' }),
    };
    const result = await PESDE_PACK.apply(ctx, step);
    expect(result).toMatchObject({ ok: false, exitCode: 1 });
    expect(result.stderrTail).toEqual(['error: lockfile is out of date']);
  });
});

describe('validation', () => {
  it('passes a well-formed Roblox project', async () => {
    const checks = await PESDE_PACK.validate(projectOf(), {});
    expect(checks.filter((c) => c.status !== 'pass')).toEqual([]);
  });

  it('fails a missing lockfile, because two machines then get different code', async () => {
    const check = await checkOf(projectOf({ [`${ROOT}/pesde.lock`]: null }), 'lockfile');
    expect(check.status).toBe('fail');
    expect(check.message).toMatch(/different code from the same manifest/);
  });

  it('fails a registry dependency with no version', async () => {
    const loose = projectOf({
      [`${ROOT}/pesde.toml`]: '[target]\nenvironment = "roblox"\n\n[dependencies]\nvide = { name = "centau/vide" }\n',
    });
    const check = await checkOf(loose, 'versions');
    expect(check.status).toBe('fail');
    expect(check.message).toMatch(/depends on when it was installed/);
  });

  it('fails a dependency naming an index the manifest never declared', async () => {
    const ghost = projectOf({
      [`${ROOT}/pesde.toml`]: '[target]\nenvironment = "roblox"\n\n[dependencies]\nx = { name = "a/b", version = "1.0.0", index = "acme" }\n',
    });
    const check = await checkOf(ghost, 'indices');
    expect(check.status).toBe('fail');
    expect(check.message).toMatch(/x -> acme/);
  });

  it('checks a Wally dependency against the Wally indices, not the pesde ones', async () => {
    // They are separate tables in the manifest, and crossing them would clear
    // an index that was never declared for that provider.
    const crossed = projectOf({
      [`${ROOT}/pesde.toml`]: [
        '[target]', 'environment = "roblox"', '',
        '[indices]', 'acme = "https://example.org/pesde"', '',
        '[dependencies]', 'x = { wally = "a/b", version = "1.0.0", index = "acme" }',
      ].join('\n'),
    });
    expect((await checkOf(crossed, 'indices')).status).toBe('fail');
  });

  it('fails a target that does not put code in a place, and says which ones do', async () => {
    const lune = projectOf({ [`${ROOT}/pesde.toml`]: '[target]\nenvironment = "lune"\n' });
    const check = await checkOf(lune, 'target');
    expect(check.status).toBe('fail');
    expect(check.message).toMatch(/roblox and roblox_server/);
  });

  it('says unknown rather than guessing when the target is unset', async () => {
    expect((await checkOf(projectOf({ [`${ROOT}/pesde.toml`]: 'name = "a/b"\n' }), 'target')).status).toBe('unknown');
  });

  it('reports an absent manifest as unknown and an unparsable one as a failure', async () => {
    expect((await checkOf(projectOf({ [`${ROOT}/pesde.toml`]: null }), 'manifest')).status).toBe('unknown');
    expect((await checkOf(projectOf({ [`${ROOT}/pesde.toml`]: '[oops' }), 'manifest')).status).toBe('fail');
  });

  it('fails when pesde is only on PATH', async () => {
    const unpinned = projectOf({}, { resolveToolCommand: () => ({ executable: 'pesde', prefixArgs: [], source: 'path' }) });
    expect((await checkOf(unpinned, 'pinned-pesde')).status).toBe('fail');
  });
});
