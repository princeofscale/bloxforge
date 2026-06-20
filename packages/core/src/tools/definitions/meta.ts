import type { ToolDefinition } from '../definitions.js';

// Meta / discovery tools. These operate on the server's own tool catalog, not on
// a Studio place, so they are Studio-agnostic. tool_catalog_search lets an agent
// find the right tool for a task without paying for every tool's full schema.
export const META_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'tool_catalog_search',
    category: 'read',
    description:
      'Find the right tool for a task without loading every tool schema. Returns a compact, ranked list of matching tools (name, domain, read/write, when to use, required args). Use this first when you are unsure which tool to call, then call the tool it points to.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Task or capability you need, e.g. "play a sound", "find a tree model", "read script source".',
        },
        domains: {
          type: 'array',
          items: {
            type: 'string',
            enum: [
              'core', 'scene', 'mutation', 'scripts', 'runtime',
              'assets', 'ui', 'environment', 'terrain', 'build', 'media', 'sync', 'safety',
            ],
          },
          description: 'Optional: restrict results to these domains.',
        },
        readOnly: { type: 'boolean', description: 'Optional: only return read tools.' },
        limit: { type: 'integer', minimum: 1, maximum: 20, description: 'Max results (default 8).' },
      },
      required: ['query'],
    },
  },
  {
    name: 'load_toolset',
    category: 'read',
    description: 'Load one or more tool domains so their tools become available. Use after tool_catalog_search points you at a domain you do not have loaded yet. Pass domain names like "scene", "ui", "assets". When lazy tool loading is enabled (ROBLOX_MCP_LAZY_TOOLS), this expands the advertised tool list and notifies the client; otherwise it just reports which tools the domains contain. Core tools are always available.',
    inputSchema: {
      type: 'object',
      properties: {
        toolsets: {
          type: 'array',
          items: {
            type: 'string',
            enum: [
              'core', 'scene', 'mutation', 'scripts', 'runtime',
              'assets', 'ui', 'environment', 'terrain', 'build', 'media', 'sync', 'safety',
            ],
          },
          description: 'Domains to load (e.g. ["ui","assets"]). Accepts "domain.suffix" shorthand too.',
        },
      },
      required: ['toolsets'],
    },
  },
];
