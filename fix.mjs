import fs from 'fs';

let content = fs.readFileSync('packages/core/src/bridge-service.ts', 'utf8');

content = content.replace(/  private requestNotifiers = new Set<\(pluginSessionId: string\) => void>\(\);\n  private recentDisconnects: PluginDisconnect\[\] = \[\];\n  private requestTimeout = envRequestTimeout\(\);\n  \/\/ Configurable per-instance so tests can exercise cleanupStaleInstances\(\)\n  \/\/ with a small TTL without depending on wall-clock env vars\. Production\n  \/\/ callers leave this at the module-level STALE_INSTANCE_MS default\.\n  staleInstanceMs = STALE_INSTANCE_MS;\n\n  serverEpoch = randomUUID\(\);\n  private journal: RequestJournal;\n  private requestStatuses = new Map<string, { state: string, serverEpoch: string, deliveryAttempt: number, updatedAt: number, response\?: any, error\?: any }>\(\);\n  private sessionTokens = new Map<string, string>\(\); \/\/ sessionToken -> pluginSessionId\n/, '');

content = content.replace(/      return {\n        requestId: oldestRequest\.id,\n        serverEpoch: this\.serverEpoch,\n        request: {/g, "      return {\n        requestId: oldestRequest.id,\n        serverEpoch: this.serverEpoch,\n        pluginSessionId: pluginSessionId ?? '',\n        deliveryAttempt: oldestRequest.deliveryAttempt,\n        leaseToken: randomUUID(),\n        request: {");

content = content.replace(/    return this\.getPendingRequest\(instance\.instanceId, instance\.role\);\n    return this\.getPendingRequest\(instance\.instanceId, instance\.role, pluginSessionId\);/g, "    return this.getPendingRequest(instance.instanceId, instance.role, pluginSessionId);");

fs.writeFileSync('packages/core/src/bridge-service.ts', content);
