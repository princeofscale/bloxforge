// Turns raw Studio output-log entries into a structured, actionable error
// report — the "automated reporting" piece that powers "fix all script errors".
// Pure functions (parser + formatter) are unit-tested; the tool layer fetches
// log entries and runs them through here.

export interface LogEntry {
  message: string;
  messageType: string;
  timestamp?: number;
}

export interface DiagnosticItem {
  message: string;
  messageType: string;
  scriptPath?: string;
  line?: number;
}

export interface DiagnosticsResult {
  errors: DiagnosticItem[];
  warnings: DiagnosticItem[];
}

// Roblox errors typically prefix the location as "Path.To.Script:LINE: message".
const LOCATION_RE = /([A-Za-z_][\w.]*):(\d+):/;

function classify(messageType: string): 'error' | 'warning' | 'other' {
  const t = messageType.toLowerCase();
  if (t.includes('error')) return 'error';
  if (t.includes('warning')) return 'warning';
  return 'other';
}

export function parseLogErrors(entries: LogEntry[]): DiagnosticsResult {
  const errors: DiagnosticItem[] = [];
  const warnings: DiagnosticItem[] = [];
  for (const entry of entries ?? []) {
    if (!entry || typeof entry.message !== 'string' || typeof entry.messageType !== 'string') continue;
    const kind = classify(entry.messageType);
    if (kind === 'other') continue;
    const item: DiagnosticItem = { message: entry.message, messageType: entry.messageType };
    const match = LOCATION_RE.exec(entry.message);
    if (match) {
      item.scriptPath = match[1];
      item.line = Number(match[2]);
    }
    (kind === 'error' ? errors : warnings).push(item);
  }
  return { errors, warnings };
}

export function formatDiagnostics(result: DiagnosticsResult): string {
  const { errors, warnings } = result;
  const scopeNote =
    'Note: diagnose_scripts reads the current Studio output log only. ModuleScript compile/load errors appear after the module is required; restart the playtest before trusting a clean result.';
  if (errors.length === 0 && warnings.length === 0) {
    return `No errors or warnings in the captured output. Looks clean.\n\n${scopeNote}`;
  }
  const lines: string[] = [`Found ${errors.length} error(s) and ${warnings.length} warning(s).`, scopeNote];

  if (errors.length > 0) {
    lines.push('', 'Errors:');
    for (const e of errors) {
      const loc = e.scriptPath ? ` [${e.scriptPath}:${e.line}]` : '';
      lines.push(`  - ${e.message}${loc}`);
    }
    const affected = Array.from(new Set(errors.map((e) => e.scriptPath).filter(Boolean)));
    if (affected.length > 0) {
      lines.push('', `Affected scripts: ${affected.join(', ')}`);
      lines.push('Open each with get_script_source, fix the line, and re-test.');
    }
  }

  if (warnings.length > 0) {
    lines.push('', 'Warnings:');
    for (const w of warnings) {
      const loc = w.scriptPath ? ` [${w.scriptPath}:${w.line}]` : '';
      lines.push(`  - ${w.message}${loc}`);
    }
  }

  return lines.join('\n');
}
