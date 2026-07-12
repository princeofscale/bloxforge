// Discovery / meta tools, split out of the RobloxStudioTools monolith. These
// operate purely on the server's own tool catalog (no Studio round-trip):
// tool_catalog_search finds the right tool without loading every schema, and
// load_toolset reports/expands a domain's tools. The facade delegates to this.

import { buildCatalog, searchCatalog, expandToolsets, recommendToolsets, type CatalogEntry, type ToolDomain } from './tool-catalog.js';
import { TOOL_DEFINITIONS } from './definitions.js';
import type { ToolContent } from './runtime-support.js';

export class DiscoveryTools {
  private catalog: CatalogEntry[] | undefined;

  private getCatalog(): CatalogEntry[] {
    if (!this.catalog) this.catalog = buildCatalog(TOOL_DEFINITIONS);
    return this.catalog;
  }

  async loadToolset(body: { toolsets?: string[] }) {
    const selectors = Array.isArray(body?.toolsets) ? body.toolsets : [];
    const names = Array.from(expandToolsets(this.getCatalog(), selectors)).sort();
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ loaded: selectors, tools: names, count: names.length }),
      }] as ToolContent[],
    };
  }

  async toolCatalogSearch(body: { query: string; domains?: ToolDomain[]; readOnly?: boolean; limit?: number }) {
    const matches = searchCatalog(this.getCatalog(), {
      query: body?.query ?? '',
      domains: body?.domains,
      readOnly: body?.readOnly,
      limit: body?.limit,
    });
    const recommendedToolsets = recommendToolsets(matches);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          query: body?.query ?? '',
          count: matches.length,
          matches,
          recommendedToolsets,
          client_hint: 'Lazy-loading is the default path. If a needed tool is not currently advertised, call load_toolset with the recommended domain(s); set ROBLOX_MCP_LAZY_TOOLS=0 only for full upfront schemas.',
        }),
      }] as ToolContent[],
    };
  }
}
