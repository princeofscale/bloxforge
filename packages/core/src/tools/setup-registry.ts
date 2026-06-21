// Wire first-wave contracted tools into the ToolRegistry.
//
// Each defineTool call creates both a ToolDefinition (for ListTools) and
// a pipeline-wrapped handler (for CallTool) in ONE place, keeping output
// schemas, input schemas, and the handler always in sync.
//
// Add more tools here as they get output schemas.

import { defineTool, type ToolRegistry } from './tool-pipeline.js';
import { OUTPUT_SCHEMAS } from './output-schemas.js';
import { META_TOOL_DEFINITIONS } from './definitions/meta.js';
import { SCENE_TOOL_DEFINITIONS } from './definitions/scene.js';
import { MUTATION_TOOL_DEFINITIONS } from './definitions/mutation.js';
import { RUNTIME_TOOL_DEFINITIONS } from './definitions/runtime.js';
import { ASSET_TOOL_DEFINITIONS } from './definitions/assets.js';
import { GENERATED_TOOL_DEFINITIONS } from './definitions/generated.js';
import type { RobloxStudioTools } from './index.js';
import type { ToolDefinition } from './definitions.js';

/**
 * Register first-wave contracted tools from the RobloxStudioTools instance
 * into the registry. Returns a list of override definitions (for tools that
 * now have outputSchema via the registry) for backward compat.
 *
 * Non-contracted tools stay in TOOL_HANDLERS as-is — migrate them one at
 * a time as their output schemas are written.
 */
export function registerContractedTools(
  registry: ToolRegistry,
  tools: RobloxStudioTools,
): void {
  // Discovery / meta — always-on
  registry.register(
    defineTool({
      name: 'tool_catalog_search',
      description: findDef(META_TOOL_DEFINITIONS, 'tool_catalog_search')?.description ?? 'Find the right tool for a task.',
      category: 'read',
      inputSchema: findDef(META_TOOL_DEFINITIONS, 'tool_catalog_search')?.inputSchema ?? {},
      outputSchema: OUTPUT_SCHEMAS.tool_catalog_search,
      handler: (_, args) => tools.toolCatalogSearch(args as any),
    }),
    defineTool({
      name: 'load_toolset',
      description: findDef(META_TOOL_DEFINITIONS, 'load_toolset')?.description ?? 'Load tool domains.',
      category: 'read',
      inputSchema: findDef(META_TOOL_DEFINITIONS, 'load_toolset')?.inputSchema ?? {},
      outputSchema: OUTPUT_SCHEMAS.load_toolset,
      handler: (_, args) => tools.loadToolset(args as any),
    }),
  );

  // World-model reads
  registry.register(
    defineTool({
      name: 'get_world_snapshot',
      description: findDef(SCENE_TOOL_DEFINITIONS, 'get_world_snapshot')?.description ?? 'Get scene overview.',
      category: 'read',
      inputSchema: findDef(SCENE_TOOL_DEFINITIONS, 'get_world_snapshot')?.inputSchema ?? {},
      outputSchema: OUTPUT_SCHEMAS.get_world_snapshot,
      handler: (_, args) => tools.getWorldSnapshot(
        (args as any).path,
        (args as any).level,
        (args as any).topNPerClass,
        (args as any).instance_id,
      ),
    }),
    defineTool({
      name: 'get_node_batch',
      description: findDef(SCENE_TOOL_DEFINITIONS, 'get_node_batch')?.description ?? 'Read instance properties in batch.',
      category: 'read',
      inputSchema: findDef(SCENE_TOOL_DEFINITIONS, 'get_node_batch')?.inputSchema ?? {},
      outputSchema: OUTPUT_SCHEMAS.get_node_batch,
      handler: (_, args) => tools.getNodeBatch(
        (args as any).paths,
        (args as any).fields,
        (args as any).includeChildrenCount,
        (args as any).instance_id,
      ),
    }),
    defineTool({
      name: 'get_changes_since',
      description: findDef(SCENE_TOOL_DEFINITIONS, 'get_changes_since')?.description ?? 'Incremental scene diff.',
      category: 'read',
      inputSchema: findDef(SCENE_TOOL_DEFINITIONS, 'get_changes_since')?.inputSchema ?? {},
      outputSchema: OUTPUT_SCHEMAS.get_changes_since,
      handler: (_, args) => tools.getChangesSince(
        (args as any).snapshotId,
        (args as any).path,
        (args as any).instance_id,
      ),
    }),
    defineTool({
      name: 'scene_search',
      description: findDef(SCENE_TOOL_DEFINITIONS, 'scene_search')?.description ?? 'Search the scene hierarchy.',
      category: 'read',
      inputSchema: findDef(SCENE_TOOL_DEFINITIONS, 'scene_search')?.inputSchema ?? {},
      outputSchema: OUTPUT_SCHEMAS.scene_search,
      handler: (_, args) => tools.sceneSearch(
        (args as any).query,
        (args as any).path,
        (args as any).limit,
        (args as any).instance_id,
      ),
    }),
  );

  // Asset preflight
  registry.register(
    defineTool({
      name: 'asset_preflight_insert',
      description: findDef(ASSET_TOOL_DEFINITIONS, 'asset_preflight_insert')?.description ?? 'Check asset insertability.',
      category: 'read',
      inputSchema: findDef(SCENE_TOOL_DEFINITIONS, 'asset_preflight_insert')?.inputSchema ?? {},
      outputSchema: OUTPUT_SCHEMAS.asset_preflight_insert,
      handler: (_, args) => tools.assetPreflightInsert(
        (args as any).assetId,
        (args as any).instance_id,
      ),
    }),
  );

  // Playtest telemetry
  registry.register(
    defineTool({
      name: 'playtest_sample_state',
      description: findDef(RUNTIME_TOOL_DEFINITIONS, 'playtest_sample_state')?.description ?? 'Sample live playtest state.',
      category: 'read',
      inputSchema: findDef(RUNTIME_TOOL_DEFINITIONS, 'playtest_sample_state')?.inputSchema ?? {},
      outputSchema: OUTPUT_SCHEMAS.playtest_sample_state,
      handler: (_, args) => tools.playtestSampleState(
        (args as any).domains,
        (args as any).target,
        (args as any).instance_id,
      ),
    }),
  );

  // Gameplay assertions
  registry.register(
    defineTool({
      name: 'run_gameplay_assertions',
      description: findDef(RUNTIME_TOOL_DEFINITIONS, 'run_gameplay_assertions')?.description ?? 'Run named boolean checks on the DataModel.',
      category: 'write',
      inputSchema: findDef(RUNTIME_TOOL_DEFINITIONS, 'run_gameplay_assertions')?.inputSchema ?? {},
      outputSchema: OUTPUT_SCHEMAS.run_gameplay_assertions,
      handler: (_, args) => tools.runGameplayAssertions(
        (args as any).assertions,
        (args as any).target,
        (args as any).instance_id,
      ),
    }),
  );

  // Transactional mutation plans
  registry.register(
    defineTool({
      name: 'apply_mutation_plan',
      description: findDef(MUTATION_TOOL_DEFINITIONS, 'apply_mutation_plan')?.description ?? 'Apply many small edits in one round-trip.',
      category: 'write',
      inputSchema: findDef(MUTATION_TOOL_DEFINITIONS, 'apply_mutation_plan')?.inputSchema ?? {},
      outputSchema: OUTPUT_SCHEMAS.apply_mutation_plan,
      handler: (_, args) => tools.applyMutationPlan(
        (args as any).operations,
        (args as any).dryRun,
        (args as any).confirm,
        (args as any).instance_id,
      ),
    }),
  );

  // Recipes
  registry.register(
    defineTool({
      name: 'list_recipes',
      description: findDef(GENERATED_TOOL_DEFINITIONS, 'list_recipes')?.description ?? 'List available recipes.',
      category: 'read',
      inputSchema: findDef(MUTATION_TOOL_DEFINITIONS, 'list_recipes')?.inputSchema ?? {},
      outputSchema: OUTPUT_SCHEMAS.list_recipes,
      handler: () => tools.listRecipes(),
    }),
    defineTool({
      name: 'apply_recipe',
      description: findDef(GENERATED_TOOL_DEFINITIONS, 'apply_recipe')?.description ?? 'Run a recipe with typed parameters.',
      category: 'write',
      inputSchema: findDef(MUTATION_TOOL_DEFINITIONS, 'apply_recipe')?.inputSchema ?? {},
      outputSchema: OUTPUT_SCHEMAS.apply_recipe,
      handler: (_, args) => tools.applyRecipe(
        (args as any).recipe,
        (args as any).params,
        (args as any).instance_id,
      ),
    }),
  );
}

function findDef(defs: ToolDefinition[], name: string): ToolDefinition | undefined {
  return defs.find(d => d.name === name);
}
