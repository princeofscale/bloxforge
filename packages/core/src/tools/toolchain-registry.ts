import { defineTool, type RegisteredTool, type ToolRegistry } from './tool-pipeline.js';
import type { ToolDefinition } from './definitions.js';
import type { RobloxStudioTools } from './index.js';

const OUTPUT = { type: 'object', additionalProperties: true };
const ROOT = { root: { type: 'string', description: 'Search root inside BLOXFORGE_PROJECT_ROOT; the nearest manifest at or above it is used.' } };
const CONFIRM = { confirm: { type: 'boolean', description: 'Required to execute; downloads from the network and writes local files.' } };
// A toolchain plan is immutable, like a Rojo syncback plan: the manifest and
// lockfile it was computed against are hashed into planHash, so an edit by
// another process (or another agent) between plan and apply invalidates it.
const EXPECTED_PLAN_HASH = (planTool: string) => ({
  expectedPlanHash: {
    type: 'string',
    description: `planHash returned by ${planTool}; required for every apply. Covers the manifest and lockfile content at plan time.`,
  },
});

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
    description: 'Install every tool pinned by the manifest after confirm=true; downloads binaries and writes shims. Rokit prompts for trust on an unseen source and there is no terminal here, so set allowPinnedToolDownloads=true to skip that check — allowed only when every tool is pinned to an exact version.',
    category: 'write',
    effects: [...MUTATION_EFFECTS],
    inputSchema: {
      type: 'object',
      properties: {
        ...ROOT,
        ...CONFIRM,
        allowPinnedToolDownloads: {
          type: 'boolean',
          description: 'Run non-interactively, trusting the exact owner/repo@version pins already in the manifest. Refused if any tool uses a loose requirement.',
        },
      },
    },
    outputSchema: OUTPUT,
    handler: (runtime, args) => asTools(runtime).rokitInstall(
      args.root as string | undefined,
      args.confirm as boolean | undefined,
      args.allowPinnedToolDownloads as boolean | undefined,
    ),
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
    description: 'Run the toolchain\'s own add command after confirm=true and an expectedPlanHash match, so the version is resolved and written by the toolchain, never hardcoded.',
    category: 'write',
    effects: [...MUTATION_EFFECTS],
    inputSchema: {
      type: 'object',
      properties: { ...ROOT, spec: { type: 'string' }, ...CONFIRM, ...EXPECTED_PLAN_HASH('rokit_add_tool_plan') },
      required: ['spec', 'confirm', 'expectedPlanHash'],
    },
    outputSchema: OUTPUT,
    handler: (runtime, args) => asTools(runtime).rokitAddTool(
      args.root as string | undefined,
      args.spec as string,
      args.confirm as boolean | undefined,
      args.expectedPlanHash as string | undefined,
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
    description: 'Update one tool or every tool after confirm=true and an expectedPlanHash match; rewrites the manifest and downloads new versions.',
    category: 'write',
    effects: [...MUTATION_EFFECTS],
    inputSchema: {
      type: 'object',
      properties: { ...ROOT, tool: { type: 'string' }, ...CONFIRM, ...EXPECTED_PLAN_HASH('rokit_update_plan') },
      required: ['confirm', 'expectedPlanHash'],
    },
    outputSchema: OUTPUT,
    handler: (runtime, args) => asTools(runtime).rokitUpdate(
      args.root as string | undefined,
      args.tool as string | undefined,
      args.confirm as boolean | undefined,
      args.expectedPlanHash as string | undefined,
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
    description: 'Install Wally packages after confirm=true and an expectedPlanHash match, using --locked by default. On a Wally without --locked (0.3.2) the lockfile is backed up and restored if the install moved it, so the install is locked either way rather than refused.',
    category: 'write',
    effects: [...MUTATION_EFFECTS],
    inputSchema: {
      type: 'object',
      properties: {
        ...ROOT,
        ...CONFIRM,
        locked: { type: 'boolean', description: 'Defaults to true; set false only to deliberately resolve a new lockfile. Only a locked install is pinned to a planHash.' },
        ...EXPECTED_PLAN_HASH('wally_install_plan'),
      },
      required: ['confirm'],
    },
    outputSchema: OUTPUT,
    handler: (runtime, args) => asTools(runtime).wallyInstallApply(
      args.root as string | undefined,
      args.confirm as boolean | undefined,
      args.locked as boolean | undefined,
      args.expectedPlanHash as string | undefined,
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
    description: 'Update Wally packages after confirm=true and an expectedPlanHash match; rewrites wally.lock and can change transitive versions.',
    category: 'write',
    effects: [...MUTATION_EFFECTS],
    inputSchema: {
      type: 'object',
      properties: {
        ...ROOT,
        packages: { type: 'array', items: { type: 'string' } },
        ...CONFIRM,
        ...EXPECTED_PLAN_HASH('wally_update_plan'),
      },
      required: ['confirm', 'expectedPlanHash'],
    },
    outputSchema: OUTPUT,
    handler: (runtime, args) => asTools(runtime).wallyUpdateApply(
      args.root as string | undefined,
      args.packages as string[] | undefined,
      args.confirm as boolean | undefined,
      args.expectedPlanHash as string | undefined,
    ),
  }),
];

// Three tools, not one that quietly does everything. Reconcile owns the *order*
// of the existing operations; it does not become a second, less-reviewed way to
// perform them, so it keeps the same plan / confirm / planHash contract.
const RECONCILE_TOOLS: RegisteredTool[] = [
  defineTool({
    name: 'project_reconcile_plan',
    description: 'Read the whole project — Rojo project, toolchain pins, Wally lock, package mounts, sourcemap, rojo serve — and return the ordered steps that would make it ready, each marked automatic or blocked by the [automation] policy. Writes nothing and makes no network request.',
    category: 'read',
    effects: ['local.files.read', 'local.process.execute'],
    inputSchema: {
      type: 'object',
      properties: {
        ...ROOT,
        projectFile: { type: 'string', description: 'Explicit *.project.json(c) path. Required when discovery finds more than one.' },
      },
    },
    outputSchema: OUTPUT,
    handler: (runtime, args) => asTools(runtime).projectReconcilePlan(
      args.root as string | undefined,
      args.projectFile as string | undefined,
    ),
  }),
  defineTool({
    name: 'project_reconcile_apply',
    description: 'Run the planned steps in order under a single-writer lease, re-reading state after each one, then finish with a strict project verify. Restores declared state only: installing pinned tools and locked packages is permitted, resolving new versions is not. Pass the same runId to resume an interrupted run from its journal.',
    category: 'write',
    effects: [...MUTATION_EFFECTS],
    inputSchema: {
      type: 'object',
      properties: {
        ...ROOT,
        projectFile: { type: 'string' },
        ...CONFIRM,
        ...EXPECTED_PLAN_HASH('project_reconcile_plan'),
        runId: { type: 'string', description: 'Resume the journal at .bloxforge/reconcile/<runId>.json instead of starting a new run.' },
      },
      required: ['confirm', 'expectedPlanHash'],
    },
    outputSchema: OUTPUT,
    handler: (runtime, args) => asTools(runtime).projectReconcileApply(
      args.root as string | undefined,
      args.projectFile as string | undefined,
      args.confirm as boolean | undefined,
      args.expectedPlanHash as string | undefined,
      args.runId as string | undefined,
    ),
  }),
  defineTool({
    name: 'project_reconcile_status',
    description: 'The current plan plus the reconcile lease holder and the most recent run journals, for checking whether another agent is mid-reconcile or why the last one stopped.',
    category: 'read',
    effects: ['local.files.read', 'local.process.execute'],
    inputSchema: {
      type: 'object',
      properties: { ...ROOT, projectFile: { type: 'string' } },
    },
    outputSchema: OUTPUT,
    handler: (runtime, args) => asTools(runtime).projectReconcileStatus(
      args.root as string | undefined,
      args.projectFile as string | undefined,
    ),
  }),
];

const TOOLCHAIN_TOOLS = [...ROKIT_TOOLS, ...WALLY_TOOLS, ...RECONCILE_TOOLS];

function asTools(runtime: unknown): RobloxStudioTools {
  return runtime as RobloxStudioTools;
}

export const TOOLCHAIN_TOOL_DEFINITIONS: ToolDefinition[] = TOOLCHAIN_TOOLS.map((tool) => tool.definition);

export function registerToolchainTools(registry: ToolRegistry): void {
  registry.register(...TOOLCHAIN_TOOLS);
}
