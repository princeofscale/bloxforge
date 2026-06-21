// Script tools, split out of the RobloxStudioTools monolith: read/write a script's
// source, line-level edits (edit/insert/delete), cross-script grep + find-and-replace,
// and runtime-log diagnostics. set_script_source is the one write that touches the
// safety layer (gate + backup-before-overwrite + history). All run through the shared
// single-target runtime; the facade delegates here with identical public signatures.

import { parseLogErrors, formatDiagnostics } from '../diagnostics.js';
import type { OperationKind } from '../safety/safety-manager.js';
import { errorMessage, type SafetyOptions, type ToolContent } from './runtime-support.js';

type ScriptToolRuntime = {
  callSingle(endpoint: string, data: unknown, target: string | undefined, instance_id: string | undefined): Promise<any>;
  safetyGate(
    kind: OperationKind,
    detail: string,
    input: { path?: string; count?: number; scriptSize?: number; code?: string },
    options?: SafetyOptions,
  ): { content: ToolContent[] } | null;
  backupScript(path: string, source: string): void;
  recordOperation(kind: string, summary: string): void;
};

export class ScriptTools {
  constructor(private readonly runtime: ScriptToolRuntime) {}

  async getScriptSource(instancePath: string, startLine?: number, endLine?: number, instance_id?: string) {
    if (!instancePath) {
      throw new Error('Instance path is required for get_script_source');
    }
    const response = await this.runtime.callSingle('/api/get-script-source', { instancePath, startLine, endLine }, undefined, instance_id);

    if (response.error) {
      return { content: [{ type: 'text', text: `Error: ${response.error}` }] };
    }

    const scriptTypeInfo: Record<string, string> = {
      'Script': 'Server Script, runs on the server only',
      'LocalScript': 'Local Script, runs on the client',
      'ModuleScript': 'Module Script, shared library loaded via require()',
    };

    const serviceInfo: Record<string, string> = {
      'Workspace': 'Workspace, 3D world replicated to all clients',
      'ServerScriptService': 'ServerScriptService, server only',
      'ServerStorage': 'ServerStorage, server only storage',
      'StarterGui': 'StarterGui, UI templates copied to each player',
      'StarterPlayerScripts': 'StarterPlayerScripts, client scripts',
      'StarterCharacterScripts': 'StarterCharacterScripts, character scripts',
      'ReplicatedStorage': 'ReplicatedStorage, shared server and client',
      'ReplicatedFirst': 'ReplicatedFirst, first to load on client',
    };

    const pathStr = (response.instancePath as string) || instancePath;
    const pathSegments = pathStr.split('.');
    const topService =
      typeof response.topService === 'string' && response.topService.length > 0
        ? response.topService
        : pathSegments[0] === 'game' ? (pathSegments[1] ?? 'game') : pathSegments[0];
    const typeNote = scriptTypeInfo[response.className as string] || (response.className as string);
    const serviceNote = serviceInfo[topService] || topService;

    const headerLines: string[] = [
      `Path:     ${pathStr}`,
      `Type:     ${typeNote}`,
      `Location: ${serviceNote}`,
      `Lines:    ${response.lineCount} total${
        response.isPartial ? ` (showing ${response.startLine}-${response.endLine})` : ''
      }`,
    ];

    if (response.enabled === false) {
      headerLines.push(`Status:   DISABLED`);
    }

    if (response.truncated) {
      headerLines.push(`Note:     Truncated to first 1000 lines, use startLine/endLine to read more`);
    }

    const header = headerLines.join('\n');
    const code = (response.numberedSource || response.source) as string;

    return {
      content: [{
        type: 'text',
        text: `${header}\n\n${code}`,
      }]
    };
  }

  async setScriptSource(instancePath: string, source: string, instance_id?: string, options?: SafetyOptions) {
    if (!instancePath || typeof source !== 'string') {
      throw new Error('Instance path and source code string are required for set_script_source');
    }
    const gated = this.runtime.safetyGate('set_script_source', `overwrite ${instancePath} (${source.length} chars)`, { scriptSize: source.length }, options);
    if (gated) return gated;

    // Back up the current source before overwriting so the change is reversible
    // via restore_script_backup. A failed backup fetch must not block the write,
    // but we surface it as a warning so the caller knows undo is unavailable.
    let backupWarning = '';
    try {
      const current = await this.runtime.callSingle('/api/get-script-source', { instancePath }, undefined, instance_id);
      if (typeof current?.source === 'string') {
        this.runtime.backupScript(instancePath, current.source);
      }
    } catch (error) {
      backupWarning = ` (warning: could not back up previous source: ${errorMessage(error)})`;
    }

    const response = await this.runtime.callSingle('/api/set-script-source', { instancePath, source }, undefined, instance_id);
    this.runtime.recordOperation('set_script_source', `overwrote ${instancePath} (${source.length} chars)`);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(response) + backupWarning
        }
      ]
    };
  }

  async editScriptLines(instancePath: string, oldString: string, newString: string, startLine?: number, instance_id?: string) {
    if (!instancePath || typeof oldString !== 'string' || typeof newString !== 'string') {
      throw new Error('Instance path, old_string, and new_string are required for edit_script_lines');
    }
    const payload: Record<string, unknown> = { instancePath, old_string: oldString, new_string: newString };
    if (startLine !== undefined) payload.startLine = startLine;
    const response = await this.runtime.callSingle('/api/edit-script-lines', payload, undefined, instance_id);
    return { content: [{ type: 'text', text: JSON.stringify(response) }] };
  }

  async insertScriptLines(instancePath: string, afterLine: number, newContent: string, instance_id?: string) {
    if (!instancePath || typeof newContent !== 'string') {
      throw new Error('Instance path and newContent are required for insert_script_lines');
    }
    const response = await this.runtime.callSingle('/api/insert-script-lines', { instancePath, afterLine: afterLine || 0, newContent }, undefined, instance_id);
    return { content: [{ type: 'text', text: JSON.stringify(response) }] };
  }

  async deleteScriptLines(instancePath: string, startLine: number, endLine: number, instance_id?: string) {
    if (!instancePath || !startLine || !endLine) {
      throw new Error('Instance path, startLine, and endLine are required for delete_script_lines');
    }
    const response = await this.runtime.callSingle('/api/delete-script-lines', { instancePath, startLine, endLine }, undefined, instance_id);
    return { content: [{ type: 'text', text: JSON.stringify(response) }] };
  }

  async grepScripts(
    pattern: string,
    options?: {
      caseSensitive?: boolean;
      usePattern?: boolean;
      contextLines?: number;
      maxResults?: number;
      maxResultsPerScript?: number;
      filesOnly?: boolean;
      path?: string;
      classFilter?: string;
    },
    instance_id?: string
  ) {
    if (!pattern) {
      throw new Error('Pattern is required for grep_scripts');
    }
    const response = await this.runtime.callSingle('/api/grep-scripts', {
      pattern,
      ...options
    }, undefined, instance_id);
    return { content: [{ type: 'text', text: JSON.stringify(response) }] };
  }

  async findAndReplaceInScripts(
    pattern: string,
    replacement: string,
    options?: {
      caseSensitive?: boolean;
      usePattern?: boolean;
      path?: string;
      classFilter?: string;
      dryRun?: boolean;
      maxReplacements?: number;
    },
    instance_id?: string
  ) {
    if (!pattern) {
      throw new Error('pattern is required for find_and_replace_in_scripts');
    }
    if (replacement === undefined || replacement === null) {
      throw new Error('replacement is required for find_and_replace_in_scripts');
    }
    const response = await this.runtime.callSingle('/api/find-and-replace-in-scripts', {
      pattern,
      replacement,
      ...options
    }, undefined, instance_id);
    return { content: [{ type: 'text', text: JSON.stringify(response) }] };
  }

  async diagnoseScripts(maxEntries?: number, instance_id?: string) {
    const response = await this.runtime.callSingle('/api/get-runtime-logs', { tail: maxEntries ?? 200 }, 'edit', instance_id);
    const entries = Array.isArray(response?.entries) ? response.entries : [];
    const result = parseLogErrors(entries);
    return {
      content: [{
        type: 'text',
        text: `${formatDiagnostics(result)}\n\n${JSON.stringify({ errors: result.errors, warnings: result.warnings })}`,
      }] as ToolContent[],
    };
  }
}
