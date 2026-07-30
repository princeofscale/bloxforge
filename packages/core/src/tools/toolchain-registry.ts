import { defineTool, type RegisteredTool, type ToolRegistry } from './tool-pipeline.js';
import type { ToolDefinition } from './definitions.js';
import type { RobloxStudioTools } from './index.js';

const OUTPUT = { type: 'object', additionalProperties: true };
const ROOT = { root: { type: 'string', description: 'Search root inside BLOXFORGE_PROJECT_ROOT; the nearest manifest at or above it is used.' } };
const CONFIRM = { confirm: { type: 'boolean', description: 'Required to execute; downloads from the network and writes local files.' } };

// Reads never mutate a manifest. Everything that installs, adds or updates needs
// an explicit confirm=true and declares its network/filesystem/process effects.
const MUTATION_EFFECTS = ['network.external', 'local.files.read', 'local.files.write', 'local.process.execute'] as const;

const ROKIT_TOOLS: RegisteredTool[] = [
  defineTool({
    name: 'rokit_detect',
    description: 'Locate the nearest rokit.toml (or legacy aftman.toml) above the given root without modifying or migrating it.',
    category: 'read',
    effects: ['local.files.read', 'local.process.execute'],
    inputSchema: { type: 'object', properties: ROOT },
    outputSchema: OUTPUT,
    handler: (runtime, args) => asTools(runtime).rokitDetect(args.root as string | undefined),
  }),
  defineTool({
    name: 'rokit_get_manifest',
    description: 'Read the toolchain manifest with a real TOML parser and return each tool as owner, repo, and pinned version.',
    category: 'read',
    effects: ['local.files.read'],
    inputSchema: { type: 'object', properties: ROOT },
    outputSchema: OUTPUT,
    handler: (runtime, args) => asTools(runtime).rokitGetManifest(args.root as string | undefined),
  }),
  defineTool({
    name: 'rokit_list_tools',
    description: 'Run the toolchain CLI\'s own list command for the canonical project root.',
    category: 'read',
    effects: ['local.files.read', 'local.process.execute'],
    inputSchema: { type: 'object', properties: ROOT },
    outputSchema: OUTPUT,
    handler: (runtime, args) => asTools(runtime).rokitListTools(args.root as string | undefined),
  }),
  defineTool({
    name: 'rokit_status',
    description: 'Compare each tool\'s manifest version, installed shim, and the version the shim actually runs, and report whether an install is required.',
    category: 'read',
    effects: ['local.files.read', 'local.process.execute'],
    inputSchema: { type: 'object', properties: ROOT },
    outputSchema: OUTPUT,
    handler: (runtime, args) => asTools(runtime).rokitStatus(args.root as string | undefined),
  }),
  defineTool({
    name: 'rokit_install',
    description: 'Install every tool pinned by the manifest after confirm=true; downloads binaries and writes shims.',
    category: 'write',
    effects: [...MUTATION_EFFECTS],
    inputSchema: { type: 'object', properties: { ...ROOT, ...CONFIRM } },
    outputSchema: OUTPUT,
    handler: (runtime, args) => asTools(runtime).rokitInstall(args.root as string | undefined, args.confirm as boolean | undefined),
  }),
  defineTool({
    name: 'rokit_add_tool_plan',
    description: 'Preview adding a tool spec (owner/repo[@version]) without touching the manifest.',
    category: 'read',
    effects: ['local.files.read'],
    inputSchema: {
      type: 'object',
      properties: { ...ROOT, spec: { type: 'string', description: 'owner/repo or owner/repo@version.' } },
      required: ['spec'],
    },
    outputSchema: OUTPUT,
    handler: (runtime, args) => asTools(runtime).rokitAddTool(args.root as string | undefined, args.spec as string, false),
  }),
  defineTool({
    name: 'rokit_add_tool_apply',
    description: 'Run the toolchain\'s own add command after confirm=true so the version is resolved and written by the toolchain, never hardcoded.',
    category: 'write',
    effects: [...MUTATION_EFFECTS],
    inputSchema: {
      type: 'object',
      properties: { ...ROOT, spec: { type: 'string' }, ...CONFIRM },
      required: ['spec', 'confirm'],
    },
    outputSchema: OUTPUT,
    handler: (runtime, args) => asTools(runtime).rokitAddTool(
      args.root as string | undefined,
      args.spec as string,
      args.confirm as boolean | undefined,
    ),
  }),
  defineTool({
    name: 'rokit_update_plan',
    description: 'Preview updating one tool or every tool without touching the manifest.',
    category: 'read',
    effects: ['local.files.read'],
    inputSchema: { type: 'object', properties: { ...ROOT, tool: { type: 'string' } } },
    outputSchema: OUTPUT,
    handler: (runtime, args) => asTools(runtime).rokitUpdate(args.root as string | undefined, args.tool as string | undefined, false),
  }),
  defineTool({
    name: 'rokit_update_apply',
    description: 'Update one tool or every tool after confirm=true; rewrites the manifest and downloads new versions.',
    category: 'write',
    effects: [...MUTATION_EFFECTS],
    inputSchema: {
      type: 'object',
      properties: { ...ROOT, tool: { type: 'string' }, ...CONFIRM },
      required: ['confirm'],
    },
    outputSchema: OUTPUT,
    handler: (runtime, args) => asTools(runtime).rokitUpdate(
      args.root as string | undefined,
      args.tool as string | undefined,
      args.confirm as boolean | undefined,
    ),
  }),
];

const WALLY_TOOLS: RegisteredTool[] = [
  defineTool({
    name: 'wally_get_manifest',
    description: 'Parse wally.toml with a real TOML parser and return the package metadata plus shared, server, and dev dependencies.',
    category: 'read',
    effects: ['local.files.read'],
    inputSchema: { type: 'object', properties: ROOT },
    outputSchema: OUTPUT,
    handler: (runtime, args) => asTools(runtime).wallyGetManifest(args.root as string | undefined),
  }),
  defineTool({
    name: 'wally_get_lock',
    description: 'Parse every [[package]] block in wally.lock and return exact names, versions, checksums, and registry.',
    category: 'read',
    effects: ['local.files.read'],
    inputSchema: { type: 'object', properties: ROOT },
    outputSchema: OUTPUT,
    handler: (runtime, args) => asTools(runtime).wallyGetLock(args.root as string | undefined),
  }),
  defineTool({
    name: 'wally_dependency_graph',
    description: 'Build the resolved package graph from wally.lock as nodes and dependency edges, flagging unresolved targets.',
    category: 'read',
    effects: ['local.files.read'],
    inputSchema: { type: 'object', properties: ROOT },
    outputSchema: OUTPUT,
    handler: (runtime, args) => asTools(runtime).wallyDependencyGraph(args.root as string | undefined),
  }),
  defineTool({
    name: 'wally_validate_lock',
    description: 'Check that wally.lock exists and covers every manifest dependency, reporting missing entries and packages without checksums.',
    category: 'read',
    effects: ['local.files.read'],
    inputSchema: { type: 'object', properties: ROOT },
    outputSchema: OUTPUT,
    handler: (runtime, args) => asTools(runtime).wallyValidateLock(args.root as string | undefined),
  }),
  defineTool({
    name: 'wally_verify_rojo_mapping',
    description: 'Verify the installed Packages/ServerPackages/DevPackages directories are actually mounted by the selected Rojo project tree.',
    category: 'read',
    effects: ['local.files.read'],
    inputSchema: {
      type: 'object',
      properties: { ...ROOT, projectFile: { type: 'string', description: 'Explicit *.project.json(c) path when discovery is ambiguous.' } },
    },
    outputSchema: OUTPUT,
    handler: (runtime, args) => asTools(runtime).wallyVerifyRojoMapping(
      args.root as string | undefined,
      args.projectFile as string | undefined,
    ),
  }),
  defineTool({
    name: 'wally_search',
    description: 'Search the configured Wally registry for a package.',
    category: 'read',
    effects: ['network.external', 'local.process.execute'],
    inputSchema: {
      type: 'object',
      properties: { ...ROOT, query: { type: 'string' } },
      required: ['query'],
    },
    outputSchema: OUTPUT,
    handler: (runtime, args) => asTools(runtime).wallySearch(args.root as string | undefined, args.query as string),
  }),
  defineTool({
    name: 'wally_install_plan',
    description: 'Preview a Wally install, including whether --locked can be used and whether the lockfile covers the manifest.',
    category: 'read',
    effects: ['local.files.read'],
    inputSchema: { type: 'object', properties: ROOT },
    outputSchema: OUTPUT,
    handler: (runtime, args) => asTools(runtime).wallyInstallPlan(args.root as string | undefined),
  }),
  defineTool({
    name: 'wally_install_apply',
    description: 'Install Wally packages after confirm=true, using --locked by default so a stale or missing lockfile fails instead of being rewritten.',
    category: 'write',
    effects: [...MUTATION_EFFECTS],
    inputSchema: {
      type: 'object',
      properties: {
        ...ROOT,
        ...CONFIRM,
        locked: { type: 'boolean', description: 'Defaults to true; set false only to deliberately resolve a new lockfile.' },
      },
      required: ['confirm'],
    },
    outputSchema: OUTPUT,
    handler: (runtime, args) => asTools(runtime).wallyInstallApply(
      args.root as string | undefined,
      args.confirm as boolean | undefined,
      args.locked as boolean | undefined,
    ),
  }),
  defineTool({
    name: 'wally_update_plan',
    description: 'Preview a Wally update against the current resolved graph without writing the lockfile.',
    category: 'read',
    effects: ['local.files.read'],
    inputSchema: {
      type: 'object',
      properties: { ...ROOT, packages: { type: 'array', items: { type: 'string' } } },
    },
    outputSchema: OUTPUT,
    handler: (runtime, args) => asTools(runtime).wallyUpdatePlan(
      args.root as string | undefined,
      args.packages as string[] | undefined,
    ),
  }),
  defineTool({
    name: 'wally_update_apply',
    description: 'Update Wally packages after confirm=true; rewrites wally.lock and can change transitive versions.',
    category: 'write',
    effects: [...MUTATION_EFFECTS],
    inputSchema: {
      type: 'object',
      properties: { ...ROOT, packages: { type: 'array', items: { type: 'string' } }, ...CONFIRM },
      required: ['confirm'],
    },
    outputSchema: OUTPUT,
    handler: (runtime, args) => asTools(runtime).wallyUpdateApply(
      args.root as string | undefined,
      args.packages as string[] | undefined,
      args.confirm as boolean | undefined,
    ),
  }),
];

const TOOLCHAIN_TOOLS = [...ROKIT_TOOLS, ...WALLY_TOOLS];

function asTools(runtime: unknown): RobloxStudioTools {
  return runtime as RobloxStudioTools;
}

export const TOOLCHAIN_TOOL_DEFINITIONS: ToolDefinition[] = TOOLCHAIN_TOOLS.map((tool) => tool.definition);

export function registerToolchainTools(registry: ToolRegistry): void {
  registry.register(...TOOLCHAIN_TOOLS);
}
