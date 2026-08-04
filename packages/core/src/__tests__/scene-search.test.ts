import { buildSceneSearchLuau, sceneSearchTerms } from '../builders/scene-search.js';

describe('buildSceneSearchLuau', () => {
  it('tokenizes the query and scores multiple signals (name/tags/attrs/parent/class)', () => {
    const code = buildSceneSearchLuau('shop ui', 'game');
    expect(code).toContain('resolvePath("game")');
    // Tokenizing moved server-side so single-character noise can be dropped
    // before it outranks real hits; the terms arrive as literals.
    expect(code).toContain('local terms = { "shop", "ui" }');
    expect(code).toContain('countHits(name, term, 5)');
    expect(code).toContain('countHits(tagStr, term, 4)');
    expect(code).toContain('countHits(attrStr, term, 3)');
    expect(code).toContain('d:GetTags()');
    expect(code).toContain('d:GetAttributes()');
  });

  it('lowercases the query and clamps the limit', () => {
    expect(buildSceneSearchLuau('DoorSystem', 'game', 3)).toContain('"doorsystem"');
    expect(buildSceneSearchLuau('x', 'game', 3)).toContain('math.min(3, #scored)');
    expect(buildSceneSearchLuau('x', 'game', 999)).toContain('math.min(50, #scored)');
  });

  it('ranks by score and returns a bounded result set', () => {
    const code = buildSceneSearchLuau('tree');
    expect(code).toContain('table.sort(scored, function(a, b) return a.score > b.score end)');
    expect(code).toContain('results = top');
  });

  it('escapes a hostile query and path', () => {
    const code = buildSceneSearchLuau('a"]; os.exit() --', 'game.Workspace["X"]');
    expect(code).not.toContain('os.exit() --,');
    expect(code).toContain('\\"');
  });
});

describe('sceneSearchTerms', () => {
  // "BF_M" split into ["bf","m"], and the one-character "m" pulled in Camera
  // alongside the parts actually wanted — reproduced live.
  it('drops single-character tokens when a longer one survives', () => {
    expect(sceneSearchTerms('BF_M')).toEqual(['bf']);
    expect(sceneSearchTerms('a door system')).toEqual(['door', 'system']);
    expect(sceneSearchTerms('Shop UI v2')).toEqual(['shop', 'ui', 'v2']);
  });

  it('keeps a deliberate single-character search', () => {
    expect(sceneSearchTerms('X')).toEqual(['x']);
    expect(sceneSearchTerms('a b')).toEqual(['a', 'b']);
  });

  it('lowercases, splits on punctuation, and de-duplicates', () => {
    expect(sceneSearchTerms('Door_door.DOOR')).toEqual(['door']);
    expect(sceneSearchTerms('')).toEqual([]);
  });

  it('embeds the terms as escaped literals rather than tokenizing in Luau', () => {
    const code = buildSceneSearchLuau('Shop UI');
    expect(code).toContain('local terms = { "shop", "ui" }');
    expect(code).not.toContain('string.gmatch(query, "[%w]+")');
  });
});
