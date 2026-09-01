// Mutation tools, split out of the RobloxStudioTools monolith: the scene-writing
// surface — set/mass-set properties, create/delete/clone/duplicate instances,
// attributes, CollectionService tags, and the transactional apply_mutation_plan.
// The bulk/destructive ops (mass_create, delete, apply_mutation_plan) consult the
// shared safety layer (gate + history) via injected runtime functions. All run
// through the shared single-target runtime; the facade delegates with identical
// public signatures so the schema-parity invariants hold.

import { compactText, bulkReceipt, assertReturnMode, type ReturnMode } from '../compact.js';

/**
 * One place where a bulk response becomes a tool result.
 *
 * `full` must not go through `compactText`: that rounds floats and drops null
 * fields, so "the plugin's unedited response" would have arrived edited — the
 * one mode whose entire purpose is to be trustworthy when the others are not.
 *
 * An unrecognised mode is rejected rather than quietly treated as `receipt`.
 * The value arrives raw from an HTTP body, and a caller who asked for `full`
 * and got a compacted receipt because of a typo would be debugging against
 * exactly the wrong evidence.
 */
function bulkResult(response: unknown, rowKey: string, returnMode?: ReturnMode) {
  // Validated here too, not out of distrust of `bulkReceipt` but because this
  // function branches on the mode before ever reaching it — an unrecognised
  // value would otherwise take the compacting path and only then be rejected.
  const mode = assertReturnMode(returnMode);
  if (mode === 'full') {
    return { content: [{ type: 'text' as const, text: JSON.stringify(response) }] };
  }
  return compactText(bulkReceipt(response as { results?: unknown }, rowKey, mode));
}
import { buildMutationPlanLuau, type MutationOp } from '../builders/mutation-plan.js';
import type { OperationKind } from '../safety/safety-manager.js';
import { normalizeExecuteLuauToolResult, wrapToolJsonText, type SafetyOptions, type ToolContent } from './runtime-support.js';

type MutationToolRuntime = {
  callSingle(endpoint: string, data: unknown, target: string | undefined, instance_id: string | undefined): Promise<any>;
  safetyGate(
    kind: OperationKind,
    detail: string,
    input: { path?: string; count?: number; scriptSize?: number; code?: string },
    options?: SafetyOptions,
  ): { content: ToolContent[] } | null;
  recordOperation(kind: string, summary: string): void;
  /** Bulk deletes must gate on any protected path in the batch, not just the first. */
  isProtectedPath(path: string): boolean;
};

export class MutationTools {
  constructor(private readonly runtime: MutationToolRuntime) {}

  async setProperty(instancePath: string, propertyName: string, propertyValue: any, instance_id?: string) {
    if (!instancePath || !propertyName) {
      throw new Error('instancePath and propertyName are required for set_property');
    }
    const response = await this.runtime.callSingle('/api/set-property', { instancePath, propertyName, propertyValue }, undefined, instance_id);
    return { content: [{ type: 'text', text: JSON.stringify(response) }] };
  }

  async setProperties(instancePath: string, properties: Record<string, any>, instance_id?: string) {
    if (!instancePath || !properties) {
      throw new Error('instancePath and properties are required for set_properties');
    }
    const response = await this.runtime.callSingle('/api/set-properties', { instancePath, properties }, undefined, instance_id);
    return { content: [{ type: 'text', text: JSON.stringify(response) }] };
  }

  // Every array argument below is checked with Array.isArray, not just for a
  // length: the declared `string[]` is erased at the JSON boundary and nothing
  // between the client and here enforces inputSchema. A caller that sent
  // `paths: "game.Workspace.Part"` used to clear a bare `.length === 0` on the
  // string's length — mass_create_objects then told the safety gate "create 24
  // objects" and wrote "created 24 objects" into the operation history for a
  // batch that never existed. `bulkMutate` below already guarded this way.
  async massSetProperty(paths: string[], propertyName: string, propertyValue: any, instance_id?: string, returnMode?: ReturnMode) {
    if (!Array.isArray(paths) || paths.length === 0 || !propertyName) {
      throw new Error('paths (non-empty array) and propertyName are required for mass_set_property');
    }
    const response = await this.runtime.callSingle('/api/mass-set-property', { paths, propertyName, propertyValue }, undefined, instance_id);
    return bulkResult(response, 'path', returnMode);
  }

  async massGetProperty(paths: string[], propertyName: string, instance_id?: string, returnMode?: ReturnMode) {
    if (!Array.isArray(paths) || paths.length === 0 || !propertyName) {
      throw new Error('paths (non-empty array) and propertyName are required for mass_get_property');
    }
    const response = await this.runtime.callSingle('/api/mass-get-property', { paths, propertyName }, undefined, instance_id);
    return bulkResult(response, 'path', returnMode);
  }

  async createObject(className: string, parent: string, name?: string, properties?: Record<string, any>, instance_id?: string) {
    if (!className || !parent) {
      throw new Error('className and parent are required for create_object');
    }
    const response = await this.runtime.callSingle('/api/create-object', { className, parent, name, properties }, undefined, instance_id);
    return { content: [{ type: 'text', text: JSON.stringify(response) }] };
  }

  async massCreateObjects(objects: Array<{className: string, parent: string, name?: string, properties?: Record<string, any>}>, instance_id?: string, options?: SafetyOptions, returnMode?: ReturnMode) {
    if (!Array.isArray(objects) || objects.length === 0) {
      throw new Error('objects (non-empty array) is required for mass_create_objects');
    }
    const gated = this.runtime.safetyGate('bulk_create', `create ${objects.length} objects`, { count: objects.length }, options);
    if (gated) return gated;
    const response = await this.runtime.callSingle('/api/mass-create-objects', { objects }, undefined, instance_id);
    this.runtime.recordOperation('bulk_create', `created ${objects.length} objects`);
    return bulkResult(response, 'path', returnMode);
  }

  async deleteObject(instancePath: string, instance_id?: string, options?: SafetyOptions) {
    if (!instancePath) {
      throw new Error('instancePath is required for delete_object');
    }
    const gated = this.runtime.safetyGate('delete', `delete ${instancePath}`, { path: instancePath }, options);
    if (gated) return gated;
    const response = await this.runtime.callSingle('/api/delete-object', { instancePath }, undefined, instance_id);
    this.runtime.recordOperation('delete', `deleted ${instancePath}`);
    return { content: [{ type: 'text', text: JSON.stringify(response) }] };
  }

  async massDeleteObjects(paths: string[], instance_id?: string, options?: SafetyOptions, returnMode?: ReturnMode) {
    if (!Array.isArray(paths) || paths.length === 0) {
      throw new Error('paths (non-empty array) is required for mass_delete_objects');
    }
    // The safety manager has carried a `bulk_delete` kind (protected-path check
    // plus count gating) since it was written; nothing had ever wired a tool to it.
    // assess() takes one path, so surface a protected one if the batch has any —
    // otherwise a list ending in ServerScriptService would slip the gate.
    const protectedPath = paths.find((p) => this.runtime.isProtectedPath(p));
    const gated = this.runtime.safetyGate(
      'bulk_delete',
      `delete ${paths.length} objects`,
      { count: paths.length, path: protectedPath ?? paths[0] },
      options,
    );
    if (gated) return gated;
    const response = await this.runtime.callSingle('/api/mass-delete-objects', { paths }, undefined, instance_id);
    // Report what the batch actually did, not what it was asked to do: a batch
    // where every path was already gone completes with zero removals, and an
    // operation history claiming N deletions is worse than no entry at all.
    const summary = (response as { summary?: { succeeded?: number; failed?: number } })?.summary;
    const succeeded = summary?.succeeded ?? paths.length;
    if (succeeded > 0) {
      const failed = summary?.failed ?? 0;
      this.runtime.recordOperation(
        'bulk_delete',
        failed > 0 ? `deleted ${succeeded} of ${paths.length} objects` : `deleted ${succeeded} objects`,
      );
    }
    return bulkResult(response, 'path', returnMode);
  }

  async cloneObject(instancePath: string, targetParentPath: string, instance_id?: string) {
    if (!instancePath || !targetParentPath) {
      throw new Error('instancePath and targetParentPath are required for clone_object');
    }
    const response = await this.runtime.callSingle('/api/clone-object', { instancePath, targetParentPath }, undefined, instance_id);
    return { content: [{ type: 'text', text: JSON.stringify(response) }] };
  }

  async smartDuplicate(
    instancePath: string,
    count: number,
    options?: {
      namePattern?: string;
      positionOffset?: [number, number, number];
      rotationOffset?: [number, number, number];
      scaleOffset?: [number, number, number];
      propertyVariations?: Record<string, any[]>;
      targetParents?: string[];
    },
    instance_id?: string
  ) {
    if (!instancePath || count < 1) {
      throw new Error('instancePath and count (> 0) are required for smart_duplicate');
    }
    const response = await this.runtime.callSingle('/api/smart-duplicate', { instancePath, count, options }, undefined, instance_id);
    return { content: [{ type: 'text', text: JSON.stringify(response) }] };
  }

  async massDuplicate(
    duplications: Array<{
      instancePath: string;
      count: number;
      options?: {
        namePattern?: string;
        positionOffset?: [number, number, number];
        rotationOffset?: [number, number, number];
        scaleOffset?: [number, number, number];
        propertyVariations?: Record<string, any[]>;
        targetParents?: string[];
      }
    }>,
    instance_id?: string
  ) {
    if (!Array.isArray(duplications) || duplications.length === 0) {
      throw new Error('duplications (non-empty array) is required for mass_duplicate');
    }
    const response = await this.runtime.callSingle('/api/mass-duplicate', { duplications }, undefined, instance_id);
    return { content: [{ type: 'text', text: JSON.stringify(response) }] };
  }

  async manageSelection(
    action?: string,
    paths?: string[],
    path?: string,
    from?: number,
    angleY?: number,
    padding?: number,
    instance_id?: string,
  ) {
    // inputSchema's `default` is advisory: neither dispatch path applies it, so
    // an omitted action arrives here as undefined. Resolving it here rather than
    // only in the plugin keeps the two ends from disagreeing about what a bare
    // call means, and keeps 'undefined' out of the error messages below.
    const resolved = action ?? 'set';
    if (resolved === 'focus') {
      if (typeof path !== 'string' || path === '') {
        throw new Error("path is required for manage_selection when action is 'focus'");
      }
    } else if (!Array.isArray(paths)) {
      // The declared string[] is erased at the JSON boundary; a bare string
      // would iterate per character in the plugin and select nothing.
      throw new Error(`paths must be an array of instance paths for manage_selection action '${resolved}'`);
    } else if (!paths.every((p) => typeof p === 'string' && p !== '')) {
      // Array.isArray says nothing about the elements. A number reaches
      // getInstanceByPath, which does string work on it and raises out of a
      // handler that is not wrapped — a transport error where the caller should
      // have got a named argument error.
      throw new Error(`paths must contain only non-empty instance paths for manage_selection action '${resolved}'`);
    }
    // Same erasure on the framing numbers: a string reaches math.max/rad/clamp
    // in Luau and raises there instead of being reported here.
    for (const [name, value] of [['from', from], ['angleY', angleY], ['padding', padding]] as const) {
      if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value))) {
        throw new Error(`${name} must be a finite number for manage_selection`);
      }
    }
    const response = await this.runtime.callSingle(
      '/api/manage-selection',
      { action: resolved, paths, path, from, angleY, padding },
      undefined,
      instance_id,
    );
    return { content: [{ type: 'text', text: JSON.stringify(response) }] };
  }

  async setAttribute(instancePath: string, attributeName: string, attributeValue: any, valueType?: string, instance_id?: string) {
    if (!instancePath || !attributeName) {
      throw new Error('instancePath and attributeName are required for set_attribute');
    }
    const response = await this.runtime.callSingle('/api/set-attribute', { instancePath, attributeName, attributeValue, valueType }, undefined, instance_id);
    return { content: [{ type: 'text', text: JSON.stringify(response) }] };
  }

  async getAttributes(instancePath: string, instance_id?: string) {
    if (!instancePath) {
      throw new Error('instancePath is required for get_attributes');
    }
    const response = await this.runtime.callSingle('/api/get-attributes', { instancePath }, undefined, instance_id);
    return { content: [{ type: 'text', text: JSON.stringify(response) }] };
  }

  async deleteAttribute(instancePath: string, attributeName: string, instance_id?: string) {
    if (!instancePath || !attributeName) {
      throw new Error('instancePath and attributeName are required for delete_attribute');
    }
    const response = await this.runtime.callSingle('/api/delete-attribute', { instancePath, attributeName }, undefined, instance_id);
    return { content: [{ type: 'text', text: JSON.stringify(response) }] };
  }

  async bulkSetAttributes(instancePath: string, attributes: Record<string, unknown>, instance_id?: string, returnMode?: ReturnMode) {
    if (!instancePath || !attributes) {
      throw new Error('instancePath and attributes are required for bulk_set_attributes');
    }
    const response = await this.runtime.callSingle('/api/bulk-set-attributes', { instancePath, attributes }, undefined, instance_id);
    // Rows are keyed by attributeName here, not path.
    return bulkResult(response, 'attributeName', returnMode);
  }

  async getTags(instancePath: string, instance_id?: string) {
    if (!instancePath) {
      throw new Error('instancePath is required for get_tags');
    }
    const response = await this.runtime.callSingle('/api/get-tags', { instancePath }, undefined, instance_id);
    return { content: [{ type: 'text', text: JSON.stringify(response) }] };
  }

  async addTag(instancePath: string, tagName: string, instance_id?: string) {
    if (!instancePath || !tagName) {
      throw new Error('instancePath and tagName are required for add_tag');
    }
    const response = await this.runtime.callSingle('/api/add-tag', { instancePath, tagName }, undefined, instance_id);
    return { content: [{ type: 'text', text: JSON.stringify(response) }] };
  }

  async removeTag(instancePath: string, tagName: string, instance_id?: string) {
    if (!instancePath || !tagName) {
      throw new Error('instancePath and tagName are required for remove_tag');
    }
    const response = await this.runtime.callSingle('/api/remove-tag', { instancePath, tagName }, undefined, instance_id);
    return { content: [{ type: 'text', text: JSON.stringify(response) }] };
  }

  async getTagged(tagName: string, instance_id?: string) {
    if (!tagName) {
      throw new Error('tagName is required for get_tagged');
    }
    const response = await this.runtime.callSingle('/api/get-tagged', { tagName }, undefined, instance_id);
    return { content: [{ type: 'text', text: JSON.stringify(response) }] };
  }

  // Transactional batch mutations: apply many small edits in one round-trip with a
  // dry-run diff and a ready-to-run reverse plan in the receipt (stateless rollback).
  async applyMutationPlan(operations: MutationOp[], dryRun?: boolean, confirm?: boolean, instance_id?: string, atomic = true) {
    if (!Array.isArray(operations) || operations.length === 0) {
      throw new Error('operations (a non-empty array) is required for apply_mutation_plan');
    }
    // Only gate the apply path; dry-run is a safe preview that should always run.
    if (!dryRun) {
      const gated = this.runtime.safetyGate('bulk_mutate', `apply ${operations.length} mutation(s)`, { count: operations.length }, { confirm });
      if (gated) return gated;
    }
    // A dry run reports what would change without touching the DataModel, so it
    // takes no undo label — only the apply becomes a waypoint.
    const response = await this.runtime.callSingle(
      '/api/execute-luau',
      dryRun
        ? { code: buildMutationPlanLuau(operations, true, atomic) }
        : { code: buildMutationPlanLuau(operations, false, atomic), undoLabel: `mutation plan (${operations.length} ops)` },
      'edit',
      instance_id,
    );
    if (!dryRun) this.runtime.recordOperation('bulk_mutate', `mutation plan: ${operations.length} ops`);
    return wrapToolJsonText(normalizeExecuteLuauToolResult(response, {
      applied: !dryRun,
      dryRun: !!dryRun,
      results: [],
      rollback: [],
      summary: { total: operations.length, succeeded: 0, failed: operations.length },
      error: 'apply_mutation_plan returned non-object execute-luau output',
    }));
  }
}
