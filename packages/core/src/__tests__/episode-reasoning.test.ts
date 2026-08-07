import { diffEpisodes, proposeNextAction, failedAssertionsOf, implicatedScriptsOf } from '../tools/episode-reasoning.js';

const failEp = {
  episodeId: 'ep_fail',
  verdict: 'fail',
  logs: { errorCount: 2, errors: [{ message: 'attempt to index nil ServerScriptService.Main' }, { message: 'boom' }] },
  assertions: { allPassed: false, results: [{ name: 'has_spawn', passed: true }, { name: 'door_opens', passed: false }] },
};
const passEp = {
  episodeId: 'ep_pass',
  verdict: 'pass',
  logs: { errorCount: 0, errors: [] },
  assertions: { allPassed: true, results: [{ name: 'has_spawn', passed: true }, { name: 'door_opens', passed: true }] },
};

describe('episode-reasoning extractors', () => {
  it('extracts failed assertions and implicated scripts', () => {
    expect(failedAssertionsOf(failEp)).toEqual(['door_opens']);
    expect(implicatedScriptsOf(failEp)).toContain('ServerScriptService.Main');
    expect(failedAssertionsOf(passEp)).toEqual([]);
  });
});

describe('diffEpisodes', () => {
  it('reports fail→pass as fixed with resolved errors and assertion transitions', () => {
    const d = diffEpisodes(failEp, passEp, 'ep_fail');
    expect(d.fixed).toBe(true);
    expect(d.regressed).toBe(false);
    expect(d.errorCountDelta).toBe(-2);
    expect(d.resolvedErrors).toContain('boom');
    expect(d.newErrors).toEqual([]);
    expect(d.assertionTransitions).toEqual([{ name: 'door_opens', was: false, now: true }]);
  });

  it('reports pass→fail as regressed with new errors', () => {
    const d = diffEpisodes(passEp, failEp, 'ep_pass');
    expect(d.regressed).toBe(true);
    expect(d.fixed).toBe(false);
    expect(d.errorCountDelta).toBe(2);
    expect(d.newErrors).toContain('boom');
  });
});

describe('proposeNextAction', () => {
  it('proposes running an episode when none exist', () => {
    const a = proposeNextAction(undefined);
    expect(a.action).toBe('run_episode');
    expect(a.tool).toBe('run_playtest_episode');
    expect(a.done).toBe(false);
  });

  it('targets the failing assertion first', () => {
    const a = proposeNextAction(failEp);
    expect(a.action).toBe('fix_assertion');
    expect(a.focus).toEqual(['door_opens']);
    expect(a.tool).toBeNull();
  });

  it('points at implicated scripts when errors but no failed assertion', () => {
    const errOnly = { episodeId: 'ep_e', verdict: 'fail', logs: { errorCount: 1, errors: [{ message: 'nil index ServerScriptService.Main' }] } };
    const a = proposeNextAction(errOnly);
    expect(a.action).toBe('fix_script');
    expect(a.focus).toContain('ServerScriptService.Main');
  });

  it('handles startup failure', () => {
    const a = proposeNextAction({ episodeId: 'ep_x', verdict: 'error' });
    expect(a.action).toBe('fix_startup');
  });

  // A live episode failed with 23 errors, every one an asset fetch. The hostname
  // inside the URL parsed as a dotted script name, so the agent was told to open
  // "assetdelivery.roblox.com" and fix it — a loop it could never leave.
  it('does not mistake a URL host for a script to open', () => {
    const contentOnly = {
      episodeId: 'ep_net',
      verdict: 'fail',
      logs: {
        errorCount: 3,
        errors: [
          { message: "MeshContentProvider failed to process https://assetdelivery.roblox.com/v1/asset/?id=7430071105 because 'could not fetch'" },
          { message: 'Failed to load animation with sanitized ID rbxassetid://913384386: Animation failed to load, assetId: https://assetdelivery.roblox.com/v1/asset?id=913384386&serverplaceid=0' },
          { message: 'Failed to load sound rbxassetid://10066921516: HttpError: DnsResolve' },
        ],
      },
    };
    expect(implicatedScriptsOf(contentOnly)).toEqual([]);

    const a = proposeNextAction(contentOnly);
    expect(a.focus).toEqual([]);
    expect(a.rationale).not.toMatch(/Open the implicated script/);
    expect(a.rationale).toMatch(/none name a script/);
  });

  it('still finds a real script path in a line that also carries a URL', () => {
    const mixed = {
      episodeId: 'ep_mixed',
      verdict: 'fail',
      logs: {
        errorCount: 1,
        errors: [{ message: 'ServerScriptService.Main:12: bad argument, see https://create.roblox.com/docs/reference' }],
      },
    };
    expect(implicatedScriptsOf(mixed)).toEqual(['ServerScriptService.Main']);
    expect(proposeNextAction(mixed).rationale).toMatch(/Open the implicated script/);
  });

  it('proposes proving the fix when a clean run follows a failing one', () => {
    const a = proposeNextAction(passEp, failEp);
    expect(a.action).toBe('prove_fix');
    expect(a.tool).toBe('summarize_episode');
    expect(a.args).toEqual({ episodeId: 'ep_pass', comparedToEpisodeId: 'ep_fail' });
  });

  it('declares done for a clean run with no prior failure', () => {
    const a = proposeNextAction(passEp);
    expect(a.action).toBe('done');
    expect(a.done).toBe(true);
  });
});
