import { SafetyManager, stripLuauStringsAndComments } from '../safety/safety-manager.js';

const scan = (code: string) =>
  new SafetyManager().assess({ kind: 'execute_luau', code }).requiresConfirmation;

describe('stripLuauStringsAndComments', () => {
  it('removes short strings, honouring escapes', () => {
    expect(stripLuauStringsAndComments('local a = "x:Destroy()y"')).toBe('local a = ');
    expect(stripLuauStringsAndComments("local a = 'x:Destroy()'")).toBe('local a = ');
    // The escaped quote must not end the string early and leak the tail.
    expect(stripLuauStringsAndComments('local a = "he said \\":Destroy()\\" ok"')).toBe('local a = ');
  });

  it('removes long strings and long comments at any bracket level', () => {
    expect(stripLuauStringsAndComments('local a = [[:Destroy()]]')).toBe('local a = ');
    expect(stripLuauStringsAndComments('local a = [==[ ]] :Destroy() ]==]')).toBe('local a = ');
    expect(stripLuauStringsAndComments('--[[ :Destroy() ]]\nkeep')).toBe('\nkeep');
  });

  it('removes line comments but keeps the newline', () => {
    expect(stripLuauStringsAndComments('a -- :Destroy()\nb')).toBe('a \nb');
  });

  it('keeps executable code untouched', () => {
    expect(stripLuauStringsAndComments('workspace.Part:Destroy()')).toContain(':Destroy()');
  });

  it('returns the source unchanged when a literal is unterminated', () => {
    // Fail toward over-reporting: a mis-scan must never hide a real call.
    for (const bad of ['x = ":Destroy()', 'x = [[:Destroy()', 'x = --[[:Destroy()']) {
      expect(stripLuauStringsAndComments(bad)).toBe(bad);
    }
  });
});

describe('destructive-pattern scanning', () => {
  it('no longer flags a destructive call that only appears inside a string', () => {
    // Reported against a Rojo-style source sync: the module text being written
    // contains :Destroy(), so every sync demanded confirmation for inert text.
    expect(scan('script.Source = "local function cleanup(m)\\n\\tm:Destroy()\\nend"')).toBe(false);
    expect(scan('s.Source = [[ game.Workspace:ClearAllChildren() ]]')).toBe(false);
  });

  it('still flags the real thing', () => {
    for (const code of [
      'workspace.Part:Destroy()',
      'game.Workspace:ClearAllChildren()',
      'local s = "a note" workspace.Part:Destroy()',
      'game:GetService("DataStoreService"):GetDataStore("x"):SetAsync("k", 1)',
    ]) {
      expect(scan(code)).toBe(true);
    }
  });

  it('still gates DataStore writes now that the service-name pattern is gone', () => {
    // The old rule matched game:GetService("DataStoreService") — i.e. only its
    // string argument — so it could not survive the strip. Dropping it is only
    // safe while the writes stay gated on their own, so assert that here.
    expect(scan('store:SetAsync("key", 1)')).toBe(true);
    expect(scan('store:RemoveAsync("key")')).toBe(true);
    // Merely taking a handle to the service mutates nothing and is not gated.
    expect(scan('local ds = game:GetService("DataStoreService")')).toBe(false);
  });
});
