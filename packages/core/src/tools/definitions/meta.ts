import type { ToolDefinition } from '../definitions.js';

// Meta / discovery tools. These operate on the server's own tool catalog, not on
// a Studio place, so they are Studio-agnostic. tool_catalog_search lets an agent
// find the right tool for a task without paying for every tool's full schema.
export const META_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'get_roblox_docs',
    category: 'read',
    description: 'Fetch official Roblox engine API documentation as markdown from create.roblox.com. Call this before writing or editing code that uses an engine class, enum, datatype, or Luau library you are not fully certain about (for example ProximityPrompt, Enum.KeyCode, CFrame, TweenService). Results are cached; very large pages are truncated with a section index, and the section parameter reads one section in full.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Exact PascalCase name of the class, enum, datatype, or library, e.g. "ProximityPrompt", "KeyCode", "CFrame", "table".',
        },
        doc_type: {
          type: 'string',
          enum: ['classes', 'enums', 'datatypes', 'libraries', 'globals'],
          description: 'Documentation category. Defaults to classes.',
        },
        section: {
          type: 'string',
          description: 'Optional ##-level section to return instead of the whole page, e.g. "Description", "Properties", "Methods", "Events", "Code Samples".',
        },
      },
      required: ['name'],
    },
  },
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
    name: 'get_session_summary',
    category: 'read',
    description: 'Summarize this MCP server session without exposing tool payloads: total tool calls, failures, average duration, per-tool counts, and recent tool names/outcomes. Use when the bridge feels flaky or after a dogfood run to identify timeouts/errors.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'load_toolset',
    category: 'read',
    description: 'Load one or more tool domains. This expands the advertised MCP tool list and sends tools/list_changed. Some hosts still require their own schema-selection step after receiving that notification; that client-side step cannot be completed by the server. Use --profile core|builder|tester|full to preload common domain groups, or ROBLOX_MCP_LAZY_TOOLS=0|false|off for every schema upfront.',
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
