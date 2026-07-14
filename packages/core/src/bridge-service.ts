import { randomUUID } from 'node:crypto';
import { RequestJournal, CompletionReceipt, defaultRequestJournalPath } from './request-journal.js';

export interface PluginInstance {
  // Internal: per-plugin GUID, regenerated on every plugin load.
  // Used as the /poll URL parameter so the server can identify which plugin
  // process is asking for work. Not user-facing — MCP tools and the LLM
  // operate on `instanceId` (the place identifier) plus `role`.
  pluginSessionId: string;
  // User-facing routing key: identifies the place file.
  // Format: "place:${PlaceId}" for published places, "anon:${uuid}" for
  // unpublished places (where the UUID lives on ServerStorage's
  // __MCPPlaceId attribute and travels with the .rbxl).
  instanceId: string;
  role: string;
  placeId: number;
  placeName: string;
  dataModelName: string;
  isRunning: boolean;
  pluginVersion: string;
  pluginVariant: string;
  pluginProtocolVersion: number;
  serverVersion: string;
  serverProtocolVersion: number;
  versionMismatch: boolean;
  protocolMismatch: boolean;
  lastActivity: number;
  connectedAt: number;
}

interface PendingRequest {
  id: string;
  endpoint: string;
  data: any;
  targetInstanceId: string;
  targetRole: string;
  timestamp: number;
  inFlight: boolean;
  assignedPluginSessionId?: string;
  cancellationRequested?: boolean;
  deliveryAttempt?: number;
  resolve: (value: any) => void;
  reject: (error: any) => void;
  timeoutId: ReturnType<typeof setTimeout>;
}

export type RoutingErrorCode =
  | 'multiple_instances_connected'
  | 'ambiguous_target'
  | 'target_role_required'
  | 'target_role_not_present_on_instance'
  | 'unrecognized_instance_id';

export interface RoutingError {
  code: RoutingErrorCode;
  message: string;
  data: { instances: PublicPluginInstance[]; count: number };
}

// Thrown by tools when resolveTarget returns an error. Caught at the MCP
// transport layer and surfaced as a structured tool-call error so the LLM
// can recover (e.g. pick an instance_id from data.instances) without an
// extra get_connected_instances round-trip.
export class RoutingFailure extends Error {
  readonly routingError: RoutingError;
  constructor(routingError: RoutingError) {
    super(routingError.message);
    this.name = 'RoutingFailure';
    this.routingError = routingError;
  }
}

// Shape exposed to MCP tool callers — strips the internal pluginSessionId.
export interface PublicPluginInstance {
  instanceId: string;
  role: string;
  placeId: number;
  placeName: string;
  dataModelName: string;
  isRunning: boolean;
  pluginVersion: string;
  pluginVariant: string;
  pluginProtocolVersion: number;
  serverVersion: string;
  serverProtocolVersion: number;
  versionMismatch: boolean;
  protocolMismatch: boolean;
  lastActivity: number;
  connectedAt: number;
}

export interface PluginDisconnect {
  pluginSessionId: string;
  instanceId: string;
  role: string;
  reason: 'plugin_request' | 'stale_timeout' | 'unknown';
  disconnectedAt: number;
  lastActivity: number;
}

export type RequestState = 'queued' | 'delivered' | 'started' | 'completed' | 'failed' | 'timed_out' | 'cancelled' | 'outcome_unknown';
export interface RequestStatus {
  state: RequestState;
  serverEpoch: string;
  deliveryAttempt: number;
  leaseToken?: string;
  updatedAt: number;
  response?: any;
  error?: any;
}

export interface RequestFence {
  serverEpoch: string;
  pluginSessionId: string;
  deliveryAttempt: number;
  leaseToken: string;
}

export class RequestOutcomeUnknownError extends Error {
  outcome = 'unknown';
  constructor(public requestId: string, endpoint: string, timeout: number) {
    super(`Request timeout after ${timeout}ms on ${endpoint}. Request ${requestId} outcome unknown. The plugin may still be running heavy code — the work can succeed even though this call gave up.`);
    this.name = 'RequestOutcomeUnknownError';
  }
}

export class BridgeBusyError extends Error {
  public code = 'BUSY';
  constructor(public retryAfterMs?: number) {
    super(retryAfterMs ? `Bridge is busy, retry after ${retryAfterMs}ms` : 'Bridge is busy');
    this.name = 'BridgeBusyError';
  }
}

export interface ResolveTargetInput {
  instance_id?: string;
  target?: string;
}

export type ResolveTargetResult =
  | { ok: true; mode: 'single'; targetInstanceId: string; targetRole: string }
  | { ok: true; mode: 'fanout'; targets: { targetInstanceId: string; targetRole: string }[] }
  | { ok: false; error: RoutingError };

export interface RegisterInstanceInput {
  pluginSessionId: string;
  instanceId: string;
  role: string;
  placeId?: number;
  placeName?: string;
  dataModelName?: string;
  isRunning?: boolean;
  pluginVersion?: string;
  pluginVariant?: string;
  protocolVersion?: number;
  serverVersion?: string;
  serverProtocolVersion?: number;
}

export type RegisterInstanceResult =
  | { ok: true; assignedRole: string; instanceId: string; sessionToken: string }
  | { ok: false; error: { code: 'duplicate_instance_role'; message: string; existing: PublicPluginInstance } };

export function toPublic(inst: PluginInstance): PublicPluginInstance {
  return {
    instanceId: inst.instanceId,
    role: inst.role,
    placeId: inst.placeId,
    placeName: inst.placeName,
    dataModelName: inst.dataModelName,
    isRunning: inst.isRunning,
    pluginVersion: inst.pluginVersion,
    pluginVariant: inst.pluginVariant,
    pluginProtocolVersion: inst.pluginProtocolVersion,
    serverVersion: inst.serverVersion,
    serverProtocolVersion: inst.serverProtocolVersion,
    versionMismatch: inst.versionMismatch,
    protocolMismatch: inst.protocolMismatch,
    lastActivity: inst.lastActivity,
    connectedAt: inst.connectedAt,
  };
}

export const MCP_PROTOCOL_VERSION = 3;

// Grace period before a silent plugin (no /poll) is reaped. Polls run every
// ~0.5s, so 30s was the historical floor, but Roblox Studio throttles
// HttpService.RequestAsync when its window is backgrounded/minimized or while
// it is busy with heavy work — easily producing a >30s poll gap. That made the
// bridge "drop" during Studio backgrounding, failing in-flight tool calls with
// "disconnected". 90s keeps the reaping intent (truly dead plugins go away)
// while tolerating Studio throttling gaps. Tune via MCP_STALE_INSTANCE_MS.
const STALE_INSTANCE_MS = envStaleInstanceMs();
const INSTANCE_ALIAS_TTL_MS = 5 * 60 * 1000;

// Base bridge request timeout. Heavy plugin work (big execute-luau scripts that
// build/scatter hundreds of parts) routinely runs longer than the default, which
// caused false "Request timeout" errors even though the plugin was still working
// (bug B4). Configurable via MCP_REQUEST_TIMEOUT_MS; heavy endpoints get a higher
// floor via resolveRequestTimeout.
const DEFAULT_REQUEST_TIMEOUT_MS = 30000;
const HEAVY_REQUEST_TIMEOUT_FLOOR_MS = 120000;
// Endpoints whose plugin-side work can legitimately take a long time.
const HEAVY_ENDPOINTS = ['/api/execute-luau', '/api/generate-build', '/api/import-scene'];

export function resolveRequestTimeout(endpoint: string, baseMs: number): number {
  if (HEAVY_ENDPOINTS.some((e) => endpoint.startsWith(e))) {
    return Math.max(baseMs, HEAVY_REQUEST_TIMEOUT_FLOOR_MS);
  }
  return baseMs;
}

function envRequestTimeout(): number {
  const raw = Number(process.env.MCP_REQUEST_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_REQUEST_TIMEOUT_MS;
}

function envStaleInstanceMs(): number {
  const raw = Number(process.env.MCP_STALE_INSTANCE_MS);
  if (Number.isFinite(raw) && raw > 0) return raw;
  return 90000;
}

interface InstanceAlias {
  targetInstanceId: string;
  lastSeen: number;
}

function publishedInstanceId(placeId: number | undefined): string | undefined {
  if (placeId === undefined || !Number.isFinite(placeId) || placeId <= 0) return undefined;
  return `place:${Math.trunc(placeId)}`;
}

export class BridgeService {
  private pendingRequests: Map<string, PendingRequest> = new Map();
  // Keyed by pluginSessionId (the per-plugin GUID).
  private instances: Map<string, PluginInstance> = new Map();
  private instanceAliases: Map<string, InstanceAlias> = new Map();

  private requestNotifiers = new Set<(pluginSessionId: string) => void>();
  private recentDisconnects: PluginDisconnect[] = [];
  protected requestTimeout = envRequestTimeout();
  // Configurable per-instance so tests can exercise cleanupStaleInstances()
  // with a small TTL without depending on wall-clock env vars. Production
  // callers leave this at the module-level STALE_INSTANCE_MS default.
  staleInstanceMs = STALE_INSTANCE_MS;

  serverEpoch = randomUUID();
  private journal!: RequestJournal;
  private requestStatuses = new Map<string, RequestStatus>();
  private sessionTokens = new Map<string, string>(); // sessionToken -> pluginSessionId

  private transportCounters = {
    completed: 0,
    outcomeUnknown: 0,
    deliveryRetries: 0,
    cancelled: 0,
    timeouts: 0,
  };
  private transportLatencies: number[] = [];

  constructor(journal?: RequestJournal | string) {
    if (typeof journal === 'string') {
      this.journal = new RequestJournal(journal);
    } else if (journal) {
      this.journal = journal;
    } else {
      const path = defaultRequestJournalPath();
      if (path) this.journal = new RequestJournal(path);
    }
    
    if (this.journal) {
      try {
        const snapshot = this.journal.load();
        if (snapshot) {
          const { statuses, pending } = snapshot;
          for (const s of statuses) {
            if (s.state === 'delivered' || s.state === 'started') {
              s.state = 'outcome_unknown';
              s.updatedAt = Date.now();
            }
            this.requestStatuses.set(s.requestId, s);
          }
          for (const p of pending) {
            if (p.state !== 'queued') continue;
            this.pendingRequests.set(p.id, {
              id: p.id,
              endpoint: p.endpoint,
              data: p.data,
              targetInstanceId: p.targetInstanceId,
              targetRole: p.targetRole,
              timestamp: p.timestamp,
              inFlight: false,
              deliveryAttempt: p.deliveryAttempt,
              resolve: () => {},
              reject: () => {},
              timeoutId: setTimeout(() => {}, 0) as any,
            } as PendingRequest);
          }
        }
      } catch (e) {
        // Journal might be empty or invalid
      }
    }
  }

  enableJournal() {
    const path = defaultRequestJournalPath();
    if (path) this.journal = new RequestJournal(path);
  }

  private persistJournal() {
    if (!this.journal) return;
    this.journal.save(
      Array.from(this.requestStatuses.entries()).map(([id, s]) => ({ requestId: id, ...s })),
      Array.from(this.pendingRequests.values()).map(req => ({
        id: req.id,
        endpoint: req.endpoint,
        data: req.data,
        targetInstanceId: req.targetInstanceId,
        targetRole: req.targetRole,
        timestamp: req.timestamp,
        state: (this.requestStatuses.get(req.id)?.state as Extract<RequestState, 'queued' | 'delivered' | 'started'>) ?? 'queued',
        deliveryAttempt: req.deliveryAttempt ?? 0,
      })),
      []
    );
  }

  private updateRequestStatus(requestId: string, status: Partial<typeof this.requestStatuses extends Map<any, infer V> ? V : never>) {
    const existing = this.requestStatuses.get(requestId) ?? { state: 'queued', serverEpoch: this.serverEpoch, deliveryAttempt: 0, updatedAt: Date.now() };
    this.requestStatuses.set(requestId, { ...existing, ...status, updatedAt: Date.now() });
  }

  private canonicalInstanceId(instanceId: string, placeId?: number): string {
    return publishedInstanceId(placeId) ?? instanceId;
  }

  private rememberInstanceAlias(aliasInstanceId: string, targetInstanceId: string) {
    if (aliasInstanceId === targetInstanceId) return;
    this.instanceAliases.set(aliasInstanceId, {
      targetInstanceId,
      lastSeen: Date.now(),
    });
  }

  private resolveInstanceAlias(instanceId: string): string {
    const alias = this.instanceAliases.get(instanceId);
    if (!alias) return instanceId;
    alias.lastSeen = Date.now();
    return alias.targetInstanceId;
  }

  private migratePendingRequests(fromInstanceId: string, toInstanceId: string) {
    if (fromInstanceId === toInstanceId) return;
    for (const request of this.pendingRequests.values()) {
      if (request.targetInstanceId === fromInstanceId) {
        request.targetInstanceId = toInstanceId;
      }
    }
  }

  private cleanupStaleAliases(now = Date.now()) {
    for (const [alias, entry] of this.instanceAliases.entries()) {
      const targetIsLive = this.getInstances().some((inst) => inst.instanceId === entry.targetInstanceId);
      if (!targetIsLive && now - entry.lastSeen > INSTANCE_ALIAS_TTL_MS) {
        this.instanceAliases.delete(alias);
      }
    }
  }

  private routingKeyForInstance(inst: PluginInstance): string {
    return publishedInstanceId(inst.placeId) ?? this.resolveInstanceAlias(inst.instanceId);
  }

  private matchingInstancesForInstanceId(instanceId: string): PluginInstance[] {
    const resolvedInstanceId = this.resolveInstanceAlias(instanceId);
    const ids = new Set<string>([instanceId, resolvedInstanceId]);
    const placeIds = new Set<number>();
    const addPlaceId = (placeId: number | undefined) => {
      const published = publishedInstanceId(placeId);
      if (!published || placeId === undefined) return;
      ids.add(published);
      placeIds.add(Math.trunc(placeId));
    };

    const placeMatch = resolvedInstanceId.match(/^place:(\d+)$/) ?? instanceId.match(/^place:(\d+)$/);
    if (placeMatch) addPlaceId(Number(placeMatch[1]));

    for (const inst of this.getInstances()) {
      if (ids.has(inst.instanceId)) addPlaceId(inst.placeId);
    }

    return this.getInstances().filter(
      (inst) => ids.has(inst.instanceId) || (inst.placeId > 0 && placeIds.has(Math.trunc(inst.placeId))),
    );
  }

  resolveInstanceId(instanceId: string): string {
    return this.resolveInstanceAlias(instanceId);
  }

  registerInstance(input: RegisterInstanceInput): RegisterInstanceResult {
    const { pluginSessionId, role } = input;
    const rawInstanceId = input.instanceId;
    const instanceId = this.canonicalInstanceId(rawInstanceId, input.placeId);
    const prior = this.instances.get(pluginSessionId);
    let assignedRole = role;
    const pluginVersion = input.pluginVersion ?? '';
    const pluginVariant = input.pluginVariant ?? 'unknown';
    const pluginProtocolVersion = Number.isFinite(input.protocolVersion) ? Number(input.protocolVersion) : 0;
    const serverVersion = input.serverVersion ?? '';
    const serverProtocolVersion = Number.isFinite(input.serverProtocolVersion) ? Number(input.serverProtocolVersion) : MCP_PROTOCOL_VERSION;
    const versionMismatch = pluginVersion !== '' && serverVersion !== '' && pluginVersion !== serverVersion;
    const protocolMismatch = pluginProtocolVersion !== serverProtocolVersion;

    this.rememberInstanceAlias(rawInstanceId, instanceId);
    if (prior && prior.instanceId !== instanceId) {
      this.rememberInstanceAlias(prior.instanceId, instanceId);
      this.migratePendingRequests(prior.instanceId, instanceId);
    }

    // Client roles get lowest-unused-N, scoped per place. That keeps
    // target=client-1 intuitive when several Studio places are connected:
    // client-1 always means the first client for the selected instance_id.
    if (role === 'client') {
      if (prior && prior.role.match(/^client-\d+$/)) {
        assignedRole = prior.role;
      } else {
        const used = new Set<number>();
        for (const inst of this.instances.values()) {
          if (inst.instanceId !== instanceId || inst.pluginSessionId === pluginSessionId) continue;
          const match = inst.role.match(/^client-(\d+)$/);
          if (match) used.add(Number(match[1]));
        }
        let idx = 1;
        while (used.has(idx)) idx++;
        assignedRole = `client-${idx}`;
      }
    }

    // Reject duplicate (instanceId, role) tuples. This should not be
    // reachable through normal Studio + Team Create usage, but defense in
    // depth: surface it loudly rather than silently misrouting.
    const existing = Array.from(this.instances.values()).find(
      (i) => i.instanceId === instanceId && i.role === assignedRole && i.pluginSessionId !== pluginSessionId,
    );
    if (existing) {
      return {
        ok: false,
        error: {
          code: 'duplicate_instance_role',
          message: `Another plugin is already registered as (${instanceId}, ${assignedRole}).`,
          existing: toPublic(existing),
        },
      };
    }

    this.instances.set(pluginSessionId, {
      pluginSessionId,
      instanceId,
      role: assignedRole,
      placeId: input.placeId ?? 0,
      placeName: input.placeName ?? '',
      dataModelName: input.dataModelName ?? '',
      isRunning: input.isRunning ?? false,
      pluginVersion,
      pluginVariant,
      pluginProtocolVersion,
      serverVersion,
      serverProtocolVersion,
      versionMismatch,
      protocolMismatch,
      lastActivity: Date.now(),
      connectedAt: prior?.connectedAt ?? Date.now(),
    });

    const sessionToken = randomUUID();
    this.sessionTokens.set(sessionToken, pluginSessionId);

    return { ok: true, assignedRole, instanceId, sessionToken };
  }

  authenticatePlugin(pluginSessionId: string, sessionToken: string): boolean {
    const expectedId = this.sessionTokens.get(sessionToken);
    return expectedId === pluginSessionId;
  }

  unregisterInstance(pluginSessionId: string, reason: PluginDisconnect['reason'] = 'unknown') {
    const instance = this.instances.get(pluginSessionId);
    if (!instance) return;

    this.instances.delete(pluginSessionId);
    
    this.recentDisconnects.push({
      pluginSessionId,
      instanceId: instance.instanceId,
      role: instance.role,
      reason,
      disconnectedAt: Date.now(),
      lastActivity: instance.lastActivity,
    });
    if (this.recentDisconnects.length > 50) this.recentDisconnects.shift();

    for (const [id, request] of this.pendingRequests.entries()) {
      const stillHasHandler = Array.from(this.instances.values()).some(
        (i) => i.instanceId === request.targetInstanceId && i.role === request.targetRole,
      );
      
      const status = this.requestStatuses.get(id);
      const wasAssignedToThis = request.assignedPluginSessionId === pluginSessionId;
      
      if (!stillHasHandler) {
        clearTimeout(request.timeoutId);
        this.pendingRequests.delete(id);
        if (status?.state === 'delivered' || status?.state === 'started') {
          this.updateRequestStatus(id, { state: 'outcome_unknown' });
          request.reject(new RequestOutcomeUnknownError(id, request.endpoint, this.requestTimeout));
        } else {
          this.updateRequestStatus(id, { state: 'failed', error: 'Target disconnected' });
          request.reject(new Error(`Target (${request.targetInstanceId}, ${request.targetRole}) disconnected`));
        }
      } else {
        if (wasAssignedToThis && (status?.state === 'delivered' || status?.state === 'started')) {
          clearTimeout(request.timeoutId);
          this.pendingRequests.delete(id);
          this.updateRequestStatus(id, { state: 'outcome_unknown' });
          request.reject(new RequestOutcomeUnknownError(id, request.endpoint, this.requestTimeout));
        }
      }
    }
    this.persistJournal();
  }

  getInstances(): PluginInstance[] {
    return Array.from(this.instances.values());
  }

  getPublicInstances(): PublicPluginInstance[] {
    return this.getInstances().map(toPublic);
  }

  getRecentDisconnects(): PluginDisconnect[] {
    return [...this.recentDisconnects];
  }

  getInstanceBySessionId(pluginSessionId: string): PluginInstance | undefined {
    return this.instances.get(pluginSessionId);
  }

  getPendingRequestCount(): number {
    return this.pendingRequests.size;
  }

  setRequestNotifier(notifier: ((pluginSessionId: string) => void) | undefined) {
    this.requestNotifiers.clear();
    if (notifier) this.requestNotifiers.add(notifier);
  }

  addRequestNotifier(notifier: (pluginSessionId: string) => void): () => void {
    this.requestNotifiers.add(notifier);
    return () => this.requestNotifiers.delete(notifier);
  }

  updateInstanceActivity(pluginSessionId: string) {
    const inst = this.instances.get(pluginSessionId);
    if (inst) {
      inst.lastActivity = Date.now();
    }
  }

  updateInstanceMetadata(pluginSessionId: string, metadata: Partial<Pick<PluginInstance, 'placeId' | 'placeName' | 'dataModelName' | 'isRunning'>>) {
    const inst = this.instances.get(pluginSessionId);
    if (!inst) return;
    const priorInstanceId = inst.instanceId;
    if (metadata.placeId !== undefined) inst.placeId = metadata.placeId;
    if (metadata.placeName !== undefined) inst.placeName = metadata.placeName;
    if (metadata.dataModelName !== undefined) inst.dataModelName = metadata.dataModelName;
    if (metadata.isRunning !== undefined) inst.isRunning = metadata.isRunning;
    const canonicalInstanceId = this.canonicalInstanceId(inst.instanceId, inst.placeId);
    if (canonicalInstanceId !== inst.instanceId) {
      const duplicate = Array.from(this.instances.values()).find(
        (other) =>
          other.pluginSessionId !== pluginSessionId &&
          other.instanceId === canonicalInstanceId &&
          other.role === inst.role,
      );
      if (!duplicate) {
        this.rememberInstanceAlias(priorInstanceId, canonicalInstanceId);
        this.migratePendingRequests(priorInstanceId, canonicalInstanceId);
        inst.instanceId = canonicalInstanceId;
      }
    }
  }

  async lookupRequestStatus(requestId: string): Promise<(RequestStatus & { requestId: string }) | undefined> {
    const status = this.requestStatuses.get(requestId);
    if (!status) return undefined;
    return { requestId, ...status };
  }

  getRequestStatus(requestId: string): (RequestStatus & { requestId: string }) | undefined {
    const status = this.requestStatuses.get(requestId);
    if (!status) return undefined;
    return { requestId, ...status };
  }

  getTransportDiagnostics() {
    return {
      completed: this.transportCounters.completed,
      queueDepth: this.pendingRequests.size,
      deliveryRetries: this.transportCounters.deliveryRetries,
      timeouts: this.transportCounters.timeouts,
      outcomeUnknown: this.transportCounters.outcomeUnknown,
      cancelled: this.transportCounters.cancelled,
      averageLatencyMs:
        this.transportLatencies.length > 0
          ? this.transportLatencies.reduce((a, b) => a + b, 0) / this.transportLatencies.length
          : 0,
    };
  }

  cleanupStaleInstances() {
    const now = Date.now();
    for (const [id, inst] of this.instances.entries()) {
      if (now - inst.lastActivity > this.staleInstanceMs) {
        this.unregisterInstance(id, 'stale_timeout');
      }
    }
    this.cleanupStaleAliases(now);
  }

  getEquivalentInstanceIds(instanceId: string): string[] {
    const resolvedInstanceId = this.resolveInstanceAlias(instanceId);
    const ids = new Set<string>([instanceId, resolvedInstanceId]);
    const placeIds = new Set<number>();

    const addPlaceId = (placeId: number | undefined) => {
      const published = publishedInstanceId(placeId);
      if (!published || placeId === undefined) return;
      ids.add(published);
      placeIds.add(Math.trunc(placeId));
    };

    const placeMatch = resolvedInstanceId.match(/^place:(\d+)$/) ?? instanceId.match(/^place:(\d+)$/);
    if (placeMatch) addPlaceId(Number(placeMatch[1]));

    for (const inst of this.getInstances()) {
      if (ids.has(inst.instanceId)) {
        addPlaceId(inst.placeId);
      }
    }

    for (const inst of this.getInstances()) {
      if (inst.placeId > 0 && placeIds.has(Math.trunc(inst.placeId))) {
        ids.add(inst.instanceId);
      }
    }

    for (const [alias, entry] of this.instanceAliases.entries()) {
      if (ids.has(entry.targetInstanceId)) ids.add(alias);
    }

    return Array.from(ids);
  }

  // Resolves (instance_id, target-role) MCP arguments to a concrete
  // routing decision: either a single (instanceId, role) tuple or a fanout
  // list. Returns an error result with the full instance list embedded so
  // the caller (tool layer) can surface it without a second round-trip.
  resolveTarget(input: ResolveTargetInput): ResolveTargetResult {
    const instances = this.getInstances();
    const publicList = instances.map(toPublic);
    const errorData = { instances: publicList, count: publicList.length };

    const { instance_id, target } = input;
    const isFanout = target === 'all';
    const role = target && target !== 'all' ? target : undefined;

    // Case 1: instance_id provided
    if (instance_id !== undefined) {
      const matchingInstances = this.matchingInstancesForInstanceId(instance_id);
      if (matchingInstances.length === 0) {
        return {
          ok: false,
          error: {
            code: 'unrecognized_instance_id',
            message: `instance_id "${instance_id}" is not connected. Pass one from data.instances.`,
            data: errorData,
          },
        };
      }

      if (isFanout) {
        // Fan out across all roles of that instance (e.g. edit + server + client-N).
        return {
          ok: true,
          mode: 'fanout',
          targets: matchingInstances.map((i) => ({
            targetInstanceId: i.instanceId,
            targetRole: i.role,
          })),
        };
      }

      if (role) {
        const exact = matchingInstances.find((i) => i.role === role);
        if (!exact) {
          return {
            ok: false,
            error: {
              code: 'target_role_not_present_on_instance',
              message: `instance "${instance_id}" has no role "${role}". Available roles: ${matchingInstances.map((i) => i.role).join(', ')}.`,
              data: errorData,
            },
          };
        }
        return { ok: true, mode: 'single', targetInstanceId: exact.instanceId, targetRole: role };
      }

      // role omitted, instance_id provided
      if (matchingInstances.length === 1) {
        return {
          ok: true,
          mode: 'single',
          targetInstanceId: matchingInstances[0].instanceId,
          targetRole: matchingInstances[0].role,
        };
      }
      // Multiple roles for that instance — prefer edit if present.
      const edit = matchingInstances.find((i) => i.role === 'edit');
      if (edit) {
        return { ok: true, mode: 'single', targetInstanceId: edit.instanceId, targetRole: 'edit' };
      }
      return {
        ok: false,
        error: {
          code: 'target_role_required',
          message: `instance "${instance_id}" has multiple roles connected: ${matchingInstances.map((i) => i.role).join(', ')}. Pass target=<role>.`,
          data: errorData,
        },
      };
    }

    // Case 2: instance_id omitted — distinct instanceIds across connected plugins
    const distinctInstanceIds = new Set(instances.map((i) => this.routingKeyForInstance(i)));
    if (distinctInstanceIds.size === 0) {
      // No connected instances at all. Caller will hit a separate timeout/
      // not-connected error; return a clear routing error here too.
      return {
        ok: false,
        error: {
          code: 'unrecognized_instance_id',
          message: 'No Studio plugin is connected.',
          data: errorData,
        },
      };
    }
    if (distinctInstanceIds.size > 1) {
      const errorCode: RoutingErrorCode = role ? 'ambiguous_target' : 'multiple_instances_connected';
      const msg = role
        ? `target=${role} is ambiguous because multiple Studio places are connected. Pass instance_id to choose a place.`
        : 'Multiple Studio places are connected. Pass instance_id to disambiguate.';
      return { ok: false, error: { code: errorCode, message: msg, data: errorData } };
    }

    // Exactly one distinct instance_id connected. Apply role resolution
    // identically to the instance_id-provided path.
    const onlyInstanceId = distinctInstanceIds.values().next().value;
    return this.resolveTarget({ instance_id: onlyInstanceId, target });
  }

  async sendRequest(
    endpoint: string,
    data: any,
    targetInstanceId: string,
    targetRole: string,
  ): Promise<any> {
    const requestId = randomUUID();
    const effectiveTimeout = resolveRequestTimeout(endpoint, this.requestTimeout);

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        if (this.pendingRequests.has(requestId)) {
          this.pendingRequests.delete(requestId);
          this.updateRequestStatus(requestId, { state: 'outcome_unknown' });
          this.persistJournal();
          this.transportCounters.timeouts++;
          reject(new RequestOutcomeUnknownError(requestId, endpoint, effectiveTimeout));
        }
      }, effectiveTimeout);

      const request: PendingRequest = {
        id: requestId,
        endpoint,
        data,
        targetInstanceId,
        targetRole,
        timestamp: Date.now(),
        inFlight: false,
        resolve,
        reject,
        timeoutId,
      };

      this.pendingRequests.set(requestId, request);
      this.updateRequestStatus(requestId, { state: 'queued' });
      this.persistJournal();
      
      for (const instance of this.instances.values()) {
        if (instance.instanceId === targetInstanceId && instance.role === targetRole) {
          for (const notify of this.requestNotifiers) notify(instance.pluginSessionId);
        }
      }
    });
  }

  getPendingRequestForSession(
    pluginSessionId: string,
  ): ({ requestId: string; request: { endpoint: string; data: any } } & RequestFence) | null {
    const instance = this.instances.get(pluginSessionId);
    if (!instance) return null;
    this.updateInstanceActivity(pluginSessionId);
    return this.getPendingRequest(instance.instanceId, instance.role, pluginSessionId);
  }

  getPendingRequest(
    callerInstanceId: string,
    callerRole: string,
    pluginSessionId?: string,
  ): ({ requestId: string; request: { endpoint: string; data: any } } & RequestFence) | null {
    let inFlightMutations = 0;
    let inFlightReads = 0;
    for (const request of this.pendingRequests.values()) {
      if (request.targetInstanceId !== callerInstanceId) continue;
      if (request.targetRole !== callerRole) continue;

      const status = this.requestStatuses.get(request.id);
      if (request.inFlight && status?.state === 'delivered' && Date.now() - status.updatedAt >= 10000) {
        request.inFlight = false;
        this.updateRequestStatus(request.id, { state: 'queued' });
      }

      if (request.inFlight) {
        if (this.isMutation(request.endpoint)) inFlightMutations++;
        else inFlightReads++;
      }
    }

    let oldestRequest: PendingRequest | null = null;

    for (const request of this.pendingRequests.values()) {
      if (request.targetInstanceId !== callerInstanceId) continue;
      if (request.targetRole !== callerRole) continue;
      if (request.inFlight) continue;
      
      const isMutationReq = this.isMutation(request.endpoint);
      if (isMutationReq && inFlightMutations >= 1) continue;
      if (!isMutationReq && inFlightReads >= 4) continue;

      if (!oldestRequest || request.timestamp < oldestRequest.timestamp) {
        oldestRequest = request;
      }
    }

    if (oldestRequest) {
      oldestRequest.inFlight = true;
      oldestRequest.deliveryAttempt = (oldestRequest.deliveryAttempt ?? 0) + 1;
      oldestRequest.assignedPluginSessionId = pluginSessionId;
      const leaseToken = randomUUID();
      
      this.updateRequestStatus(oldestRequest.id, { 
        state: 'delivered', 
        serverEpoch: this.serverEpoch, 
        deliveryAttempt: oldestRequest.deliveryAttempt,
        leaseToken
      });
      this.persistJournal();

      return {
        requestId: oldestRequest.id,
        serverEpoch: this.serverEpoch,
        pluginSessionId: pluginSessionId ?? '',
        deliveryAttempt: oldestRequest.deliveryAttempt,
        leaseToken,
        request: {
          endpoint: oldestRequest.endpoint,
          data: oldestRequest.data,
        },
      };
    }

    return null;
  }

  releasePendingRequest(requestId: string) {
    const request = this.pendingRequests.get(requestId);
    if (request) {
      request.inFlight = false;
      this.updateRequestStatus(requestId, { state: 'queued' });
      this.persistJournal();
    }
  }

  releasePendingRequestsForSession(pluginSessionId: string) {
    const instance = this.instances.get(pluginSessionId);
    if (!instance) return;
    for (const request of this.pendingRequests.values()) {
      if (request.targetInstanceId === instance.instanceId && request.targetRole === instance.role) {
        request.inFlight = false;
        request.assignedPluginSessionId = undefined;
        this.updateRequestStatus(request.id, { state: 'queued' });
      }
    }
    this.persistJournal();
  }

  reconcilePluginReceipts(pluginSessionId: string, serverEpoch: string, receipts: CompletionReceipt[]): number {
    if (serverEpoch !== this.serverEpoch) return 0;
    
    const instance = this.instances.get(pluginSessionId);
    if (!instance) return 0;

    let reconciled = 0;
    for (const receipt of receipts) {
      const status = this.requestStatuses.get(receipt.requestId);
      if (status && status.state === 'outcome_unknown') {
        status.state = 'completed';
        status.updatedAt = receipt.completedAt || Date.now();
        status.response = { reconciled: true, digest: receipt.responseDigest };
        reconciled++;
      }
    }
    
    if (reconciled > 0) {
      this.persistJournal();
    }
    return reconciled;
  }

  acknowledgeRequest(requestId: string): boolean {
    const status = this.requestStatuses.get(requestId);
    if (!status) return false;
    this.updateRequestStatus(requestId, { state: 'started' });
    this.persistJournal();
    return true;
  }

  resolveRequest(requestId: string, response: any) {
    const request = this.pendingRequests.get(requestId);
    this.updateRequestStatus(requestId, { state: 'completed', response, error: undefined });
    this.transportCounters.completed++;
    if (request) {
      clearTimeout(request.timeoutId);
      this.pendingRequests.delete(requestId);
      request.resolve(response);
    }
    this.persistJournal();
  }

  rejectRequest(requestId: string, error: any) {
    const request = this.pendingRequests.get(requestId);
    this.updateRequestStatus(requestId, { state: 'failed', error });
    if (request) {
      clearTimeout(request.timeoutId);
      this.pendingRequests.delete(requestId);
      request.reject(error);
    }
    this.persistJournal();
  }

  resolveFencedRequest(requestId: string, response: any, fence: RequestFence): boolean {
    const status = this.requestStatuses.get(requestId);
    const pending = this.pendingRequests.get(requestId);
    if (!status || status.serverEpoch !== fence.serverEpoch || status.deliveryAttempt !== fence.deliveryAttempt || status.leaseToken !== fence.leaseToken || status.state === 'completed' || status.state === 'failed' || pending?.assignedPluginSessionId !== fence.pluginSessionId) return false;
    this.resolveRequest(requestId, response);
    return true;
  }

  rejectFencedRequest(requestId: string, error: any, fence: RequestFence): boolean {
    const status = this.requestStatuses.get(requestId);
    const pending = this.pendingRequests.get(requestId);
    if (!status || status.serverEpoch !== fence.serverEpoch || status.deliveryAttempt !== fence.deliveryAttempt || status.leaseToken !== fence.leaseToken || status.state === 'completed' || status.state === 'failed' || pending?.assignedPluginSessionId !== fence.pluginSessionId) return false;
    this.rejectRequest(requestId, error);
    return true;
  }

  acknowledgeFencedRequest(requestId: string, fence: RequestFence): boolean {
    const status = this.requestStatuses.get(requestId);
    const pending = this.pendingRequests.get(requestId);
    if (!status || status.serverEpoch !== fence.serverEpoch || status.deliveryAttempt !== fence.deliveryAttempt || status.leaseToken !== fence.leaseToken || status.state === 'completed' || status.state === 'failed' || pending?.assignedPluginSessionId !== fence.pluginSessionId) return false;
    return this.acknowledgeRequest(requestId);
  }

  cleanupOldRequests() {
    const now = Date.now();
    for (const [id, request] of this.pendingRequests.entries()) {
      if (now - request.timestamp > resolveRequestTimeout(request.endpoint, this.requestTimeout)) {
        clearTimeout(request.timeoutId);
        this.pendingRequests.delete(id);
        request.reject(new Error('Request timeout'));
      }
    }
  }

  clearAllPendingRequests() {
    for (const [, request] of this.pendingRequests.entries()) {
      clearTimeout(request.timeoutId);
      request.reject(new Error('Connection closed'));
    }
    this.pendingRequests.clear();
  }

  cancelRequest(requestId: string): boolean {
    const request = this.pendingRequests.get(requestId);
    if (!request) return false;
    
    const status = this.requestStatuses.get(requestId);
    if (status?.state === 'started') {
      return false;
    }

    clearTimeout(request.timeoutId);
    this.pendingRequests.delete(requestId);
    this.updateRequestStatus(requestId, { state: 'cancelled', error: 'Request cancelled before execution' });
    this.transportCounters.cancelled++;
    request.reject(new Error(`Request ${requestId} cancelled`));
    this.persistJournal();
    return true;
  }

  getCancellationEvents(pluginSessionId: string): string[] {
    const instance = this.instances.get(pluginSessionId);
    if (!instance) return [];
    
    const events: string[] = [];
    for (const request of this.pendingRequests.values()) {
      if (request.targetInstanceId === instance.instanceId &&
          request.targetRole === instance.role &&
          this.requestStatuses.get(request.id)?.state === 'started' &&
          request.cancellationRequested) {
        events.push(request.id);
      }
    }
    return events;
  }

  async requestCancellation(requestId: string): Promise<boolean> {
    const request = this.pendingRequests.get(requestId);
    if (!request) return false;
    
    const status = this.requestStatuses.get(requestId);
    if (status?.state === 'started') {
      request.cancellationRequested = true;
      return true;
    }
    return this.cancelRequest(requestId);
  }

  private isMutation(endpoint: string): boolean {
    return (
      !endpoint.startsWith('/api/read') &&
      !endpoint.startsWith('/api/get') &&
      !endpoint.startsWith('/api/search') &&
      endpoint !== '/api/evaluate' &&
      endpoint !== '/api/execute-script' &&
      endpoint !== '/api/run-code'
    );
  }
}
