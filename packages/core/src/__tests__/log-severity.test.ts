import { logSeverity, parseLogErrors, isEngineNoise } from '../diagnostics.js';
import { implicatedScriptsOf } from '../tools/episode-reasoning.js';

describe('logSeverity', () => {
  // The plugin's RuntimeLogBuffer tags entries with these four and sends no
  // messageType. Both readers were matching Enum.MessageType names instead.
  it('understands the plugin level tags', () => {
    expect(logSeverity({ level: 'ERR' })).toBe('error');
    expect(logSeverity({ level: 'WARN' })).toBe('warning');
    expect(logSeverity({ level: 'INFO' })).toBe('other');
    expect(logSeverity({ level: 'OUT' })).toBe('other');
  });

  it('still understands Enum.MessageType names', () => {
    expect(logSeverity({ messageType: 'MessageError' })).toBe('error');
    expect(logSeverity({ messageType: 'MessageWarning' })).toBe('warning');
    expect(logSeverity({ messageType: 'MessageOutput' })).toBe('other');
    expect(logSeverity({ messageType: 'MessageInfo' })).toBe('other');
  });

  it('treats a missing level as unclassified rather than an error', () => {
    expect(logSeverity({})).toBe('other');
    expect(logSeverity({ level: undefined })).toBe('other');
  });
});

describe('parseLogErrors', () => {
  it('reads entries that carry only a level (what the plugin actually sends)', () => {
    // Verified live before this fix: a buffer holding seven WARN entries, every
    // messageType undefined, produced "No errors or warnings ... Looks clean."
    const result = parseLogErrors([
      { message: 'ServerScriptService.Main:12: attempt to index nil', level: 'ERR' },
      { message: 'The Parent property of VideoService is locked', level: 'WARN' },
      { message: 'DataModel Loading', level: 'INFO' },
    ] as never);
    expect(result.errors).toHaveLength(1);
    expect(result.warnings).toHaveLength(1);
    expect(result.errors[0].scriptPath).toBe('ServerScriptService.Main');
    expect(result.errors[0].line).toBe(12);
  });

  it('still reads entries that carry messageType', () => {
    const result = parseLogErrors([
      { message: 'boom', messageType: 'MessageError' },
      { message: 'careful', messageType: 'MessageWarning' },
    ]);
    expect(result.errors).toHaveLength(1);
    expect(result.warnings).toHaveLength(1);
  });

  it('skips entries with no usable message', () => {
    expect(parseLogErrors([{ level: 'ERR' } as never]).errors).toHaveLength(0);
  });
});

describe('isEngineNoise', () => {
  // Reported for multiplayer QA on an unpublished place (PlaceId = 0). Before log
  // severity was fixed no error counted at all, so this could not reach a verdict;
  // now it can, which is what makes the split necessary rather than cosmetic.
  it('recognises Roblox CoreScript origins', () => {
    expect(isEngineNoise(
      'Invalid value for enum CreatorType: 0 - Studio - PlayerPermissionsModule:9 - '
      + 'CoreGui.RobloxGui.Modules.PlayerPermissionsModule',
    )).toBe(true);
    expect(isEngineNoise('CorePackages.Packages.Roact: something failed')).toBe(true);
    expect(isEngineNoise('RobloxReplicatedStorage.Foo: bad')).toBe(true);
  });

  it('never mistakes a place script for engine noise', () => {
    for (const m of [
      'ServerScriptService.Main:12: attempt to index nil with Value',
      'Players.Player1.PlayerScripts.Controller:4: bad argument',
      // A game script whose *name* merely mentions the word.
      'ReplicatedStorage.CoreGuiHelper:3: oops',
      'StarterGui.MyGui.Frame.Script:1: nope',
    ]) {
      expect(isEngineNoise(m)).toBe(false);
    }
    expect(isEngineNoise(undefined)).toBe(false);
  });

  it('keeps engine noise out of the scripts an agent is told to fix', () => {
    const ep = {
      logs: {
        errors: [
          { message: 'CoreGui.RobloxGui.Modules.PlayerPermissionsModule: Invalid value for enum CreatorType' },
          { message: 'ServerScriptService.Round:7: attempt to call a nil value' },
        ],
      },
    };
    expect(implicatedScriptsOf(ep)).toEqual(['ServerScriptService.Round']);
  });
});
