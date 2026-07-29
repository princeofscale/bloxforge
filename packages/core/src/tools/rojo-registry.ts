import { defineTool, type RegisteredTool, type ToolRegistry } from './tool-pipeline.js';
import type { ToolDefinition } from './definitions.js';
import type { RobloxStudioTools } from './index.js';

const OUTPUT = { type: 'object', additionalProperties: true };
const INSTANCE_ID = { type: 'string', description: 'Connected Studio place id when multiple places are open.' };
const PROJECT = {
  root: { type: 'string', description: 'Search root inside BLOXFORGE_PROJECT_ROOT.' },
  projectFile: { type: 'string', description: 'Explicit *.project.json path; required when discovery is ambiguous.' },
};

const ROJO_TOOLS: RegisteredTool[] = [
  defineTool({
    name: 'rojo_detect_projects',
    description: 'Discover every nested *.project.json under the allowed project root without guessing among multiple projects.',
    category: 'read',
    effects: ['local.files.read'],
    inputSchema: { type: 'object', properties: { root: PROJECT.root } },
    outputSchema: OUTPUT,
    handler: (runtime, args) => asTools(runtime).rojoDetectProjects(args.root as string | undefined),
  }),
  defineTool({
    name: 'rojo_get_project_info',
    description: 'Read the selected Rojo project metadata, including serve settings and managed tree.',
    category: 'read',
    effects: ['local.files.read'],
    inputSchema: { type: 'object', properties: PROJECT },
    outputSchema: OUTPUT,
    handler: (runtime, args) => asTools(runtime).rojoGetProjectInfo(args.root as string | undefined, args.projectFile as string | undefined),
  }),
  defineTool({
    name: 'rojo_validate_project',
    description: 'Validate a selected project by running a bounded Rojo build into an isolated temporary directory.',
    category: 'read',
    effects: ['local.files.read', 'local.files.write', 'local.process.execute'],
    inputSchema: { type: 'object', properties: PROJECT },
    outputSchema: OUTPUT,
    handler: (runtime, args) => asTools(runtime).rojoValidateProject(args.root as string | undefined, args.projectFile as string | undefined),
  }),
  defineTool({
    name: 'rojo_get_version',
    description: 'Report the installed Rojo command, version, and feature-detected optional commands such as syncback.',
    category: 'read',
    effects: ['local.process.execute'],
    inputSchema: { type: 'object', properties: {} },
    outputSchema: OUTPUT,
    handler: (runtime) => asTools(runtime).rojoGetVersion(),
  }),
  defineTool({
    name: 'rojo_serve_start',
    description: 'Start one managed loopback-only rojo serve process for the selected canonical project.',
    category: 'write',
    effects: ['local.files.read', 'local.process.execute'],
    inputSchema: {
      type: 'object',
      properties: {
        ...PROJECT,
        host: { type: 'string', description: 'Loopback host; defaults to the project setting or 127.0.0.1.' },
        port: { type: 'number', description: 'Serve port; defaults to the project setting or 34872.' },
        placeId: { type: 'number', description: 'Optional place ID checked against servePlaceIds.' },
      },
    },
    outputSchema: OUTPUT,
    handler: (runtime, args) => asTools(runtime).rojoServeStart(
      args.root as string | undefined,
      args.projectFile as string | undefined,
      args.host as string | undefined,
      args.port as number | undefined,
      args.placeId as number | undefined,
    ),
  }),
  ...(['status', 'logs', 'stop'] as const).map((operation) => defineTool({
    name: `rojo_serve_${operation}`,
    description: operation === 'status'
      ? 'Report managed rojo serve status, PID, version, project, host, port, and start time.'
      : operation === 'logs'
        ? 'Read bounded stdout/stderr lines from a managed rojo serve process.'
        : 'Gracefully stop the managed rojo serve process for the selected project.',
    category: operation === 'stop' ? 'write' : 'read',
    effects: ['local.files.read', 'local.process.execute'],
    inputSchema: {
      type: 'object',
      properties: {
        ...PROJECT,
        ...(operation === 'logs' ? { limit: { type: 'number', description: 'Most recent lines, 1-200.' } } : {}),
      },
    },
    outputSchema: OUTPUT,
    handler: (runtime, args) => operation === 'status'
      ? asTools(runtime).rojoServeStatus(args.root as string | undefined, args.projectFile as string | undefined)
      : operation === 'logs'
        ? asTools(runtime).rojoServeLogs(args.root as string | undefined, args.projectFile as string | undefined, args.limit as number | undefined)
        : asTools(runtime).rojoServeStop(args.root as string | undefined, args.projectFile as string | undefined),
  })),
  defineTool({
    name: 'rojo_build_project',
    description: 'Build the selected Rojo project to an explicit output path inside the project root.',
    category: 'write',
    effects: ['local.files.read', 'local.files.write', 'local.process.execute'],
    inputSchema: {
      type: 'object',
      properties: { ...PROJECT, output: { type: 'string' } },
      required: ['output'],
    },
    outputSchema: OUTPUT,
    handler: (runtime, args) => asTools(runtime).rojoBuildProject(
      args.root as string | undefined,
      args.projectFile as string | undefined,
      args.output as string,
    ),
  }),
  defineTool({
    name: 'rojo_generate_sourcemap',
    description: 'Generate a sourcemap for the selected project at a safe explicit local output path.',
    category: 'write',
    effects: ['local.files.read', 'local.files.write', 'local.process.execute'],
    inputSchema: {
      type: 'object',
      properties: { ...PROJECT, output: { type: 'string', default: 'sourcemap.json' } },
    },
    outputSchema: OUTPUT,
    handler: (runtime, args) => asTools(runtime).rojoGenerateSourcemap(
      args.root as string | undefined,
      args.projectFile as string | undefined,
      args.output as string | undefined,
    ),
  }),
  ...(['instance_source', 'source_instance'] as const).map((direction) => defineTool({
    name: `rojo_resolve_${direction}`,
    description: direction === 'instance_source'
      ? 'Resolve a Studio Instance path to local source paths using a Rojo sourcemap.'
      : 'Resolve a local source path to its Studio Instance identity using a Rojo sourcemap.',
    category: 'read',
    effects: ['local.files.read'],
    inputSchema: {
      type: 'object',
      properties: {
        ...PROJECT,
        ...(direction === 'instance_source'
          ? { instancePath: { type: 'string' } }
          : { sourcePath: { type: 'string' } }),
        sourcemap: { type: 'string', description: 'Relative sourcemap path; defaults to sourcemap.json.' },
      },
      required: [direction === 'instance_source' ? 'instancePath' : 'sourcePath'],
    },
    outputSchema: OUTPUT,
    handler: (runtime, args) => direction === 'instance_source'
      ? asTools(runtime).rojoResolveInstanceSource(
        args.root as string | undefined,
        args.projectFile as string | undefined,
        args.instancePath as string,
        args.sourcemap as string | undefined,
      )
      : asTools(runtime).rojoResolveSourceInstance(
        args.root as string | undefined,
        args.projectFile as string | undefined,
        args.sourcePath as string,
        args.sourcemap as string | undefined,
      ),
  })),
  defineTool({
    name: 'rojo_read_source',
    description: 'Read one supported Rojo source file with its SHA-256 optimistic-lock hash.',
    category: 'read',
    effects: ['local.files.read'],
    inputSchema: {
      type: 'object',
      properties: { ...PROJECT, sourcePath: { type: 'string' } },
      required: ['sourcePath'],
    },
    outputSchema: OUTPUT,
    handler: (runtime, args) => asTools(runtime).rojoReadSource(
      args.root as string | undefined,
      args.projectFile as string | undefined,
      args.sourcePath as string,
    ),
  }),
  defineTool({
    name: 'rojo_patch_source',
    description: 'Patch one unique text span in a local Rojo source with dry-run, formatted diff, and expected content hash.',
    category: 'write',
    effects: ['local.files.read', 'local.files.write'],
    inputSchema: {
      type: 'object',
      properties: {
        ...PROJECT,
        sourcePath: { type: 'string' },
        oldText: { type: 'string' },
        newText: { type: 'string' },
        expectedHash: { type: 'string' },
        dryRun: { type: 'boolean' },
        validate: { type: 'boolean', description: 'Run available targeted Luau/Selene/StyLua checks before writing.' },
      },
      required: ['sourcePath', 'oldText', 'newText', 'expectedHash'],
    },
    outputSchema: OUTPUT,
    handler: (runtime, args) => asTools(runtime).rojoPatchSource(
      args.root as string | undefined,
      args.projectFile as string | undefined,
      args.sourcePath as string,
      {
        oldText: args.oldText as string,
        newText: args.newText as string,
        expectedHash: args.expectedHash as string,
        dryRun: args.dryRun as boolean | undefined,
        validate: args.validate as boolean | undefined,
      },
    ),
  }),
  defineTool({
    name: 'rojo_create_source',
    description: 'Create one absent Rojo source atomically, with dry-run and expectedAbsent optimistic locking.',
    category: 'write',
    effects: ['local.files.read', 'local.files.write'],
    inputSchema: {
      type: 'object',
      properties: {
        ...PROJECT,
        sourcePath: { type: 'string' },
        content: { type: 'string' },
        expectedAbsent: { type: 'boolean' },
        dryRun: { type: 'boolean' },
        validate: { type: 'boolean', description: 'Run available targeted Luau/Selene/StyLua checks before writing.' },
      },
      required: ['sourcePath', 'content'],
    },
    outputSchema: OUTPUT,
    handler: (runtime, args) => asTools(runtime).rojoCreateSource(
      args.root as string | undefined,
      args.projectFile as string | undefined,
      args.sourcePath as string,
      {
        content: args.content as string,
        expectedAbsent: args.expectedAbsent as boolean | undefined,
        dryRun: args.dryRun as boolean | undefined,
        validate: args.validate as boolean | undefined,
      },
    ),
  }),
  defineTool({
    name: 'rojo_delete_source',
    description: 'Delete one Rojo source only after dry-run review, expected hash validation, confirmation, and local backup.',
    category: 'write',
    effects: ['local.files.read', 'local.files.write'],
    inputSchema: {
      type: 'object',
      properties: {
        ...PROJECT,
        sourcePath: { type: 'string' },
        expectedHash: { type: 'string' },
        dryRun: { type: 'boolean' },
        confirm: { type: 'boolean' },
      },
      required: ['sourcePath', 'expectedHash'],
    },
    outputSchema: OUTPUT,
    handler: (runtime, args) => asTools(runtime).rojoDeleteSource(
      args.root as string | undefined,
      args.projectFile as string | undefined,
      args.sourcePath as string,
      {
        expectedHash: args.expectedHash as string,
        dryRun: args.dryRun as boolean | undefined,
        confirm: args.confirm as boolean | undefined,
      },
    ),
  }),
  defineTool({
    name: 'rojo_syncback_plan',
    description: 'Preview the safe bounded Studio-to-files subset as added, modified, deleted, unmanaged, and conflicting entries; never writes.',
    category: 'read',
    effects: ['studio.read', 'local.files.read', 'local.process.execute'],
    inputSchema: {
      type: 'object',
      properties: {
        ...PROJECT,
        syncDir: { type: 'string' },
        inputPlaceFile: { type: 'string', description: 'Optional RBXL/RBXLX/RBXM/RBXMX input for native Rojo 7.7+ syncback dry-run.' },
        instance_id: INSTANCE_ID,
      },
    },
    outputSchema: OUTPUT,
    handler: (runtime, args) => asTools(runtime).rojoSyncbackPlan(
      args.syncDir as string | undefined,
      args.instance_id as string | undefined,
      {
        root: args.root as string | undefined,
        projectFile: args.projectFile as string | undefined,
        inputPlaceFile: args.inputPlaceFile as string | undefined,
      },
    ),
  }),
  defineTool({
    name: 'rojo_syncback_apply',
    description: 'Recompute and apply only conflict-free Studio-to-files changes after confirm=true, with backups and atomic writes.',
    category: 'write',
    effects: ['studio.read', 'local.files.read', 'local.files.write', 'local.process.execute'],
    inputSchema: {
      type: 'object',
      properties: {
        ...PROJECT,
        syncDir: { type: 'string' },
        inputPlaceFile: { type: 'string', description: 'Optional RBXL/RBXLX/RBXM/RBXMX input for native Rojo 7.7+ syncback.' },
        dryRun: { type: 'boolean' },
        confirm: { type: 'boolean' },
        deleteMissing: { type: 'boolean', description: 'Delete baseline-managed local files missing in Studio; requires confirm=true and creates backups.' },
        instance_id: INSTANCE_ID,
      },
      required: ['confirm'],
    },
    outputSchema: OUTPUT,
    handler: (runtime, args) => asTools(runtime).rojoSyncbackApply(
      args.syncDir as string | undefined,
      args.instance_id as string | undefined,
      {
        dryRun: args.dryRun as boolean | undefined,
        confirm: args.confirm as boolean | undefined,
        deleteMissing: args.deleteMissing as boolean | undefined,
        root: args.root as string | undefined,
        projectFile: args.projectFile as string | undefined,
        inputPlaceFile: args.inputPlaceFile as string | undefined,
      },
    ),
  }),
];

function asTools(runtime: unknown): RobloxStudioTools {
  return runtime as RobloxStudioTools;
}

export const ROJO_TOOL_DEFINITIONS: ToolDefinition[] = ROJO_TOOLS.map((tool) => tool.definition);

export function registerRojoTools(registry: ToolRegistry): void {
  registry.register(...ROJO_TOOLS);
}
