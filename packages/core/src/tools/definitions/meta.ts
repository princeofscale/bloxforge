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
    name: 'get_request_status',
    category: 'read',
    description: 'Look up a bridge request after a timeout. Use the requestId from an outcome_unknown error before deciding whether a mutation is safe to retry.',
    inputSchema: {
      type: 'object',
      properties: {
        requestId: { type: 'string', description: 'Bridge request id from an outcome_unknown error.' },
      },
      required: ['requestId'],
    },
  },
  {
    name: 'get_transport_diagnostics',
    category: 'read',
    description: 'Return payload-free local transport metrics: queue depth, retries, BUSY/outcome_unknown/cancel/completion counts, server epoch, and latency p50/p95/p99.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'cancel_request',
    category: 'write',
    description: 'Cancel a queued bridge request before the plugin acknowledges execution. Returns false once execution has started; this never claims to stop an already-running mutation.',
    inputSchema: {
      type: 'object',
      properties: {
        requestId: { type: 'string', description: 'Bridge request id to cancel.' },
      },
      required: ['requestId'],
    },
  },
  {
    name: 'detect_roblox_project', category: 'read',
    description: 'Detect Rojo, Wally, Rokit, Selene, StyLua, and sourcemap files and report which optional quality tools are installed.',
    inputSchema: { type: 'object', properties: { root: { type: 'string', description: 'Project directory (defaults to the server working directory).' } } },
  },
  {
    name: 'validate_script_source', category: 'read',
    description: 'Run available luau-analyze, Selene, and StyLua checks on source without writing it to the Roblox DataModel. Missing binaries are reported explicitly.',
    inputSchema: { type: 'object', properties: { source: { type: 'string' }, fileName: { type: 'string' } }, required: ['source'] },
  },
  {
    name: 'format_script_preview', category: 'read',
    description: 'Return a StyLua formatting preview through stdin; user source is never formatted or written implicitly.',
    inputSchema: { type: 'object', properties: { source: { type: 'string' }, fileName: { type: 'string' } }, required: ['source'] },
  },
  {
    name: 'resolve_instance_source_file', category: 'read',
    description: 'Resolve an Instance path through a Rojo-style sourcemap.json when one is present.',
    inputSchema: { type: 'object', properties: { instancePath: { type: 'string' }, root: { type: 'string' } }, required: ['instancePath'] },
  },
  {
    name: 'run_project_tests', category: 'write',
    description: 'Run an explicitly selected Lune project test script; no test script is guessed.',
    inputSchema: { type: 'object', properties: { root: { type: 'string' }, script: { type: 'string' } }, required: ['script'] },
  },
  {
    name: 'get_dependency_graph', category: 'read',
    description: 'Read Wally manifest/lockfile metadata into a compact dependency list without installing packages.',
    inputSchema: { type: 'object', properties: { root: { type: 'string' } } },
  },
  {
    name: 'install_wally_packages', category: 'write',
    description: 'Run wally install in the detected project only after explicit confirm=true.',
    inputSchema: { type: 'object', properties: { root: { type: 'string' }, confirm: { type: 'boolean' } }, required: ['confirm'] },
  },
  {
    name: 'run_quality_gate', category: 'read',
    description: 'Run available Rojo sourcemap, Selene, StyLua, and luau-lsp project checks and return structured per-tool results.',
    inputSchema: { type: 'object', properties: { root: { type: 'string' } } },
  },
  {
    name: 'validate_with_luau_lsp', category: 'read',
    description: 'Run luau-lsp analyze against selected files, automatically using the detected Rojo sourcemap when present.',
    inputSchema: { type: 'object', properties: { root: { type: 'string' }, files: { type: 'array', items: { type: 'string' } } } },
  },
  {
    name: 'generate_rojo_sourcemap', category: 'write',
    description: 'Generate a Rojo sourcemap from the detected project file into an explicit output path.',
    inputSchema: { type: 'object', properties: { root: { type: 'string' }, output: { type: 'string' } } },
  },
  {
    name: 'build_rojo_project', category: 'write',
    description: 'Build the detected Rojo project to an explicit RBXL/RBXM output path.',
    inputSchema: { type: 'object', properties: { root: { type: 'string' }, output: { type: 'string' } }, required: ['output'] },
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
