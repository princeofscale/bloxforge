import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rootOf } from '../tools/integration-registry.js';
import {
  _resetPacks,
  applyIntegration,
  digestOf,
  fileContext,
  getPack,
  inspectIntegration,
  listPacks,
  PACK_EFFECT_CEILING,
  PackError,
  planIntegration,
  registerPack,
  validateIntegration,
  type Check,
  type DraftPlan,
  type IntegrationPack,
  type PackContext,
} from '../integrations/pack.js';

/** A file system that lives in a Map, so a test can move a file mid-apply. */
function ctxOf(files: Record<string, string>): PackContext & { files: Map<string, string> } {
  const map = new Map(Object.entries(files));
  return { root: '/proj', readFile: (p) => map.get(p) ?? null, files: map };
}

const applied: string[] = [];

function packOf(over: Partial<IntegrationPack> = {}): IntegrationPack {
  return {
    id: 'demo',
    title: 'Demo',
    version: '1.0.0',
    license: 'MIT',
    sourceOfTruth: 'https://example.org/demo',
    effects: ['local.files.read', 'local.files.write'],
    detect: async () => ({ present: true, evidence: ['/proj/demo.toml exists'], version: '2.1.0' }),
    plan: async (ctx): Promise<DraftPlan> => ({
      steps: [{ id: 'write-config', summary: 'write the config', kind: 'automatic', touches: ['/proj/demo.toml'] }],
      expectations: [{ path: '/proj/demo.toml', digest: digestOf(ctx.readFile('/proj/demo.toml')) }],
    }),
    apply: async (_ctx, step) => {
      applied.push(step.id);
      return { wrote: step.touches.length };
    },
    validate: async (): Promise<Check[]> => [{ id: 'configured', status: 'pass', message: 'config present' }],
    ...over,
  };
}

beforeEach(() => {
  _resetPacks();
  applied.length = 0;
});

describe('the registry', () => {
  it('refuses an unknown pack and names the ones it has', () => {
    registerPack(packOf());
    expect(() => getPack('adonis')).toThrow(/Unknown integration pack: adonis\. Registered: demo/);
  });

  it('refuses a second pack under the same id rather than shadowing the first', () => {
    registerPack(packOf());
    expect(() => registerPack(packOf())).toThrow(/already registered/);
  });

  it('advertises licence and source of truth alongside the id', () => {
    // A pack that installs somebody else's code has to say under what terms,
    // and a reviewer has to know what the pack was written against.
    registerPack(packOf());
    expect(listPacks()).toEqual([{
      id: 'demo', title: 'Demo', version: '1.0.0', license: 'MIT',
      sourceOfTruth: 'https://example.org/demo',
      effects: ['local.files.read', 'local.files.write'],
    }]);
  });
});

describe('the effect ceiling', () => {
  it('refuses a pack that declares more than the integration_* tools do', () => {
    // A tool's effects are fixed at definition time; the pack behind it is
    // chosen at call time. Bounding the packs is what keeps the four tool
    // declarations honest rather than aspirational.
    expect(() => registerPack(packOf({ effects: ['studio.write'] })))
      .toThrow(/declares studio\.write, which the integration_\* tools do not declare/);
  });

  it('keeps every studio effect outside the ceiling', () => {
    // The four tools are exempt from the instance_id requirement in
    // tool-schema.test.ts on exactly this basis. Widening the ceiling to reach
    // a place means those tools need instance_id in the same change.
    expect(PACK_EFFECT_CEILING.filter((e) => e.startsWith('studio.'))).toEqual([]);
  });

  it('refuses a pack that declares nothing', () => {
    expect(() => registerPack(packOf({ effects: [] }))).toThrow(/declares no effects/);
  });
});

describe('path containment', () => {
  it('refuses a pack naming a path outside the project root', async () => {
    registerPack(packOf({
      plan: async () => ({ steps: [], expectations: [{ path: '/etc/passwd', digest: null }] }),
    }));
    await expect(planIntegration('demo', ctxOf({}))).rejects.toThrow(/outside the project root \/proj/);
  });

  it('refuses a traversal that resolves out of the root', async () => {
    registerPack(packOf({
      plan: async () => ({ steps: [], expectations: [{ path: '/proj/../elsewhere/x', digest: null }] }),
    }));
    await expect(planIntegration('demo', ctxOf({}))).rejects.toThrow(/outside the project root/);
  });
});

describe('inspect', () => {
  it('reports the evidence, not only the verdict', async () => {
    registerPack(packOf());
    const found = await inspectIntegration('demo', ctxOf({}));
    expect(found.present).toBe(true);
    expect(found.evidence).toEqual(['/proj/demo.toml exists']);
    expect(found.license).toBe('MIT');
  });
});

describe('plan', () => {
  it('catches a step that touches a file the plan never recorded', async () => {
    // Otherwise that file is written without ever being re-read: the
    // reread-before-write invariant defeated by omission rather than by edit.
    registerPack(packOf({
      plan: async () => ({
        steps: [{ id: 's', summary: 's', kind: 'automatic', touches: ['/proj/unrecorded.toml'] }],
        expectations: [],
      }),
    }));
    await expect(planIntegration('demo', ctxOf({}))).rejects.toThrow(/touches \/proj\/unrecorded\.toml, which the plan does not record/);
  });

  it('refuses a blocked step that does not say what would permit it', async () => {
    registerPack(packOf({
      plan: async () => ({ steps: [{ id: 's', summary: 's', kind: 'blocked', touches: [] }], expectations: [] }),
    }));
    await expect(planIntegration('demo', ctxOf({}))).rejects.toThrow(/does not name what would permit it/);
  });

  it('refuses duplicate step ids, because step order is the contract', async () => {
    registerPack(packOf({
      plan: async () => ({
        steps: [
          { id: 'x', summary: 'a', kind: 'automatic', touches: [] },
          { id: 'x', summary: 'b', kind: 'automatic', touches: [] },
        ],
        expectations: [],
      }),
    }));
    await expect(planIntegration('demo', ctxOf({}))).rejects.toThrow(/two steps with id x/);
  });

  it('hashes the request, so the same plan for a different ask is a different plan', async () => {
    registerPack(packOf());
    const ctx = ctxOf({ '/proj/demo.toml': 'a = 1' });
    const one = await planIntegration('demo', ctx, { version: '1' });
    const two = await planIntegration('demo', ctx, { version: '2' });
    expect(one.planHash).not.toBe(two.planHash);
  });

  it('hashes the request by content rather than by key order', async () => {
    registerPack(packOf());
    const ctx = ctxOf({ '/proj/demo.toml': 'a = 1' });
    const one = await planIntegration('demo', ctx, { a: 1, b: { c: 2, d: 3 } });
    const two = await planIntegration('demo', ctx, { b: { d: 3, c: 2 }, a: 1 });
    expect(one.planHash).toBe(two.planHash);
  });

  it('hashes the remote identities it resolved', async () => {
    // A plan that pinned release 1.2.3 must not still apply once the tag moved.
    const withTag = (tag: string) => packOf({
      plan: async () => ({ steps: [], expectations: [], remoteIdentities: { release: tag } }),
    });
    registerPack(withTag('v1.2.3'));
    const first = await planIntegration('demo', ctxOf({}));
    _resetPacks();
    registerPack(withTag('v1.2.4'));
    expect((await planIntegration('demo', ctxOf({}))).planHash).not.toBe(first.planHash);
  });

  it('does not let free-form detail move the hash', async () => {
    const withDetail = (note: string) => packOf({
      plan: async () => ({ steps: [], expectations: [], detail: { note } }),
    });
    registerPack(withDetail('one'));
    const first = await planIntegration('demo', ctxOf({}));
    _resetPacks();
    registerPack(withDetail('two'));
    expect((await planIntegration('demo', ctxOf({}))).planHash).toBe(first.planHash);
  });
});

describe('apply', () => {
  const ready = async () => {
    registerPack(packOf());
    const ctx = ctxOf({ '/proj/demo.toml': 'a = 1' });
    return { ctx, plan: await planIntegration('demo', ctx) };
  };

  it('applies a fresh plan and reports what ran', async () => {
    const { ctx, plan } = await ready();
    const result = await applyIntegration('demo', ctx, plan, plan.planHash, true);
    expect(result.complete).toBe(true);
    expect(applied).toEqual(['write-config']);
  });

  it('requires confirm and a plan hash rather than defaulting either', async () => {
    const { ctx, plan } = await ready();
    await expect(applyIntegration('demo', ctx, plan, plan.planHash, undefined)).rejects.toThrow(/confirm=true is required/);
    await expect(applyIntegration('demo', ctx, plan, undefined, true)).rejects.toThrow(/expectedPlanHash is required/);
    expect(applied).toEqual([]);
  });

  it('refuses a stale hash and names both', async () => {
    const { ctx, plan } = await ready();
    await expect(applyIntegration('demo', ctx, plan, 'sha256:nope', true)).rejects.toThrow(/expected sha256:nope, plan is sha256:/);
  });

  it('refuses a plan made by a different version of the pack', async () => {
    const { ctx, plan } = await ready();
    _resetPacks();
    registerPack(packOf({ version: '1.1.0' }));
    await expect(applyIntegration('demo', ctx, plan, plan.planHash, true)).rejects.toThrow(/plan was made by pack version 1\.0\.0, this is 1\.1\.0/);
  });

  it('stops before touching anything when a recorded file moved', async () => {
    const { ctx, plan } = await ready();
    ctx.files.set('/proj/demo.toml', 'a = 2');
    await expect(applyIntegration('demo', ctx, plan, plan.planHash, true))
      .rejects.toThrow(/demo\.toml changed since the plan was made/);
    expect(applied).toEqual([]);
  });

  it('reports a file that was expected to be absent and is not', async () => {
    registerPack(packOf({
      plan: async () => ({
        steps: [{ id: 'create', summary: 'create it', kind: 'automatic', touches: ['/proj/new.toml'] }],
        expectations: [{ path: '/proj/new.toml', digest: null }],
      }),
    }));
    const ctx = ctxOf({});
    const plan = await planIntegration('demo', ctx);
    ctx.files.set('/proj/new.toml', 'someone else got here first');
    await expect(applyIntegration('demo', ctx, plan, plan.planHash, true))
      .rejects.toThrow(/plan recorded absent, found sha256:/);
  });

  it('re-reads before each step, not only once at the start', async () => {
    // Step one can take a minute, and step three's file can move inside it.
    // An up-front check alone would let that write land on changed content.
    const ctx = ctxOf({ '/proj/a': '1', '/proj/b': '2' });
    registerPack(packOf({
      plan: async (c) => ({
        steps: [
          { id: 'first', summary: 'first', kind: 'automatic', touches: ['/proj/a'] },
          { id: 'second', summary: 'second', kind: 'automatic', touches: ['/proj/b'] },
        ],
        expectations: [
          { path: '/proj/a', digest: digestOf(c.readFile('/proj/a')) },
          { path: '/proj/b', digest: digestOf(c.readFile('/proj/b')) },
        ],
      }),
      apply: async (_c, step) => {
        applied.push(step.id);
        if (step.id === 'first') ctx.files.set('/proj/b', 'moved under us');
        return {};
      },
    }));
    const plan = await planIntegration('demo', ctx);
    await expect(applyIntegration('demo', ctx, plan, plan.planHash, true))
      .rejects.toThrow(/\/proj\/b changed before step second/);
    expect(applied).toEqual(['first']);
  });

  it('never runs a blocked step, and says why it did not', async () => {
    registerPack(packOf({
      plan: async () => ({
        steps: [
          { id: 'repair', summary: 'install the pinned version', kind: 'automatic', touches: [] },
          { id: 'decide', summary: 'pick a version', kind: 'blocked', blockedBy: '[automation] allowVersionChoice', touches: [] },
        ],
        expectations: [],
      }),
    }));
    const ctx = ctxOf({});
    const plan = await planIntegration('demo', ctx);
    const result = await applyIntegration('demo', ctx, plan, plan.planHash, true);
    expect(applied).toEqual(['repair']);
    expect(result.skipped).toEqual([{ stepId: 'decide', reason: 'blocked: [automation] allowVersionChoice' }]);
    expect(result.complete).toBe(true);
  });

  it('does not call a plan of nothing a success', async () => {
    registerPack(packOf({ plan: async () => ({ steps: [], expectations: [] }) }));
    const ctx = ctxOf({});
    const plan = await planIntegration('demo', ctx);
    const result = await applyIntegration('demo', ctx, plan, plan.planHash, true);
    expect(result.summary).toMatch(/Nothing to apply/);
    // A caller branching on `complete` is asking "is it applied now". Answering
    // yes because there was nothing to do records "nothing happened" as "it
    // worked".
    expect(result.complete).toBe(false);
  });
});

describe('validate', () => {
  const withChecks = (checks: Check[]) => registerPack(packOf({ validate: async () => checks }));

  it('passes only when every blocking check passed', async () => {
    withChecks([{ id: 'a', status: 'pass', message: 'ok' }]);
    expect((await validateIntegration('demo', ctxOf({}))).passed).toBe(true);
  });

  it('blocks on unknown exactly as it blocks on fail', async () => {
    // A check that could not run is not a check that passed. This is the same
    // rule the asset gates hold, and for the same reason.
    for (const status of ['fail', 'unknown'] as const) {
      _resetPacks();
      withChecks([{ id: 'debug-mode', status, message: 'could not read Settings' }]);
      const result = await validateIntegration('demo', ctxOf({}));
      expect(result.passed).toBe(false);
      expect(result.blocking).toEqual([`debug-mode: ${status} — could not read Settings`]);
    }
  });

  it('lets an advisory check be unknown without blocking', async () => {
    withChecks([{ id: 'nice-to-have', status: 'unknown', message: 'no data', advisory: true }]);
    expect((await validateIntegration('demo', ctxOf({}))).passed).toBe(true);
  });
});

describe('the project root a tool resolves', () => {
  const previous = process.env.BLOXFORGE_PROJECT_ROOT;
  beforeEach(() => { process.env.BLOXFORGE_PROJECT_ROOT = '/tmp/bloxforge-root-test'; });
  afterEach(() => {
    if (previous === undefined) delete process.env.BLOXFORGE_PROJECT_ROOT;
    else process.env.BLOXFORGE_PROJECT_ROOT = previous;
  });

  it('defaults to the configured root', () => {
    expect(rootOf({})).toBe('/tmp/bloxforge-root-test');
    expect(rootOf({ root: 'sub/dir' })).toBe('/tmp/bloxforge-root-test/sub/dir');
  });

  it('refuses an absolute root, which would otherwise discard the base entirely', () => {
    // `resolve(base, '/etc')` is `/etc`. The pack engine's containment check
    // would not catch it either: it measures paths against whatever root it is
    // handed, and this is where that root is chosen.
    expect(() => rootOf({ root: '/etc' })).toThrow(/must stay within \/tmp\/bloxforge-root-test/);
  });

  it('refuses a traversal out of the base', () => {
    expect(() => rootOf({ root: '../../elsewhere' })).toThrow(/must stay within/);
  });
});

describe('the real file context', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bloxforge-pack-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('resolves a relative path against the root, not the working directory', () => {
    // Otherwise the containment check and the read look at two different files,
    // and verifyFiles passes while the in-root file it claimed to watch changed.
    writeFileSync(join(dir, 'config.toml'), 'a = 1');
    const ctx = fileContext(dir);
    expect(ctx.readFile('config.toml')).toBe('a = 1');
    expect(ctx.exists!('config.toml')).toBe(true);
    expect(ctx.list!('.')).toContain('config.toml');
  });

  it('reports an absent file as null rather than throwing', () => {
    expect(fileContext(dir).readFile('nope.toml')).toBeNull();
  });

  it('reports a directory where a file was expected as absent, not as a crash', () => {
    mkdirSync(join(dir, 'adir'), { recursive: true });
    expect(fileContext(dir).readFile('adir')).toBeNull();
  });
});

describe('PackError', () => {
  it('is thrown rather than a bare Error, so a caller can branch on it', () => {
    expect(() => getPack('missing')).toThrow(PackError);
  });
});
