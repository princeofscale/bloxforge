// Safety/audit read tools, split out of the RobloxStudioTools monolith: operation
// history and script-backup listing/restore. These read the shared SafetyManager
// state (the destructive-op gate `_safetyGate`/`_formatSafety` stays on the facade,
// since many domains consult it). The facade delegates here.

import type { SafetyManager } from '../safety/safety-manager.js';
import type { ToolContent } from './runtime-support.js';

type SafetyToolsRuntime = {
  safety: SafetyManager;
  callSingle(endpoint: string, data: unknown, target: string | undefined, instance_id: string | undefined): Promise<unknown>;
};

export class SafetyTools {
  constructor(private readonly runtime: SafetyToolsRuntime) {}

  async getOperationHistory(limit?: number) {
    const entries = this.runtime.safety.getHistory().slice(0, limit ?? 50);
    const header = `Operation history (${entries.length} entries):`;
    const body = entries.length === 0
      ? 'No operations recorded yet.'
      : entries
          .map((e) => `- [${new Date(e.timestamp).toISOString()}] ${e.kind}: ${e.summary}`)
          .join('\n');
    return { content: [{ type: 'text', text: `${header}\n${body}` }] as ToolContent[] };
  }

  async listScriptBackups() {
    const backups = this.runtime.safety.listBackups();
    const header = `Script backups (${backups.length}):`;
    const body = backups.length === 0
      ? 'No script backups captured yet.'
      : backups
          .map((b) => `- ${b.path} (backed up ${new Date(b.timestamp).toISOString()}, ${b.source.length} chars${b.previous !== undefined ? ', 1 prior version available' : ''})`)
          .join('\n');
    return { content: [{ type: 'text', text: `${header}\n${body}` }] as ToolContent[] };
  }

  async restoreScriptBackup(instancePath: string, instance_id?: string) {
    const backup = this.runtime.safety.getBackup(instancePath);
    if (!backup) {
      return { content: [{ type: 'text', text: `No backup found for "${instancePath}". Use list_script_backups to see what is available.` }] as ToolContent[] };
    }
    const response = await this.runtime.callSingle('/api/set-script-source', { instancePath, source: backup.source }, undefined, instance_id);
    this.runtime.safety.recordOperation({ kind: 'restore_script', summary: `restored ${instancePath} (${backup.source.length} chars)` });
    return { content: [{ type: 'text', text: JSON.stringify({ restored: instancePath, bytes: backup.source.length, response }) }] as ToolContent[] };
  }
}
