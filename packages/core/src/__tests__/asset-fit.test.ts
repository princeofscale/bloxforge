import { WorldModelTools, CHARACTER_HEIGHT_STUDS } from '../tools/world-model-tools.js';
import { buildFitApplyLuau, buildFitScanLuau } from '../builders/asset-fit.js';

// A model arrives at whatever scale its author worked in, with its pivot
// wherever their modelling tool left it. Both are mechanical to correct and
// invisible to an agent that can only read names and classes.

const scan = (over: Record<string, unknown> = {}) => ({
  found: true,
  isModel: true,
  path: 'game.Workspace.Statue',
  className: 'Model',
  scale: 1,
  extents: [40, 110, 40],
  center: [200, 55, 200],
  pivotOffset: [-200, -55, -200],
  partCount: 2,
  unanchoredParts: 1,
  ...over,
});

function runtimeReturning(...scans: unknown[]) {
  const applies: Array<{ code: string; undoLabel?: string }> = [];
  let call = 0;
  return {
    applies,
    runtime: {
      callSingle: async () => ({ returnValue: JSON.stringify(scans[Math.min(call++, scans.length - 1)]) }),
      runGeneratedLuau: async (code: string, _id?: string, undoLabel?: string) => {
        applies.push({ code, undoLabel });
        return { content: [{ type: 'text' as const, text: '{"ok":true}' }] };
      },
    },
  };
}

const parse = (r: { content: Array<{ type: string }> }) =>
  JSON.parse((r.content[0] as { text?: string })?.text ?? '{}');

describe('asset_fit_plan', () => {
  it('measures the model against a character, the platform\'s one absolute reference', async () => {
    const { runtime } = runtimeReturning(scan());
    const body = parse(await new WorldModelTools(runtime).assetFitPlan('game.Workspace.Statue', 12));
    expect(body.heightInCharacters).toBe(110 / CHARACTER_HEIGHT_STUDS);
    expect(body.notes.join(' ')).toMatch(/22× the height of a character/);
  });

  it('computes an absolute scale that lands on the requested height', async () => {
    const { runtime } = runtimeReturning(scan());
    const body = parse(await new WorldModelTools(runtime).assetFitPlan('game.Workspace.Statue', 12));
    expect(body.proposed.resultingHeight).toBe(12);
    expect(body.proposed.scale).toBeCloseTo(12 / 110, 5);
  });

  it('computes from the current scale, so applying against an already-scaled model does not compound', async () => {
    const { runtime } = runtimeReturning(scan({ scale: 0.5, extents: [20, 55, 20] }));
    const body = parse(await new WorldModelTools(runtime).assetFitPlan('game.Workspace.Statue', 12));
    // 0.5 * (12 / 55) — not 12 / 55.
    expect(body.proposed.scale).toBeCloseTo(0.5 * (12 / 55), 5);
    expect(body.proposed.resultingHeight).toBe(12);
  });

  it('reports a pivot that is nowhere near the model', async () => {
    const { runtime } = runtimeReturning(scan());
    const body = parse(await new WorldModelTools(runtime).assetFitPlan('game.Workspace.Statue', 12));
    expect(body.pivotAlreadyAtBase).toBe(false);
    expect(body.notes.join(' ')).toMatch(/swing the model/);
  });

  it('recognises a pivot already at the base and says nothing about it', async () => {
    const { runtime } = runtimeReturning(scan({ pivotOffset: [0, -55, 0] }));
    const body = parse(await new WorldModelTools(runtime).assetFitPlan('game.Workspace.Statue', 12));
    expect(body.pivotAlreadyAtBase).toBe(true);
    expect(body.notes.join(' ')).not.toMatch(/swing the model/);
  });

  it('flags unanchored parts, which fall the moment anyone playtests', async () => {
    const { runtime } = runtimeReturning(scan());
    const body = parse(await new WorldModelTools(runtime).assetFitPlan('game.Workspace.Statue', 12));
    expect(body.notes.join(' ')).toMatch(/1 of 2 parts are unanchored/);
  });

  it('leaves the scale alone when no targetHeight is given', async () => {
    const { runtime } = runtimeReturning(scan());
    const body = parse(await new WorldModelTools(runtime).assetFitPlan('game.Workspace.Statue'));
    expect(body.proposed.scale).toBeUndefined();
    expect(body.proposed.resultingHeight).toBe(110);
  });

  it('refuses a non-Model, because scale and pivot are Model properties', async () => {
    const { runtime } = runtimeReturning({ found: true, isModel: false, path: 'game.Workspace.Statue.Body', className: 'Part' });
    await expect(new WorldModelTools(runtime).assetFitPlan('game.Workspace.Statue.Body', 12))
      .rejects.toThrow(/needs a Model; .* is a Part/);
  });

  it('refuses a path that does not resolve', async () => {
    const { runtime } = runtimeReturning({ found: false });
    await expect(new WorldModelTools(runtime).assetFitPlan('game.Workspace.Nope', 12)).rejects.toThrow(/not found/);
  });
});

describe('asset_fit_apply', () => {
  const planThen = async (planScan: unknown, applyScan: unknown, height?: number) => {
    const { runtime, applies } = runtimeReturning(planScan, applyScan);
    const tools = new WorldModelTools(runtime);
    const plan = parse(await tools.assetFitPlan('game.Workspace.Statue', height));
    return { tools, plan, applies };
  };

  it('refuses without a planHash', async () => {
    const { runtime } = runtimeReturning(scan());
    await expect(new WorldModelTools(runtime).assetFitApply('game.Workspace.Statue', '', 12))
      .rejects.toThrow(/expectedPlanHash is required/);
  });

  it('applies when the model still measures what the plan recorded', async () => {
    const s = scan();
    const { tools, plan, applies } = await planThen(s, s, 12);
    await tools.assetFitApply('game.Workspace.Statue', plan.planHash, 12);
    expect(applies).toHaveLength(1);
    expect(applies[0].undoLabel).toMatch(/fit model/);
  });

  it('refuses when the model was rescaled between plan and apply', async () => {
    const { tools, plan, applies } = await planThen(scan(), scan({ scale: 0.5, extents: [20, 55, 20] }), 12);
    await expect(tools.assetFitApply('game.Workspace.Statue', plan.planHash, 12))
      .rejects.toThrow(/changed after asset_fit_plan ran/);
    expect(applies).toHaveLength(0);
  });

  it('refuses when the requested height differs from the plan', async () => {
    const s = scan();
    const { tools, plan } = await planThen(s, s, 12);
    await expect(tools.assetFitApply('game.Workspace.Statue', plan.planHash, 20))
      .rejects.toThrow(/changed after asset_fit_plan ran/);
  });

  it('refuses when the pivot policy differs from the plan', async () => {
    const s = scan();
    const { tools, plan } = await planThen(s, s, 12);
    await expect(tools.assetFitApply('game.Workspace.Statue', plan.planHash, 12, 'center'))
      .rejects.toThrow(/changed after asset_fit_plan ran/);
  });

  it('does nothing when there is no height and the pivot is kept', async () => {
    const { runtime, applies } = runtimeReturning(scan(), scan());
    const tools = new WorldModelTools(runtime);
    const plan = parse(await tools.assetFitPlan('game.Workspace.Statue', undefined, 'keep'));
    const body = parse(await tools.assetFitApply('game.Workspace.Statue', plan.planHash, undefined, 'keep'));
    expect(body.changed).toEqual([]);
    expect(applies).toHaveLength(0);
  });
});

describe('generated Luau', () => {
  it('escapes the path it was given', () => {
    expect(buildFitScanLuau('game.Workspace."; evil()--')).toContain('\\"');
  });

  it('passes an absolute scale rather than a factor', () => {
    expect(buildFitApplyLuau('game.Workspace.Statue', 0.25, 'keep')).toContain('node:ScaleTo(targetScale)');
  });

  it('puts a "base" pivot at the bottom of the bounding box', () => {
    const code = buildFitApplyLuau('game.Workspace.Statue', undefined, 'base');
    expect(code).toContain('size.Y / 2');
  });

  it('leaves the pivot alone for "keep"', () => {
    const code = buildFitApplyLuau('game.Workspace.Statue', 1, 'keep');
    expect(code).toContain('pivotPolicy ~= "keep"');
  });
});
