import { DiscoveryTools } from '../tools/discovery-tools.js';

// Both of these tools coerced a bad request into a plausible-looking success:
// load_toolset answered "loaded nothing, your host probably needs a schema
// refresh" for a call that never named a toolset, and tool_catalog_search
// ranked the whole catalog against an empty string and returned the first 8 as
// if they were matches. Silent success on a malformed call is the expensive
// failure — the caller reads a confident answer and acts on it.

const parse = (result: { content: Array<{ type: string }> }) =>
  JSON.parse((result.content[0] as { text?: string })?.text ?? '{}');

describe('loadToolset input validation', () => {
  const tools = new DiscoveryTools();

  it.each([
    ['no arguments', {}],
    ['toolsets as a string instead of an array', { toolsets: 'scene' } as unknown as { toolsets?: string[] }],
    ['an empty array', { toolsets: [] }],
    ['non-string entries', { toolsets: [{ name: 'scene' }] } as unknown as { toolsets?: string[] }],
  ])('rejects %s', async (_label, body) => {
    await expect(tools.loadToolset(body as { toolsets?: string[] })).rejects.toThrow(/load_toolset requires/);
  });

  it('names the valid domains in the rejection so the caller can retry', async () => {
    await expect(tools.loadToolset({})).rejects.toThrow(/scene/);
  });

  it('still loads a well-formed request', async () => {
    const body = parse(await tools.loadToolset({ toolsets: ['scene'] }));
    expect(body.loaded).toEqual(['scene']);
    expect(body.count).toBeGreaterThan(0);
  });

  it('reports an unknown domain rather than throwing', async () => {
    const body = parse(await tools.loadToolset({ toolsets: ['scripting'] }));
    expect(body.unknownToolsets).toEqual(['scripting']);
    expect(body.loaded).toEqual([]);
  });
});

// The prompt-cache caveat first shipped on the unload-only branch, so a
// load-only call — the common one — was told nothing about the cost it had just
// paid. It is a property of the tool set having changed, not of which direction
// it changed in.
describe('loadToolset warns about prompt-cache invalidation whenever the set changes', () => {
  const tools = new DiscoveryTools();
  const CAVEAT = /invalidates the prompt cache/;

  it.each([
    ['load only', { toolsets: ['scene'] }],
    ['unload only', { unload: ['scene'] }],
    ['load and unload together', { toolsets: ['ui'], unload: ['scene'] }],
    ['a partly misspelled call that still loaded something', { toolsets: ['ui', 'scripting'] }],
  ])('%s', async (_label, body) => {
    expect(parse(await tools.loadToolset(body)).client_hint).toMatch(CAVEAT);
  });

  it('stays silent when nothing was actually loaded or released', async () => {
    const body = parse(await tools.loadToolset({ toolsets: ['scripting'] }));
    expect(body.client_hint).not.toMatch(CAVEAT);
    expect(body.client_hint).toMatch(/Not a toolset/);
  });
});

describe('toolCatalogSearch input validation', () => {
  const tools = new DiscoveryTools();

  it.each([
    ['no query', {}],
    ['an empty query', { query: '' }],
    ['a whitespace-only query', { query: '   ' }],
    ['a non-string query', { query: 7 } as unknown as { query: string }],
  ])('rejects %s', async (_label, body) => {
    await expect(tools.toolCatalogSearch(body as { query: string })).rejects.toThrow(/requires a non-empty "query"/);
  });

  it('still searches a well-formed request', async () => {
    const body = parse(await tools.toolCatalogSearch({ query: 'read script source' }));
    expect(body.query).toBe('read script source');
    expect(body.count).toBeGreaterThan(0);
  });
});

// A tool name derived from a ClassName: 'TextLabel'.toLowerCase() produced
// "ui_create_textlabel", so the only message pointing an agent at its mistake
// named a tool that does not exist.
describe('ui builder argument errors name the real tool', () => {
  const toolName = (className: string) =>
    `ui_create_${className.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase()}`;

  it.each([
    ['Frame', 'ui_create_frame'],
    ['TextLabel', 'ui_create_text_label'],
    ['TextButton', 'ui_create_text_button'],
    ['ImageLabel', 'ui_create_image_label'],
    ['ImageButton', 'ui_create_image_button'],
  ])('%s maps to %s', (className, expected) => {
    expect(toolName(className)).toBe(expected);
  });
});
