export interface ToolCallRecordInput {
  toolName: string;
  durationMs: number;
  ok: boolean;
  errorCode?: string;
}

export interface ToolCallRecord extends ToolCallRecordInput {
  timestamp: number;
}

export interface SessionSummary {
  totalCalls: number;
  failures: number;
  averageDurationMs: number;
  byTool: Array<{ toolName: string; calls: number; failures: number; averageDurationMs: number }>;
  recent: ToolCallRecord[];
}

export class SessionRecorder {
  private readonly calls: ToolCallRecord[] = [];

  constructor(private readonly limit = 200) {}

  recordToolCall(input: ToolCallRecordInput): void {
    this.calls.push({
      ...input,
      durationMs: Math.max(0, Math.round(input.durationMs)),
      timestamp: Date.now(),
    });
    if (this.calls.length > this.limit) {
      this.calls.splice(0, this.calls.length - this.limit);
    }
  }

  summarize(recentLimit = 10): SessionSummary {
    const failures = this.calls.filter((c) => !c.ok).length;
    const totalDuration = this.calls.reduce((sum, c) => sum + c.durationMs, 0);
    const byToolMap = new Map<string, { calls: number; failures: number; totalDurationMs: number }>();
    for (const call of this.calls) {
      const entry = byToolMap.get(call.toolName) ?? { calls: 0, failures: 0, totalDurationMs: 0 };
      entry.calls += 1;
      entry.failures += call.ok ? 0 : 1;
      entry.totalDurationMs += call.durationMs;
      byToolMap.set(call.toolName, entry);
    }
    return {
      totalCalls: this.calls.length,
      failures,
      averageDurationMs: this.calls.length === 0 ? 0 : Math.round(totalDuration / this.calls.length),
      byTool: Array.from(byToolMap.entries())
        .map(([toolName, entry]) => ({
          toolName,
          calls: entry.calls,
          failures: entry.failures,
          averageDurationMs: Math.round(entry.totalDurationMs / entry.calls),
        }))
        .sort((a, b) => b.calls - a.calls || a.toolName.localeCompare(b.toolName)),
      recent: this.calls.slice(-recentLimit).reverse(),
    };
  }
}
