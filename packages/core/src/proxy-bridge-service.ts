import { BridgeService, PluginInstance, RequestOutcomeUnknownError, RequestStatus, resolveRequestTimeout } from './bridge-service.js';
import { randomUUID } from 'node:crypto';
import { protocolPolicy } from './protocol-manifest.js';

export class ProxyBridgeService extends BridgeService {
  private primaryBaseUrl: string;
  readonly proxyInstanceId: string;
  private cachedInstances: PluginInstance[] = [];
  private refreshTimer?: ReturnType<typeof setInterval>;
  private refreshController?: AbortController;
  private refreshing = false;
  private lastSuccessfulRefresh = 0;
  private readonly sessionToken: string;
  private static REFRESH_INTERVAL_MS = 1000;
  private static REFRESH_TIMEOUT_MS = 3000;
  private static CACHE_MAX_AGE_MS = 10000;

  constructor(primaryBaseUrl: string, sessionToken = process.env.BLOXFORGE_SESSION_TOKEN?.trim() ?? '') {
    super('');
    this.primaryBaseUrl = primaryBaseUrl;
    this.sessionToken = sessionToken;
    this.proxyInstanceId = randomUUID();
    // Mirror the primary's peer list locally so getInstances() / resolveTarget
    // see real data. Without this, anything that enumerates peers from a
    // proxy-mode subprocess (target=all fanout, get_connected_instances)
    // sees the proxy's own empty instances Map and returns nothing.
    void this.refreshInstances();
    this.refreshTimer = setInterval(
      () => void this.refreshInstances(),
      ProxyBridgeService.REFRESH_INTERVAL_MS,
    );
  }

  private headers(json = false): Record<string, string> {
    return {
      ...(json ? { 'Content-Type': 'application/json' } : {}),
      ...(this.sessionToken ? { Authorization: `Bearer ${this.sessionToken}` } : {}),
    };
  }

  private async refreshInstances(): Promise<void> {
    if (this.refreshing) return;
    this.refreshing = true;
    const controller = new AbortController();
    this.refreshController = controller;
    const timeoutId = setTimeout(() => controller.abort(), ProxyBridgeService.REFRESH_TIMEOUT_MS);
    try {
      const res = await fetch(`${this.primaryBaseUrl}/instances`, {
        headers: this.headers(),
        signal: controller.signal,
      });
      if (!res.ok) return;
      const body = (await res.json()) as { instances?: PluginInstance[] };
      if (Array.isArray(body.instances)) {
        this.cachedInstances = body.instances;
        this.lastSuccessfulRefresh = Date.now();
      }
    } catch {
      // Primary unreachable — keep the last-known list rather than
      // silently reporting empty.
    } finally {
      clearTimeout(timeoutId);
      if (this.refreshController === controller) this.refreshController = undefined;
      this.refreshing = false;
      if (
        this.lastSuccessfulRefresh > 0 &&
        Date.now() - this.lastSuccessfulRefresh > ProxyBridgeService.CACHE_MAX_AGE_MS
      ) {
        this.cachedInstances = [];
      }
    }
  }

  override getInstances(): PluginInstance[] {
    return this.cachedInstances;
  }

  /** Called when this proxy is being discarded (e.g. promotion to primary
      replaced it). Stops the background refresh so it doesn't leak. */
  stop(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = undefined;
    }
    this.refreshController?.abort();
    this.refreshController = undefined;
  }

  override getTransportDiagnostics() {
    return {
      ...super.getTransportDiagnostics(),
      proxyCache: {
        stale:
          this.lastSuccessfulRefresh === 0 ||
          Date.now() - this.lastSuccessfulRefresh > ProxyBridgeService.REFRESH_INTERVAL_MS * 2,
        refreshing: this.refreshing,
        lastSuccessfulRefresh: this.lastSuccessfulRefresh || undefined,
      },
    };
  }

  override async sendRequest(
    endpoint: string,
    data: any,
    targetInstanceId: string,
    targetRole: string,
  ): Promise<any> {
    const requestId = randomUUID();
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      resolveRequestTimeout(endpoint, this.requestTimeout),
    );

    try {
      const response = await fetch(`${this.primaryBaseUrl}/proxy`, {
        method: 'POST',
        headers: this.headers(true),
        body: JSON.stringify({
          requestId,
          endpoint,
          data,
          targetInstanceId,
          targetRole,
          proxyInstanceId: this.proxyInstanceId,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const body = await response.json().catch(() => undefined) as { error?: string; outcome?: string; requestId?: string } | undefined;
        if (body?.outcome === 'unknown' && body.requestId) {
          throw new RequestOutcomeUnknownError(
            body.requestId,
            endpoint,
            resolveRequestTimeout(endpoint, this.requestTimeout),
          );
        }
        throw new Error(`Proxy request failed (${response.status}): ${body?.error ?? 'Unknown error'}`);
      }

      const result = await response.json() as { response?: any; error?: string };
      if (result.error) {
        throw new Error(result.error);
      }
      return result.response;
    } catch (err: any) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') {
        if (protocolPolicy(endpoint).mode === 'mutation') {
          throw new RequestOutcomeUnknownError(
            requestId,
            endpoint,
            resolveRequestTimeout(endpoint, this.requestTimeout),
          );
        }
        throw new Error('Proxy request timeout');
      }
      throw err;
    }
  }

  override async lookupRequestStatus(requestId: string): Promise<(RequestStatus & { requestId: string }) | undefined> {
    try {
      const response = await fetch(`${this.primaryBaseUrl}/request/${encodeURIComponent(requestId)}/status`, {
        headers: this.headers(),
      });
      if (response.status === 404) return undefined;
      if (!response.ok) throw new Error(`Request status lookup failed (${response.status})`);
      return response.json() as Promise<RequestStatus & { requestId: string }>;
    } catch {
      return undefined;
    }
  }

  override async requestCancellation(requestId: string): Promise<boolean> {
    const response = await fetch(`${this.primaryBaseUrl}/cancel`, {
      method: 'POST',
      headers: this.headers(true),
      body: JSON.stringify({ requestId }),
    });
    return response.ok;
  }

  override cleanupOldRequests(): void {
    // No-op: primary bridge owns the pending request state
  }

  override clearAllPendingRequests(): void {
    // No-op: primary bridge owns the pending request state
  }
}
