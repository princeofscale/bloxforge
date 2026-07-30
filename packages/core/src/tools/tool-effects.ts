import type { ToolCategory, ToolEffect } from './definitions.js';

const EFFECT_OVERRIDES: Readonly<Record<string, readonly ToolEffect[]>> = {
  tool_catalog_search: [],
  load_toolset: [],
  get_request_status: [],
  get_transport_diagnostics: [],

  detect_roblox_project: ['local.files.read'],
  resolve_instance_source_file: ['local.files.read'],
  get_dependency_graph: ['local.files.read'],
  validate_script_source: ['local.files.write', 'local.process.execute'],
  format_script_preview: ['local.process.execute'],
  run_project_tests: ['local.files.read', 'local.process.execute'],
  install_wally_packages: ['local.files.write', 'local.process.execute', 'network.external'],
  run_quality_gate: ['local.files.read', 'local.files.write', 'local.process.execute'],
  validate_with_luau_lsp: ['local.files.read', 'local.process.execute'],
  generate_rojo_sourcemap: ['local.files.read', 'local.files.write', 'local.process.execute'],
  build_rojo_project: ['local.files.read', 'local.files.write', 'local.process.execute'],

  sync_pull: ['studio.read', 'local.files.write'],
  sync_status: ['studio.read', 'local.files.read'],
  sync_push: ['studio.write', 'local.files.read', 'local.files.write'],

  execute_luau: ['studio.execute'],
  execute_luau_async: ['studio.execute'],
  apply_mutation_plan: ['studio.execute'],
  run_gameplay_assertions: ['studio.execute'],
  run_playtest_episode: ['studio.execute', 'playtest.control'],
};

const EXTERNAL_TOOL = /(asset|marketplace|image_generate|pollinations|wally|publish|import_rbxm|export_rbxm)/;
const PLAYTEST_TOOL = /(playtest|multiplayer|simulate_(mouse|keyboard)|character_navigation)/;

export function effectsForTool(name: string, category: ToolCategory): readonly ToolEffect[] {
  const explicit = EFFECT_OVERRIDES[name];
  if (explicit) return explicit;
  if (/^eval_.*runtime$/.test(name)) return ['studio.execute'];

  const effects: ToolEffect[] = [category === 'read' ? 'studio.read' : 'studio.write'];
  if (PLAYTEST_TOOL.test(name)) effects.push('playtest.control');
  if (EXTERNAL_TOOL.test(name)) effects.push('network.external');
  if (/upload_asset|image_generate_and_upload/.test(name)) effects.push('assets.upload');
  return [...new Set(effects)];
}

export function isInspectorEffect(effect: ToolEffect): boolean {
  return effect === 'studio.read' || effect === 'local.files.read';
}
