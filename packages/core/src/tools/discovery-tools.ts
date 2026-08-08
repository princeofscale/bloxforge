// Discovery / meta tools, split out of the RobloxStudioTools monolith. These
// operate purely on the server's own tool catalog (no Studio round-trip):
// tool_catalog_search finds the right tool without loading every schema, and
// load_toolset reports/expands a domain's tools. The facade delegates to this.

import { buildCatalog, searchCatalog, expandToolsets, collapseToolsets, recommendToolsets, toolsetTokenCost, TOOL_DOMAINS, type CatalogEntry, type ToolDomain } from './tool-catalog.js';
import { TOOL_DEFINITIONS } from './definitions.js';
import type { ToolContent } from './runtime-support.js';

export class DiscoveryTools {
  private catalog: CatalogEntry[] | undefined;
  private cost: Record<string, number> | undefined;

  private getCatalog(): CatalogEntry[] {
    if (!this.catalog) this.catalog = buildCatalog(TOOL_DEFINITIONS);
    return this.catalog;
  }

  private getCost(): Record<string, number> {
    if (!this.cost) this.cost = toolsetTokenCost(TOOL_DEFINITIONS);
    return this.cost;
  }

  async loadToolset(body: { toolsets?: string[]; unload?: string[] }) {
    // Coercing a bad shape to [] answered "loaded nothing, your host probably
    // needs a schema refresh" for a request that never named a toolset —
    // `{"toolset":"scene"}` and `{"toolsets":"scene"}` both read as success.
    // The unknown-name path below already reports a miss; this reports the
    // shape, which is the other way to name nothing.
    // A present-but-malformed field is rejected rather than coerced to []. The
    // same coercion on `toolsets` is what made `{"toolsets":"scene"}` read as a
    // successful no-op; defaulting a bad `unload` the same way would report
    // success for a release that never happened, which is worse than an error
    // because the caller keeps paying for schemas it believes it dropped.
    if (body?.toolsets !== undefined && !Array.isArray(body.toolsets)) {
      throw new Error(`load_toolset requires "toolsets" as an array of domain names, e.g. {"toolsets":["scene","mutation"]}. Valid: ${TOOL_DOMAINS.join(', ')}.`);
    }
    if (body?.unload !== undefined && !Array.isArray(body.unload)) {
      throw new Error(`load_toolset requires "unload" as an array of domain names, e.g. {"unload":["runtime"]}. Valid: ${TOOL_DOMAINS.join(', ')}.`);
    }
    const selectors = body?.toolsets ?? [];
    const release = body?.unload ?? [];
    if (selectors.some((s) => typeof s !== 'string')) {
      throw new Error(`load_toolset requires "toolsets" to hold strings. Valid: ${TOOL_DOMAINS.join(', ')}.`);
    }
    if (release.some((s) => typeof s !== 'string')) {
      throw new Error(`load_toolset requires "unload" to hold strings. Valid: ${TOOL_DOMAINS.join(', ')}.`);
    }
    // `unload` alone is a legitimate call ("done with runtime, drop its
    // schemas"), so `toolsets` is only required when nothing is being released.
    if (selectors.length === 0 && release.length === 0) {
      throw new Error(`load_toolset requires at least one toolset name in "toolsets" or "unload". Valid: ${TOOL_DOMAINS.join(', ')}.`);
    }
    // expandToolsets ignores a selector it does not recognize, and `loaded` used
    // to echo the request back verbatim — so asking for "scripting" (the domain
    // is "scripts") reported success, returned core plus nothing, and left the
    // caller reading client_hint's schema-refresh story as the explanation for
    // the missing tool. Name the miss instead of blaming the host.
    const known = new Set(TOOL_DOMAINS as readonly string[]);
    const domainOf = (raw: unknown) => String(raw ?? '').split('.')[0].trim();
    const loaded = selectors.filter((s) => known.has(domainOf(s)));
    const unloaded = release.filter((s) => known.has(domainOf(s)));
    const unknownToolsets = [...selectors, ...release].filter((s) => !known.has(domainOf(s)));
    const names = Array.from(expandToolsets(this.getCatalog(), selectors)).sort();
    const releasedNames = Array.from(collapseToolsets(this.getCatalog(), release)).sort();
    const cost = this.getCost();
    const sum = (domains: string[]) =>
      domains.reduce((total, s) => total + (cost[domainOf(s)] ?? 0), 0);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          loaded,
          tools: names,
          count: names.length,
          ...(unloaded.length > 0 && {
            unloaded,
            unloadedTools: releasedNames,
            unloadedCount: releasedNames.length,
          }),
          // The recurring per-request cost of this change. The tool list is
          // re-sent on every request, so a domain loaded once is paid for on
          // every turn until it is released.
          approxTokens: {
            loaded: sum(loaded),
            ...(unloaded.length > 0 && { released: sum(unloaded) }),
          },
          ...(unknownToolsets.length > 0 && {
            unknownToolsets,
            validToolsets: TOOL_DOMAINS,
          }),
          // Reported: load_toolset answered with 70+ tools "loaded" while every
          // one of them stayed absent from the client's callable surface, and
          // nothing in the response said that could happen. The server expands
          // its advertised list and emits tools/list_changed; a host that does
          // not act on that notification leaves the tools uncallable, and the
          // server cannot do that step for it. The caveat lives in the tool
          // description, but a caller reads the response.
          //
          // A bad selector gets the bad-selector hint: pointing at a host
          // schema-refresh problem that is not happening costs a restart to
          // rule out, and the real cause is one word in the request.
          //
          // The cache caveat is appended to whichever hint applies rather than
          // living inside one of them: it is a property of the tool set having
          // changed at all, and it first shipped on the unload-only branch —
          // so a load-only call, a mixed call, and a partly-misspelled call
          // that still loaded something all got the advice that the one thing
          // they just did was free.
          client_hint: (unknownToolsets.length > 0
            ? `Not a toolset: ${unknownToolsets.join(', ')} — nothing was loaded for ${unknownToolsets.length > 1 ? 'those' : 'that'}. Re-call with a name from "validToolsets", or use tool_catalog_search to find the tool and the domain it lives in.`
            : loaded.length === 0 && unloaded.length > 0
              ? `Released ${unloaded.join(', ')} — those schemas are no longer advertised and stop costing tokens on later requests. Load the domain again if you need it.`
              : 'Advertised, not guaranteed callable: this expands the server\'s tool list and sends tools/list_changed. Some hosts need their own schema-refresh step, which the server cannot perform — if a listed tool is still not callable, restart the client or start with ROBLOX_MCP_LAZY_TOOLS=0.')
            + (loaded.length > 0 || unloaded.length > 0
              ? ' Changing the tool set invalidates the prompt cache for the whole conversation, so do this at a phase boundary, not between every few calls.'
              : ''),
        }),
      }] as ToolContent[],
    };
  }

  async toolCatalogSearch(body: { query: string; domains?: ToolDomain[]; readOnly?: boolean; limit?: number }) {
    // An absent query scored every tool equally and returned the first 8 — a
    // ranked-looking answer to a question nobody asked, which is worse than an
    // error because it reads as "these are your options".
    if (typeof body?.query !== 'string' || body.query.trim() === '') {
      throw new Error('tool_catalog_search requires a non-empty "query" describing the task, e.g. {"query":"read script source"}.');
    }
    const matches = searchCatalog(this.getCatalog(), {
      query: body.query,
      domains: body?.domains,
      readOnly: body?.readOnly,
      limit: body?.limit,
    });
    const recommendedToolsets = recommendToolsets(matches, this.getCost());
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          query: body.query,
          count: matches.length,
          matches,
          recommendedToolsets,
          client_hint: 'Lazy-loading is the default path. If a needed tool is not currently advertised, call load_toolset with the recommended domain(s); set ROBLOX_MCP_LAZY_TOOLS=0 only for full upfront schemas. approxTokens is what each domain adds to every later request — release one you are done with via load_toolset {"unload":["<domain>"]}, but do it at a phase boundary: changing the tool set invalidates the conversation\'s prompt cache.',
        }),
      }] as ToolContent[],
    };
  }
}
