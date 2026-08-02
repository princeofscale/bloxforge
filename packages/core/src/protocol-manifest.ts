import { ENDPOINT_SOURCE } from './protocol-endpoints.generated.js';

export type ProtocolMode = 'read' | 'mutation';
export type RetryPolicy = 'safe-read' | 'never';
export type ProtocolPluginVariant = 'main' | 'inspector';

export interface ProtocolManifestEntry {
  endpoint: string;
  mode: ProtocolMode;
  timeoutClass: 'normal' | 'heavy';
  retryPolicy: RetryPolicy;
  pluginVariants: readonly ProtocolPluginVariant[];
  concurrencyCategory: 'read' | 'mutation';
}

interface EndpointSource {
  readonly read: readonly string[];
  readonly mutation: readonly string[];
  readonly heavy: readonly string[];
}

function validateEndpointSource(value: EndpointSource): EndpointSource {
  const groups = [value.read, value.mutation, value.heavy];
  if (groups.some((group) => !Array.isArray(group) || group.some((endpoint) => !endpoint.startsWith('/api/')))) {
    throw new Error('Protocol endpoint source contains an invalid endpoint');
  }
  const declared = [...value.read, ...value.mutation];
  if (new Set(declared).size !== declared.length) {
    throw new Error('Protocol endpoint source contains a duplicate or conflicting endpoint');
  }
  if (value.heavy.some((endpoint) => !declared.includes(endpoint))) {
    throw new Error('Protocol endpoint source classifies an undeclared heavy endpoint');
  }
  return value;
}

const ENDPOINTS = validateEndpointSource(ENDPOINT_SOURCE);
const HEAVY_ENDPOINTS = new Set(ENDPOINTS.heavy);

const entry = (endpoint: string, mode: ProtocolMode): ProtocolManifestEntry => ({
  endpoint,
  mode,
  timeoutClass: HEAVY_ENDPOINTS.has(endpoint) ? 'heavy' : 'normal',
  retryPolicy: mode === 'read' ? 'safe-read' : 'never',
  pluginVariants: mode === 'read' ? ['main', 'inspector'] : ['main'],
  concurrencyCategory: mode,
});

export const PROTOCOL_MANIFEST: readonly ProtocolManifestEntry[] = [
  ...ENDPOINTS.read.map((endpoint) => entry(endpoint, 'read')),
  ...ENDPOINTS.mutation.map((endpoint) => entry(endpoint, 'mutation')),
];

const POLICY_BY_ENDPOINT = new Map(PROTOCOL_MANIFEST.map((policy) => [policy.endpoint, policy]));

export function protocolPolicy(endpoint: string): ProtocolManifestEntry {
  const policy = POLICY_BY_ENDPOINT.get(endpoint);
  if (!policy) {
    throw new Error(`Unknown plugin endpoint "${endpoint}". Add an explicit protocol policy before dispatch.`);
  }
  return policy;
}

export function normalizeProtocolPluginVariant(value: string): ProtocolPluginVariant | undefined {
  if (value === 'main' || value === 'full') return 'main';
  if (value === 'inspector') return 'inspector';
  return undefined;
}

export function pluginVariantSupportsEndpoint(endpoint: string, pluginVariant: string): boolean {
  const normalized = normalizeProtocolPluginVariant(pluginVariant);
  return normalized !== undefined && protocolPolicy(endpoint).pluginVariants.includes(normalized);
}
