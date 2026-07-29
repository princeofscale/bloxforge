export type ProtocolMode = 'read' | 'mutation';
export type RetryPolicy = 'safe-read' | 'never';

export interface ProtocolManifestEntry {
  endpoint: string;
  mode: ProtocolMode;
  timeoutClass: 'normal' | 'heavy';
  retryPolicy: RetryPolicy;
  pluginVariants: readonly ('full' | 'inspector')[];
  concurrencyCategory: 'read' | 'mutation';
}

const READ_ENDPOINTS = [
  '/api/file-tree',
  '/api/search-files',
  '/api/place-info',
  '/api/services',
  '/api/search-objects',
  '/api/instance-properties',
  '/api/instance-children',
  '/api/search-by-property',
  '/api/class-info',
  '/api/project-structure',
  '/api/grep-scripts',
  '/api/get-descendants',
  '/api/compare-instances',
  '/api/mass-get-property',
  '/api/get-script-source',
  '/api/get-attributes',
  '/api/get-tags',
  '/api/get-tagged',
  '/api/get-selection',
  '/api/get-job-status',
  '/api/get-job-result',
  '/api/multiplayer-test-state',
  '/api/export-build',
  '/api/search-materials',
  '/api/preview-asset',
  '/api/capture-screenshot',
  '/api/capture-begin',
  '/api/capture-read',
  '/api/get-runtime-logs',
  '/api/capture-script-profiler',
  '/api/capture-micro-profiler',
  '/api/export-rbxm',
  '/api/get-memory-breakdown',
  '/api/get-scene-analysis',
] as const;

const MUTATION_ENDPOINTS = [
  '/api/set-property',
  '/api/set-properties',
  '/api/mass-set-property',
  '/api/create-object',
  '/api/mass-create-objects',
  '/api/mass-create-objects-with-properties',
  '/api/delete-object',
  '/api/smart-duplicate',
  '/api/mass-duplicate',
  '/api/clone-object',
  '/api/set-script-source',
  '/api/edit-script-lines',
  '/api/insert-script-lines',
  '/api/delete-script-lines',
  '/api/set-attribute',
  '/api/delete-attribute',
  '/api/add-tag',
  '/api/remove-tag',
  '/api/execute-luau',
  '/api/execute-luau-async',
  '/api/cancel-job',
  '/api/eval-runtime',
  '/api/undo',
  '/api/redo',
  '/api/bulk-set-attributes',
  '/api/start-playtest',
  '/api/stop-playtest',
  '/api/multiplayer-test-start',
  '/api/multiplayer-test-add-players',
  '/api/multiplayer-test-leave-client',
  '/api/multiplayer-test-end',
  '/api/character-navigation',
  '/api/import-build',
  '/api/import-scene',
  '/api/insert-asset',
  '/api/simulate-mouse-input',
  '/api/simulate-keyboard-input',
  '/api/find-and-replace-in-scripts',
  '/api/breakpoints',
  '/api/import-rbxm',
] as const;

const HEAVY_ENDPOINTS = new Set<string>([
  '/api/execute-luau',
  '/api/execute-luau-async',
  '/api/eval-runtime',
  '/api/import-build',
  '/api/import-scene',
]);

const entry = (endpoint: string, mode: ProtocolMode): ProtocolManifestEntry => ({
  endpoint,
  mode,
  timeoutClass: HEAVY_ENDPOINTS.has(endpoint) ? 'heavy' : 'normal',
  retryPolicy: mode === 'read' ? 'safe-read' : 'never',
  pluginVariants: mode === 'read' ? ['full', 'inspector'] : ['full'],
  concurrencyCategory: mode,
});

export const PROTOCOL_MANIFEST: readonly ProtocolManifestEntry[] = [
  ...READ_ENDPOINTS.map((endpoint) => entry(endpoint, 'read')),
  ...MUTATION_ENDPOINTS.map((endpoint) => entry(endpoint, 'mutation')),
];

const POLICY_BY_ENDPOINT = new Map(PROTOCOL_MANIFEST.map((policy) => [policy.endpoint, policy]));

export function protocolPolicy(endpoint: string): ProtocolManifestEntry {
  const policy = POLICY_BY_ENDPOINT.get(endpoint);
  if (!policy) {
    throw new Error(`Unknown plugin endpoint "${endpoint}". Add an explicit protocol policy before dispatch.`);
  }
  return policy;
}
