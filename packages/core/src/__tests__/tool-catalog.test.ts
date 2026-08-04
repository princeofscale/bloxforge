import {
  classifyDomain,
  buildCatalog,
  searchCatalog,
  expandToolsets,
  recommendToolsets,
  CORE_TOOLS,
  TOOL_DOMAINS,
  type ToolDomain,
} from '../tools/tool-catalog.js';
import { TOOL_DEFINITIONS } from '../tools/definitions.js';
import { RobloxStudioTools } from '../tools/index.js';
import { BridgeService } from '../bridge-service.js';

describe('classifyDomain', () => {
  const cases: Array<[string, ToolDomain]> = [
    ['get_connected_instances', 'core'],
    ['execute_luau', 'core'],
    ['ui_create_frame', 'ui'],
    ['environment_set_sky', 'environment'],
    ['terrain_generate_island', 'terrain'],
    ['template_create_obby_game', 'build'],
    ['sync_push', 'sync'],
    ['audio_play_sound', 'media'],
    ['animation_create', 'media'],
    ['asset_apply_texture', 'media'],
    ['marketplace_search', 'assets'],
    ['image_generate', 'assets'],
    ['get_asset_details', 'assets'],
    ['get_script_source', 'scripts'],
    ['diagnose_scripts', 'scripts'],
    ['start_playtest', 'runtime'],
    ['multiplayer_test_start', 'runtime'],
    ['breakpoints', 'runtime'],
    ['set_property', 'mutation'],
    ['create_object', 'mutation'],
    ['add_tag', 'mutation'],
    ['restore_script_backup', 'safety'],
    ['undo', 'safety'],
    ['get_instance_children', 'scene'],
    ['get_scene_analysis', 'scene'],
  ];
  it.each(cases)('classifies %s as %s', (name, domain) => {
    expect(classifyDomain(name)).toBe(domain);
  });

  it('assigns every real tool to a known domain (no orphans)', () => {
    for (const def of TOOL_DEFINITIONS) {
      const domain = classifyDomain(def.name);
      expect(TOOL_DOMAINS).toContain(domain);
    }
  });
});

describe('buildCatalog', () => {
  const catalog = buildCatalog(TOOL_DEFINITIONS);

  it('produces one compact entry per tool', () => {
    expect(catalog.length).toBe(TOOL_DEFINITIONS.length);
    const entry = catalog.find((e) => e.name === 'get_instance_children')!;
    expect(entry.mode).toBe('read');
    expect(entry.domain).toBe('scene');
    expect(typeof entry.whenToUse).toBe('string');
    expect(entry.whenToUse.length).toBeGreaterThan(0);
  });

  it('marks write tools as write', () => {
    expect(catalog.find((e) => e.name === 'create_object')!.mode).toBe('write');
  });

  it('marks legacy overlap tools with replacement metadata instead of removing them', () => {
    expect(catalog.find((e) => e.name === 'get_descendants')).toMatchObject({
      deprecated: true,
      replacement: 'get_world_snapshot + scene_search/get_node_batch',
    });
  });

  it('keeps whenToUse to a single short sentence', () => {
    for (const e of catalog) {
      expect(e.whenToUse).not.toContain('. '); // first sentence only
      expect(e.whenToUse.length).toBeLessThanOrEqual(121);
    }
  });
});

describe('searchCatalog', () => {
  const catalog = buildCatalog(TOOL_DEFINITIONS);

  it('finds marketplace tools for an asset query', () => {
    const hits = searchCatalog(catalog, { query: 'marketplace', limit: 5 });
    expect(hits.some((h) => h.name === 'marketplace_search')).toBe(true);
  });

  it('respects the readOnly filter', () => {
    const hits = searchCatalog(catalog, { query: 'script', readOnly: true });
    expect(hits.every((h) => h.mode === 'read')).toBe(true);
  });

  it('biases to requested domains', () => {
    const hits = searchCatalog(catalog, { query: 'create', domains: ['ui'] });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.domain === 'ui')).toBe(true);
  });

  it('caps the result count', () => {
    const hits = searchCatalog(catalog, { query: 'get', limit: 3 });
    expect(hits.length).toBeLessThanOrEqual(3);
  });

  // tool_catalog_search is the entry point an agent uses before it has loaded
  // any schemas, so a plain-English task has to reach the obvious tool. It did
  // not: a name hit was a substring test, so "a" scored on "cre[a]te_build" and
  // "an" on "m[an]age_instance", and filler outweighed the real word —
  // "create a part and set its color" returned environment_set_atmosphere,
  // animation_create and asset_source_search, with no mutation tool at all.
  it.each([
    ['create a part', 'create_object'],
    ['set the color of a part', 'set_property'],
    ['delete an instance', 'delete_object'],
    ['read a script source', 'get_script_source'],
    ['play a sound', 'audio_play_sound'],
  ])('ranks %s first for "%s"', (query, expected) => {
    expect(searchCatalog(catalog, { query, limit: 5 })[0]?.name).toBe(expected);
  });

  it('recommends the mutation toolset for a build-a-part task', () => {
    const hits = searchCatalog(catalog, { query: 'create a part and set its color', limit: 8 });
    expect(hits.map((h) => h.name)).toEqual(expect.arrayContaining(['create_object', 'set_property']));
  });

  it('ignores filler words entirely', () => {
    expect(searchCatalog(catalog, { query: 'a an the of to' })).toEqual([]);
  });
});

describe('expandToolsets', () => {
  const catalog = buildCatalog(TOOL_DEFINITIONS);

  it('always includes the core tools', () => {
    const set = expandToolsets(catalog, []);
    for (const c of CORE_TOOLS) expect(set.has(c)).toBe(true);
  });

  it('pulls in a whole domain by selector (and the domain.suffix shorthand)', () => {
    const set = expandToolsets(catalog, ['ui.build']);
    expect(set.has('ui_create_frame')).toBe(true);
    expect(set.has('ui_make_mobile_friendly')).toBe(true);
  });

  it('ignores unknown selectors', () => {
    const set = expandToolsets(catalog, ['nonsense']);
    expect(set.size).toBe(CORE_TOOLS.size);
  });
});

describe('recommendToolsets', () => {
  const catalog = buildCatalog(TOOL_DEFINITIONS);

  it('groups matches into a machine-readable load recommendation, skipping core', () => {
    const matches = searchCatalog(catalog, { query: 'create frame', domains: ['ui'] });
    const recs = recommendToolsets(matches);
    expect(recs.length).toBeGreaterThan(0);
    expect(recs[0].domain).toBe('ui');
    expect(recs[0].load).toEqual({ tool: 'load_toolset', args: { toolsets: ['ui'] } });
    expect(recs[0].recommendedTools).toContain('ui_create_frame');
    expect(recs.every((r) => r.domain !== 'core')).toBe(true);
  });

  it('orders domains by how many tools matched', () => {
    const matches = searchCatalog(catalog, { query: 'get', limit: 20 });
    const recs = recommendToolsets(matches);
    for (let i = 1; i < recs.length; i++) {
      expect(recs[i - 1].recommendedTools.length).toBeGreaterThanOrEqual(recs[i].recommendedTools.length);
    }
  });
});

describe('RobloxStudioTools.loadToolset', () => {
  const tools = new RobloxStudioTools(new BridgeService());

  it('reports core + the requested domain tools', async () => {
    const res = await tools.loadToolset({ toolsets: ['ui'] });
    const first = res.content[0] as { type: 'text'; text: string };
    const payload = JSON.parse(first.text) as { tools: string[]; count: number; loaded: string[] };
    expect(payload.loaded).toEqual(['ui']);
    expect(payload.tools).toContain('ui_create_frame');
    expect(payload.tools).toContain('tool_catalog_search'); // core always present
    expect(payload.count).toBe(payload.tools.length);
  });

  it('names a selector that is not a domain instead of echoing it as loaded', async () => {
    // Live: asked for "scripting" (the domain is "scripts"), got loaded:
    // ["scripting"] and no script tools — and client_hint's schema-refresh story
    // read as the explanation, so the wrong thing got debugged.
    const res = await tools.loadToolset({ toolsets: ['scene', 'scripting'] });
    const payload = JSON.parse((res.content[0] as { text: string }).text) as {
      loaded: string[]; unknownToolsets: string[]; validToolsets: string[]; client_hint: string;
    };
    expect(payload.loaded).toEqual(['scene']);
    expect(payload.unknownToolsets).toEqual(['scripting']);
    expect(payload.validToolsets).toContain('scripts');
    expect(payload.client_hint).toContain('Not a toolset: scripting');
  });

  it('says nothing about unknown toolsets when every selector resolved', async () => {
    const res = await tools.loadToolset({ toolsets: ['scripts'] });
    const payload = JSON.parse((res.content[0] as { text: string }).text) as Record<string, unknown>;
    expect(payload.unknownToolsets).toBeUndefined();
    expect(payload.client_hint).toContain('Advertised, not guaranteed callable');
    expect(payload.tools).toContain('get_script_source');
  });
});

describe('core tool set and toolchain domains', () => {
  test('routes rokit and wally tools into the sync domain, not the scene default', () => {
    // Without prefix rules these fell through to `scene`, so loading the `sync`
    // toolset produced the Rojo tools without the toolchain tools they need.
    for (const name of ['rokit_install', 'wally_install_apply', 'rojo_serve_start']) {
      expect(classifyDomain(name)).toBe('sync');
    }
  });

  test('keeps mutating toolchain tools out of the always-on core set', () => {
    // `install_wally_packages` ran a bare `wally install` with no lock policy and
    // was the first thing an agent saw. Only read-only checks stay in core.
    for (const name of ['install_wally_packages', 'generate_rojo_sourcemap', 'build_rojo_project']) {
      expect(CORE_TOOLS.has(name)).toBe(false);
    }
    for (const name of ['rokit_status', 'wally_validate_lock', 'rojo_detect_projects']) {
      expect(CORE_TOOLS.has(name)).toBe(true);
      expect(classifyDomain(name)).toBe('core');
    }
  });
});
