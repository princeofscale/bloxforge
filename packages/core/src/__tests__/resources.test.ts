import { parseResourceUri, RESOURCE_LIST, RESOURCE_TEMPLATES } from '../resources.js';

describe('parseResourceUri', () => {
  it('parses the world snapshot URI with a view', () => {
    expect(parseResourceUri('roblox://world/snapshot?view=standard')).toEqual({ kind: 'snapshot', view: 'standard' });
    expect(parseResourceUri('roblox://world/snapshot')).toEqual({ kind: 'snapshot', view: 'overview' });
  });

  it('parses the changefeed URI with/without since', () => {
    expect(parseResourceUri('roblox://world/changes?since=snap_42')).toEqual({ kind: 'changes', since: 'snap_42' });
    expect(parseResourceUri('roblox://world/changes')).toEqual({ kind: 'changes', since: undefined });
  });

  it('parses a node URI and decodes the dot-path', () => {
    expect(parseResourceUri('roblox://node/game.Workspace.Map')).toEqual({ kind: 'node', path: 'game.Workspace.Map' });
    expect(parseResourceUri('roblox://node/game.Workspace.My%20Model')).toEqual({ kind: 'node', path: 'game.Workspace.My Model' });
  });

  it('returns unknown for foreign or malformed URIs', () => {
    expect(parseResourceUri('https://example.com').kind).toBe('unknown');
    expect(parseResourceUri('roblox://nope/thing').kind).toBe('unknown');
    expect(parseResourceUri('not a uri').kind).toBe('unknown');
  });
});

describe('resource catalog', () => {
  it('lists concrete resources and parameterized templates', () => {
    expect(RESOURCE_LIST.every((r) => r.uri.startsWith('roblox://') && r.mimeType === 'application/json')).toBe(true);
    expect(RESOURCE_TEMPLATES.some((t) => t.uriTemplate.includes('{path}'))).toBe(true);
  });
});
