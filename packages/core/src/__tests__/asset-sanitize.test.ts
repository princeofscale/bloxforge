import { WorldModelTools } from '../tools/world-model-tools.js';
import { buildSanitizeScanLuau, buildSanitizeApplyLuau, SANITIZE_PATTERNS } from '../builders/asset-sanitize.js';

// A model that arrived from a Package, an .rbxm or a collaborator is the unit of
// trust, and the thing that makes sanitising safe is the same contract every
// other apply in this repo uses: the plan is immutable, and the subtree is
// re-read immediately before it is mutated.

const scan = (scripts: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}) => ({
  found: true,
  path: 'game.Workspace.Tree',
  className: 'Model',
  descendantCount: 4,
  remotes: [],
  scripts,
  ...extra,
});

const script = (over: Record<string, unknown> = {}) => ({
  path: 'game.Workspace.Tree.Main',
  name: 'Main',
  className: 'Script',
  enabled: true,
  sourceBytes: 120,
  sourceChecksum: 12345,
  findings: [],
  ...over,
});

/** Runtime that answers the scan with whatever the test wants, and records applies. */
function runtimeReturning(...scans: unknown[]) {
  const applies: Array<{ code: string; undoLabel?: string }> = [];
  let call = 0;
  return {
    applies,
    runtime: {
      callSingle: async () => ({ returnValue: JSON.stringify(scans[Math.min(call++, scans.length - 1)]) }),
      runGeneratedLuau: async (code: string, _id?: string, undoLabel?: string) => {
        applies.push({ code, undoLabel });
        return { content: [{ type: 'text' as const, text: '{"applied":[]}' }] };
      },
    },
  };
}

const parse = (r: { content: Array<{ type: string }> }) =>
  JSON.parse((r.content[0] as { text?: string })?.text ?? '{}');

describe('asset_sanitize_plan', () => {
  it('flags the capabilities that matter in code you did not write', async () => {
    const { runtime } = runtimeReturning(scan([
      script({ findings: ['http_request', 'require_asset_id'] }),
      script({ path: 'game.Workspace.Tree.Clean', name: 'Clean', findings: [] }),
    ]));
    const body = parse(await new WorldModelTools(runtime).assetSanitizePlan('game.Workspace.Tree'));

    expect(body.severity).toBe('high');
    expect(body.scriptCount).toBe(2);
    expect(body.flaggedCount).toBe(1);
    // Only the flagged script is described; the clean one contributes a count.
    expect(body.scripts).toHaveLength(1);
    expect(body.scripts[0].findings.map((f: { id: string }) => f.id)).toEqual(['http_request', 'require_asset_id']);
    expect(body.scripts[0].findings[0].why).toMatch(/network/);
  });

  it('never returns script source', async () => {
    const { runtime } = runtimeReturning(scan([script({ findings: ['dynamic_code'] })]));
    const text = JSON.stringify(await new WorldModelTools(runtime).assetSanitizePlan('game.Workspace.Tree'));
    expect(text).not.toMatch(/source["']?\s*:\s*["']/);
    expect(text).toContain('sourceBytes');
  });

  it('grades a scripted but unflagged model below a flagged one, and an empty one as none', async () => {
    const plan = async (scripts: Array<Record<string, unknown>>) => {
      const { runtime } = runtimeReturning(scan(scripts));
      return parse(await new WorldModelTools(runtime).assetSanitizePlan('game.Workspace.Tree')).severity;
    };
    expect(await plan([])).toBe('none');
    expect(await plan([script()])).toBe('low');
    expect(await plan([script({ findings: ['player_kick'] })])).toBe('medium');
    expect(await plan([script({ findings: ['dynamic_code'] })])).toBe('high');
  });

  it('rejects a path that does not resolve', async () => {
    const { runtime } = runtimeReturning({ found: false, path: 'game.Workspace.Nope' });
    await expect(new WorldModelTools(runtime).assetSanitizePlan('game.Workspace.Nope'))
      .rejects.toThrow(/not found/);
  });

  it('requires instancePath', async () => {
    const { runtime } = runtimeReturning(scan([]));
    await expect(new WorldModelTools(runtime).assetSanitizePlan(''))
      .rejects.toThrow(/instancePath is required/);
  });
});

describe('asset_sanitize_apply', () => {
  const planAndApply = async (planScan: unknown, applyScan: unknown) => {
    const { runtime, applies } = runtimeReturning(planScan, applyScan);
    const tools = new WorldModelTools(runtime);
    const plan = parse(await tools.assetSanitizePlan('game.Workspace.Tree'));
    return { tools, plan, applies };
  };

  it('refuses without a planHash', async () => {
    const { runtime } = runtimeReturning(scan([script()]));
    await expect(new WorldModelTools(runtime).assetSanitizeApply('game.Workspace.Tree', ''))
      .rejects.toThrow(/expectedPlanHash is required/);
  });

  it('applies when the subtree still hashes to what the plan recorded', async () => {
    const s = scan([script()]);
    const { tools, plan, applies } = await planAndApply(s, s);
    await tools.assetSanitizeApply('game.Workspace.Tree', plan.planHash);
    expect(applies).toHaveLength(1);
    expect(applies[0].undoLabel).toMatch(/sanitize disable/);
    expect(applies[0].code).toContain('game.Workspace.Tree.Main');
  });

  it('refuses when a script changed content between plan and apply', async () => {
    const { tools, plan, applies } = await planAndApply(
      scan([script({ sourceChecksum: 1 })]),
      scan([script({ sourceChecksum: 2 })]),
    );
    await expect(tools.assetSanitizeApply('game.Workspace.Tree', plan.planHash))
      .rejects.toThrow(/changed after asset_sanitize_plan ran/);
    expect(applies).toHaveLength(0);
  });

  it('refuses when a script was added between plan and apply', async () => {
    const { tools, plan, applies } = await planAndApply(
      scan([script()]),
      scan([script(), script({ path: 'game.Workspace.Tree.Sneaky', name: 'Sneaky' })]),
    );
    await expect(tools.assetSanitizeApply('game.Workspace.Tree', plan.planHash))
      .rejects.toThrow(/changed after asset_sanitize_plan ran/);
    expect(applies).toHaveLength(0);
  });

  it('binds the hash to the action, so a remove cannot ride a disable plan', async () => {
    const s = scan([script()]);
    const { tools, plan } = await planAndApply(s, s);
    await expect(tools.assetSanitizeApply('game.Workspace.Tree', plan.planHash, 'remove'))
      .rejects.toThrow(/changed after asset_sanitize_plan ran/);
  });

  it('does nothing, and asks for no undo waypoint, when there are no scripts', async () => {
    const s = scan([]);
    const { tools, plan, applies } = await planAndApply(s, s);
    const body = parse(await tools.assetSanitizeApply('game.Workspace.Tree', plan.planHash));
    expect(body.appliedCount).toBe(0);
    expect(applies).toHaveLength(0);
  });
});

describe('generated Luau', () => {
  it('escapes the path it was given', () => {
    const code = buildSanitizeScanLuau('game.Workspace."; evil()--');
    expect(code).toContain('\\"');
    expect(code).not.toMatch(/local target = "game\.Workspace\.";/);
  });

  it('unparents rather than destroying, so the change stays undoable', () => {
    const code = buildSanitizeApplyLuau('game.Workspace', ['game.Workspace.A'], 'remove');
    expect(code).toContain('inst.Parent = nil');
    expect(code).not.toContain(':Destroy()');
  });

  it('refuses to disable a ModuleScript instead of silently leaving it live', () => {
    const code = buildSanitizeApplyLuau('game.Workspace', ['game.Workspace.A'], 'disable');
    expect(code).toContain('BaseScript');
    expect(code).toMatch(/ModuleScript has no Enabled/);
  });

  it('acts only on the paths the plan listed', () => {
    const code = buildSanitizeApplyLuau('game.Workspace', ['game.Workspace.A'], 'disable');
    expect(code).toContain('["game.Workspace.A"] = 1');
    // The walk is over the plan's own root, and a script it did not name is
    // reached and then left alone.
    expect(code).toContain('root:GetDescendants()');
    expect(code).toContain('if remaining and remaining > 0 then');
  });

  // Two children may share a name, and in a foreign model that usually means
  // two Scripts called "Script". Resolving the same path twice returned the
  // same instance twice: one disabled twice, the other left live, and a receipt
  // that said two were disabled. Behaviour is asserted end-to-end in
  // tests/generated-luau-runtime.luau; this pins the count that carries it.
  it('counts duplicate paths rather than collapsing them into a set', () => {
    const code = buildSanitizeApplyLuau(
      'game.Workspace.Model',
      ['game.Workspace.Model.Script', 'game.Workspace.Model.Script', 'game.Workspace.Model.Other'],
      'disable',
    );
    expect(code).toContain('["game.Workspace.Model.Script"] = 2');
    expect(code).toContain('["game.Workspace.Model.Other"] = 1');
  });

  it('every pattern carries a reason a caller can act on', () => {
    for (const p of SANITIZE_PATTERNS) {
      expect(p.why.length).toBeGreaterThan(10);
      expect(p.id).toMatch(/^[a-z_]+$/);
    }
  });
});
