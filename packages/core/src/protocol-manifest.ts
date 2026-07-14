export type ProtocolMode = 'read' | 'mutation' | 'heavy';
export type RetryPolicy = 'safe-read' | 'never';

export interface ProtocolManifestEntry {
  endpoint: string;
  mode: ProtocolMode;
  timeoutClass: 'normal' | 'heavy';
  retryPolicy: RetryPolicy;
  pluginVariants: readonly ('full' | 'inspector')[];
}

// Prefix entries deliberately cover the transport policy surface, while tool
// schemas remain in definitions/*. A single policy table avoids primary/proxy
// and bridge/plugin drift without duplicating every high-level MCP facade.
export const PROTOCOL_MANIFEST: readonly ProtocolManifestEntry[] = [
  { endpoint: '/api/execute-luau', mode: 'heavy', timeoutClass: 'heavy', retryPolicy: 'never', pluginVariants: ['full'] },
  { endpoint: '/api/eval-runtime', mode: 'heavy', timeoutClass: 'heavy', retryPolicy: 'never', pluginVariants: ['full'] },
  { endpoint: '/api/generate-build', mode: 'heavy', timeoutClass: 'heavy', retryPolicy: 'never', pluginVariants: ['full'] },
  { endpoint: '/api/import-scene', mode: 'heavy', timeoutClass: 'heavy', retryPolicy: 'never', pluginVariants: ['full'] },
  { endpoint: '/api/mass-get-property', mode: 'read', timeoutClass: 'normal', retryPolicy: 'safe-read', pluginVariants: ['full', 'inspector'] },
  { endpoint: '/api/edit-script-lines', mode: 'mutation', timeoutClass: 'normal', retryPolicy: 'never', pluginVariants: ['full'] },
  { endpoint: '/api/insert-script-lines', mode: 'mutation', timeoutClass: 'normal', retryPolicy: 'never', pluginVariants: ['full'] },
  { endpoint: '/api/delete-script-lines', mode: 'mutation', timeoutClass: 'normal', retryPolicy: 'never', pluginVariants: ['full'] },
  { endpoint: '/api/find-and-replace-in-scripts', mode: 'mutation', timeoutClass: 'normal', retryPolicy: 'never', pluginVariants: ['full'] },
  { endpoint: '/api/add-tag', mode: 'mutation', timeoutClass: 'normal', retryPolicy: 'never', pluginVariants: ['full'] },
  { endpoint: '/api/remove-tag', mode: 'mutation', timeoutClass: 'normal', retryPolicy: 'never', pluginVariants: ['full'] },
  { endpoint: '/api/delete-attribute', mode: 'mutation', timeoutClass: 'normal', retryPolicy: 'never', pluginVariants: ['full'] },
  { endpoint: '/api/bulk-set-attributes', mode: 'mutation', timeoutClass: 'normal', retryPolicy: 'never', pluginVariants: ['full'] },
  { endpoint: '/api/insert-asset', mode: 'mutation', timeoutClass: 'normal', retryPolicy: 'never', pluginVariants: ['full'] },
  { endpoint: '/api/cancel-job', mode: 'mutation', timeoutClass: 'normal', retryPolicy: 'never', pluginVariants: ['full'] },
  { endpoint: '/api/character-navigation', mode: 'mutation', timeoutClass: 'normal', retryPolicy: 'never', pluginVariants: ['full'] },
  { endpoint: '/api/set-', mode: 'mutation', timeoutClass: 'normal', retryPolicy: 'never', pluginVariants: ['full'] },
  { endpoint: '/api/mass-', mode: 'mutation', timeoutClass: 'normal', retryPolicy: 'never', pluginVariants: ['full'] },
  { endpoint: '/api/create-', mode: 'mutation', timeoutClass: 'normal', retryPolicy: 'never', pluginVariants: ['full'] },
  { endpoint: '/api/delete-', mode: 'mutation', timeoutClass: 'normal', retryPolicy: 'never', pluginVariants: ['full'] },
  { endpoint: '/api/import-', mode: 'mutation', timeoutClass: 'normal', retryPolicy: 'never', pluginVariants: ['full'] },
  { endpoint: '/api/smart-', mode: 'mutation', timeoutClass: 'normal', retryPolicy: 'never', pluginVariants: ['full'] },
  { endpoint: '/api/clone-', mode: 'mutation', timeoutClass: 'normal', retryPolicy: 'never', pluginVariants: ['full'] },
  { endpoint: '/api/terrain-', mode: 'mutation', timeoutClass: 'normal', retryPolicy: 'never', pluginVariants: ['full'] },
  { endpoint: '/api/environment-', mode: 'mutation', timeoutClass: 'normal', retryPolicy: 'never', pluginVariants: ['full'] },
  { endpoint: '/api/ui_', mode: 'mutation', timeoutClass: 'normal', retryPolicy: 'never', pluginVariants: ['full'] },
  { endpoint: '/api/template_', mode: 'mutation', timeoutClass: 'normal', retryPolicy: 'never', pluginVariants: ['full'] },
  { endpoint: '/api/sync_', mode: 'mutation', timeoutClass: 'normal', retryPolicy: 'never', pluginVariants: ['full'] },
  { endpoint: '/api/start-playtest', mode: 'mutation', timeoutClass: 'normal', retryPolicy: 'never', pluginVariants: ['full'] },
  { endpoint: '/api/stop-playtest', mode: 'mutation', timeoutClass: 'normal', retryPolicy: 'never', pluginVariants: ['full'] },
  { endpoint: '/api/multiplayer-test', mode: 'mutation', timeoutClass: 'normal', retryPolicy: 'never', pluginVariants: ['full'] },
  { endpoint: '/api/simulate-', mode: 'mutation', timeoutClass: 'normal', retryPolicy: 'never', pluginVariants: ['full'] },
  { endpoint: '/api/undo', mode: 'mutation', timeoutClass: 'normal', retryPolicy: 'never', pluginVariants: ['full'] },
  { endpoint: '/api/redo', mode: 'mutation', timeoutClass: 'normal', retryPolicy: 'never', pluginVariants: ['full'] },
];

export function protocolPolicy(endpoint: string): ProtocolManifestEntry {
  return PROTOCOL_MANIFEST.find((entry) => endpoint.startsWith(entry.endpoint)) ?? {
    endpoint: '*', mode: 'read', timeoutClass: 'normal', retryPolicy: 'safe-read', pluginVariants: ['full', 'inspector'],
  };
}
