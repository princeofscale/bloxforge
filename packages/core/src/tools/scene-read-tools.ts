// Scene-read tools, split out of the RobloxStudioTools monolith. These are the
// read-only inspection tools (file tree, place/services, instance properties /
// children, search, descendants, scene summary/analysis, memory breakdown,
// compare, selection). Most are thin `/api/*` calls through the shared single-
// target runtime; the multi-peer reads (memory breakdown, scene analysis) fan out
// across connected roles via the bridge. The facade delegates here with identical
// public signatures so the schema-parity invariants hold.

import { responseErrorCode } from '../errors.js';
import { compactText } from '../compact.js';
import { shapeListResponse } from '../response-shape.js';
import { buildSceneSummaryLuau } from '../builders/scene-summary.js';
import { BridgeService, RoutingFailure } from '../bridge-service.js';
import type { StudioHttpClient } from './studio-client.js';
import { sleep, type ToolContent } from './runtime-support.js';

type SceneReadRuntime = {
  callSingle(endpoint: string, data: unknown, target: string | undefined, instance_id: string | undefined): Promise<unknown>;
  runGeneratedLuau(code: string, instance_id?: string): Promise<{ content: ToolContent[] }>;
  bridge: BridgeService;
  client: StudioHttpClient;
};

export class SceneReadTools {
  constructor(private readonly runtime: SceneReadRuntime) {}

  async getFileTree(path: string = '', instance_id?: string) {
    const response = await this.runtime.callSingle('/api/file-tree', { path }, undefined, instance_id);
    return compactText(response);
  }

  async getPlaceInfo(instance_id?: string) {
    const response = await this.runtime.callSingle('/api/place-info', {}, undefined, instance_id);
    return { content: [{ type: 'text', text: JSON.stringify(response) }] };
  }

  async getServices(serviceName?: string, instance_id?: string) {
    const response = await this.runtime.callSingle('/api/services', { serviceName }, undefined, instance_id);
    return { content: [{ type: 'text', text: JSON.stringify(response) }] };
  }

  async searchObjects(query: string, searchType: string = 'name', propertyName?: string, limit?: number, offset?: number, fields?: string[], instance_id?: string) {
    const response = await this.runtime.callSingle('/api/search-objects', {
      query,
      searchType,
      propertyName,
    }, undefined, instance_id);
    return compactText(shapeListResponse(response, 'results', { limit, offset, fields }));
  }

  async getInstanceProperties(instancePath: string, excludeSource?: boolean, instance_id?: string) {
    if (!instancePath) {
      throw new Error('Instance path is required for get_instance_properties');
    }
    // Default to excluding Source: a script's Source can be thousands of tokens and
    // there's a dedicated get_script_source for reading it. Callers can opt back in
    // with excludeSource: false.
    const response = await this.runtime.callSingle('/api/instance-properties', { instancePath, excludeSource: excludeSource ?? true }, undefined, instance_id);
    return compactText(response);
  }

  async getInstanceChildren(instancePath: string, instance_id?: string) {
    if (!instancePath) {
      throw new Error('Instance path is required for get_instance_children');
    }
    // The plugin's file watcher debounces ~500ms behind edits, so a path that was
    // just created can briefly read back as NOT_FOUND (bug B3/B5). Retry once after
    // a short delay before surfacing the failure.
    let response = await this.runtime.callSingle('/api/instance-children', { instancePath }, undefined, instance_id);
    if (responseErrorCode(response) === 'NOT_FOUND') {
      await sleep(450);
      response = await this.runtime.callSingle('/api/instance-children', { instancePath }, undefined, instance_id);
    }
    return compactText(response);
  }

  async searchByProperty(propertyName: string, propertyValue: string, instance_id?: string) {
    if (!propertyName || !propertyValue) {
      throw new Error('Property name and value are required for search_by_property');
    }
    const response = await this.runtime.callSingle('/api/search-by-property', {
      propertyName,
      propertyValue,
    }, undefined, instance_id);
    return { content: [{ type: 'text', text: JSON.stringify(response) }] };
  }

  async getClassInfo(className: string, instance_id?: string) {
    if (!className) {
      throw new Error('Class name is required for get_class_info');
    }
    const response = await this.runtime.callSingle('/api/class-info', { className }, undefined, instance_id);
    return { content: [{ type: 'text', text: JSON.stringify(response) }] };
  }

  async getProjectStructure(path?: string, maxDepth?: number, scriptsOnly?: boolean, instance_id?: string) {
    const response = await this.runtime.callSingle('/api/project-structure', {
      path,
      maxDepth,
      scriptsOnly,
    }, undefined, instance_id);
    return compactText(response);
  }

  async getSelection(instance_id?: string) {
    const response = await this.runtime.callSingle('/api/get-selection', {}, undefined, instance_id);
    return compactText(response);
  }

  async getDescendants(
    instancePath: string,
    maxDepth?: number,
    classFilter?: string,
    limit?: number,
    offset?: number,
    fields?: string[],
    instance_id?: string,
  ) {
    if (!instancePath) {
      throw new Error('instancePath is required for get_descendants');
    }
    const response = await this.runtime.callSingle('/api/get-descendants', { instancePath, maxDepth, classFilter }, undefined, instance_id);
    return compactText(shapeListResponse(response, 'descendants', { limit, offset, fields }));
  }

  async getSceneSummary(instancePath?: string, topN?: number, instance_id?: string) {
    // Aggregation: counts descendants by class instead of dumping the whole tree —
    // a few tokens to understand a scene's shape vs thousands for get_descendants.
    const code = buildSceneSummaryLuau(instancePath ?? 'game.Workspace', topN ?? 20);
    return this.runtime.runGeneratedLuau(code, instance_id);
  }

  async compareInstances(instancePathA: string, instancePathB: string, instance_id?: string) {
    if (!instancePathA || !instancePathB) {
      throw new Error('instancePathA and instancePathB are required for compare_instances');
    }
    const response = await this.runtime.callSingle('/api/compare-instances', { instancePathA, instancePathB }, undefined, instance_id);
    return compactText(response);
  }

  async getMemoryBreakdown(target?: string, tags?: string[], instance_id?: string) {
    const tgt = target ?? 'all';
    const data: Record<string, unknown> = {};
    if (tags !== undefined) data.tags = tags;
    return this._fanOutRead('/api/get-memory-breakdown', data, tgt, instance_id);
  }

  async getSceneAnalysis(mode?: string, target?: string, topN?: number, raw?: boolean, instance_id?: string) {
    const tgt = target ?? 'all';
    const data: Record<string, unknown> = {};
    if (mode !== undefined) data.mode = mode;
    if (topN !== undefined) data.topN = topN;
    if (raw !== undefined) data.raw = raw;
    return this._fanOutRead('/api/get-scene-analysis', data, tgt, instance_id);
  }

  // Shared multi-peer read: single-target reads return the raw response; target=all
  // fans out across connected roles (skipping edit-proxy) and keys results by peer.
  private async _fanOutRead(endpoint: string, data: Record<string, unknown>, target: string, instance_id?: string) {
    const resolved = this.runtime.bridge.resolveTarget({ instance_id, target });
    if (!resolved.ok) throw new RoutingFailure(resolved.error);

    if (resolved.mode === 'single') {
      const response = await this.runtime.client.request(endpoint, data, resolved.targetInstanceId, resolved.targetRole);
      return compactText(response);
    }

    const targets = resolved.targets.filter((t) => t.targetRole !== 'edit-proxy');
    const responses = await Promise.allSettled(
      targets.map(async (t) => ({
        peer: t.targetRole,
        result: await this.runtime.client.request(endpoint, data, t.targetInstanceId, t.targetRole),
      })),
    );

    const body: Record<string, unknown> = {};
    for (let i = 0; i < responses.length; i++) {
      const r = responses[i];
      const peer = targets[i].targetRole;
      body[peer] = r.status === 'fulfilled' ? r.value.result : { error: 'disconnected' };
    }
    return compactText(body);
  }
}
