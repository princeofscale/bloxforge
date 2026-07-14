import { BridgeService, PluginInstance, RequestOutcomeUnknownError, RequestStatus, resolveRequestTimeout } from './bridge-service.js';
import { randomUUID } from 'node:crypto';

export class ProxyBridgeService extends BridgeService {
  private primaryBaseUrl: string;
  readonly proxyInstanceId: string;
  private cachedInstances: PluginInstance[] = [];
  private refreshTimer?: ReturnType<typeof setInterval>;
  private static REFRESH_INTERVAL_MS = 1000;

  constructor(primaryBaseUrl: string) {
    super('');
    this.primaryBaseUrl = primaryBaseUrl;
    this.proxyInstanceId = randomUUID();
    // Mirror the primary's peer list locally so getInstances() / resolveTarget
    // see real data. Without this, anything that enumerates peers from a
    // proxy-mode subprocess (target=all fanout, get_connected_instances)
    // sees the proxy's own empty instances Map and returns nothing.
    this.refreshInstances();
    this.refreshTimer = setInterval(
      () => this.refreshInstances(),
      ProxyBridgeService.REFRESH_INTERVAL_MS,
    );
  }

  private async refreshInstances(): Promise<void> {
    try {
      const res = await fetch(`${this.primaryBaseUrl}/instances`);
      if (!res.ok) return;
      const body = (await res.json()) as { instances?: PluginInstance[] };
      if (Array.isArray(body.instances)) {
        this.cachedInstances = body.instances;
      }
    } catch {
      // Primary unreachable — keep the last-known list rather than
      // silently reporting empty.
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
  }

  override async sendRequest(
    endpoint: string,
    data: any,
    targetInstanceId: string,
    targetRole: string,
  ): Promise<any> {
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      resolveRequestTimeout(endpoint, this.requestTimeout),
    );

    try {
      const response = await fetch(`${this.primaryBaseUrl}/proxy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
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
        throw new Error('Proxy request timeout');
      }
      throw err;
    }
  }

  override async lookupRequestStatus(requestId: string): Promise<(RequestStatus & { requestId: string }) | undefined> {
    try {
      const response = await fetch(`${this.primaryBaseUrl}/request/${encodeURIComponent(requestId)}/status`);
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
      headers: { 'Content-Type': 'application/json' },
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
