import { ADONIS_PACK } from '../integrations/packs/adonis.js';
import type { PackContext } from '../integrations/pack.js';

const ROOT = '/proj';
const LOADER = `${ROOT}/Adonis/Loader/Loader/Loader.server.luau`;
const SETTINGS = `${ROOT}/Adonis/Loader/Config/Settings/General.luau`;

/** The shapes Adonis actually ships, quoted from master. */
const LOADER_SOURCE = [
  'local ServerScriptService = game:GetService("ServerScriptService")',
  'local data = {',
  '\tDebugMode = true;',
  '}',
].join('\n');

const SETTINGS_SOURCE = [
  'return function(settings)',
  '\tsettings.DataStoreKey = "CHANGE_THIS";\t-- CHANGE THIS TO ANYTHING RANDOM!',
  '\tsettings.HttpWait = 60;',
  'end',
].join('\n');

function projectOf(over: Record<string, string | null> = {}): PackContext & { files: Map<string, string> } {
  const base: Record<string, string> = {
    [LOADER]: LOADER_SOURCE,
    [SETTINGS]: SETTINGS_SOURCE,
    [`${ROOT}/Adonis/MainModule/Server/Server.luau`]: '-- server',
    [`${ROOT}/Adonis/Loader/Version.model.json`]: JSON.stringify({ ClassName: 'StringValue', Properties: { Value: '1.7.2' } }),
    [`${ROOT}/default.project.json`]: JSON.stringify({ tree: { ServerScriptService: { Adonis: { $path: 'Adonis/Loader' } } } }),
  };
  for (const [path, content] of Object.entries(over)) {
    if (content === null) delete base[path];
    else base[path] = content;
  }
  const files = new Map(Object.entries(base));
  return { root: ROOT, files, readFile: (p) => files.get(p) ?? null, exists: (p) => files.has(p) };
}

const checkOf = async (ctx: PackContext, id: string, request: Record<string, unknown> = {}) => {
  const checks = await ADONIS_PACK.validate(ctx, request);
  const found = checks.find((c) => c.id === id);
  if (!found) throw new Error(`no check ${id} in ${checks.map((c) => c.id).join(', ')}`);
  return found;
};

describe('detection', () => {
  it('finds a checkout under one of the usual paths', async () => {
    const found = await ADONIS_PACK.detect(projectOf(), {});
    expect(found.present).toBe(true);
    expect(found.variant).toBe('filesystem');
    expect(found.version).toBe('1.7.2');
  });

  it('takes an explicit path when the checkout is somewhere else', async () => {
    const odd = projectOf({ [LOADER]: null, [`${ROOT}/third_party/adonis/Loader/Loader/Loader.server.luau`]: LOADER_SOURCE });
    expect((await ADONIS_PACK.detect(odd, { path: 'third_party/adonis' })).present).toBe(true);
  });

  it('says it cannot see a place, rather than that there is no Adonis', async () => {
    // An Adonis inserted as a model lives inside the place, and a place is
    // outside the effect ceiling every pack is bounded by. Reporting "absent"
    // would be a confident wrong answer.
    const empty = await ADONIS_PACK.detect(projectOf({ [LOADER]: null }), {});
    expect(empty.present).toBe(false);
    expect(empty.variant).toBe('not-on-disk');
    expect(empty.evidence.join(' ')).toMatch(/inserted as a model lives inside the place/);
  });
});

describe('planning', () => {
  it('blocks both settings changes rather than making them', async () => {
    // One is a safety switch whose right value depends on whether this place is
    // production; the other is a secret.
    const draft = await ADONIS_PACK.plan(projectOf(), {});
    expect(draft.steps.map((s) => [s.id, s.kind])).toEqual([
      ['disable-debug-mode', 'blocked'],
      ['set-datastore-key', 'blocked'],
    ]);
  });

  it('will not generate a datastore key, and says why', async () => {
    const draft = await ADONIS_PACK.plan(projectOf(), {});
    expect(draft.steps[1].blockedBy).toMatch(/would put it in a plan, a response and a log/);
  });

  it('plans nothing once both settings are right', async () => {
    const fixed = projectOf({
      [LOADER]: LOADER_SOURCE.replace('DebugMode = true', 'DebugMode = false'),
      [SETTINGS]: SETTINGS_SOURCE.replace('CHANGE_THIS', 'a7f3c19e'),
    });
    expect((await ADONIS_PACK.plan(fixed, {})).steps).toEqual([]);
  });

  it('has no automatic implementation to reach', async () => {
    await expect(ADONIS_PACK.apply(projectOf(), { id: 'disable-debug-mode', summary: '', kind: 'blocked', touches: [] }))
      .rejects.toThrow(/Every step this pack plans is blocked/);
  });
});

describe('validation', () => {
  it('fails the DebugMode Adonis ships enabled', async () => {
    const check = await checkOf(projectOf(), 'debug-mode');
    expect(check.status).toBe('fail');
    expect(check.message).toMatch(/the default rather than somebody's choice/);
  });

  it('passes once it is disabled', async () => {
    const fixed = projectOf({ [LOADER]: LOADER_SOURCE.replace('DebugMode = true', 'DebugMode = false') });
    expect((await checkOf(fixed, 'debug-mode')).status).toBe('pass');
  });

  it('does not read a commented-out assignment as the real one', async () => {
    const commented = projectOf({ [LOADER]: '-- DebugMode = true\n\tDebugMode = false;' });
    expect((await checkOf(commented, 'debug-mode')).status).toBe('pass');
  });

  it('fails the shipped placeholder key without ever printing a real one', async () => {
    const placeholder = await checkOf(projectOf(), 'datastore-key');
    expect(placeholder.status).toBe('fail');
    expect(placeholder.message).toMatch(/every saved entry is readable and writable/);

    const set = await checkOf(projectOf({ [SETTINGS]: SETTINGS_SOURCE.replace('CHANGE_THIS', 'a7f3c19e2b') }), 'datastore-key');
    expect(set.status).toBe('pass');
    // The value is the thing this check exists to protect. Proving it was set
    // by quoting it would be the leak.
    expect(set.message).not.toMatch(/a7f3c19e2b/);
    expect(set.message).toMatch(/deliberately not read back/);
  });

  it('treats an empty key as the placeholder problem without the placeholder', async () => {
    const blank = projectOf({ [SETTINGS]: SETTINGS_SOURCE.replace('CHANGE_THIS', '') });
    expect((await checkOf(blank, 'datastore-key')).status).toBe('fail');
  });

  it('says unknown when there is no assignment to read', async () => {
    expect((await checkOf(projectOf({ [SETTINGS]: 'return function() end' }), 'datastore-key')).status).toBe('unknown');
  });

  it('fails a project that never mounts anything into ServerScriptService', async () => {
    const workspace = projectOf({ [`${ROOT}/default.project.json`]: JSON.stringify({ tree: { Workspace: { Adonis: { $path: 'Adonis/Loader' } } } }) });
    const check = await checkOf(workspace, 'loader-placement');
    expect(check.status).toBe('fail');
    expect(check.message).toMatch(/Do not leave it in the Workspace/);
  });

  it('says unknown, not pass, when the project file cannot be read', async () => {
    expect((await checkOf(projectOf({ [`${ROOT}/default.project.json`]: null }), 'loader-placement')).status).toBe('unknown');
  });

  it('reports a checkout with no version as the bleeding-edge build, advisory', async () => {
    const check = await checkOf(projectOf({ [`${ROOT}/Adonis/Loader/Version.model.json`]: null }), 'version');
    expect(check).toMatchObject({ status: 'unknown', advisory: true });
    expect(check.message).toMatch(/highly unstable/);
  });

  it('reports no Adonis as unknown rather than as a clean bill of health', async () => {
    const checks = await ADONIS_PACK.validate(projectOf({ [LOADER]: null }), {});
    expect(checks).toEqual([expect.objectContaining({ id: 'installed', status: 'unknown' })]);
  });
});
