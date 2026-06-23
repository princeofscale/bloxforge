// Concrete McpHarnessAdapter: drives an Anthropic-Messages model against the live
// MCP server over stdio, recording a TraceEvent[] + RunMetrics per task. Provider-
// agnostic interface lives in ../harness.ts; this is the Messages-protocol impl.
//
// Works with the real Anthropic API (ANTHROPIC_API_KEY) OR any Anthropic-Messages-
// compatible gateway via `baseURL` + `model` — e.g. OpenModel's free
// `deepseek-v4-flash` (see ../run.ts for the env wiring). Needs a connected Roblox
// Studio (the MCP server bridges to it). Run via ../run.ts.

import Anthropic from '@anthropic-ai/sdk';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { EvalCase, HarnessMode, McpHarnessAdapter, RunResult } from '../harness.js';
import type { TraceEvent, RunMetrics } from '../metrics.js';

const DEFAULT_MODEL = 'claude-opus-4-8';
// Weak free models thrash (repeat the same call many times) and need headroom to
// finish before the loop cap turns a capability into a false FAIL. Tunable via env.
const MAX_ITERATIONS = Number(process.env.EVAL_MAX_ITERATIONS) || 20;

interface McpToolDef {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface ClaudeMcpAdapterOptions {
  /** Path to the built MCP server entrypoint. */
  serverEntry: string;
  /** Extra env for the server process (e.g. POLLINATIONS key). */
  serverEnv?: Record<string, string>;
  apiKey?: string;
  /** Override the API base URL — point at an Anthropic-Messages-compatible gateway. */
  baseURL?: string;
  /** Model id to drive (defaults to claude-opus-4-8). */
  model?: string;
  /** SDK auto-retries (incl. 429); free gateways need a generous count. Default 8. */
  maxRetries?: number;
  /** Fixed delay before each model call, to respect per-user rate limits. Default 0. */
  requestDelayMs?: number;
}

export class ClaudeMcpAdapter implements McpHarnessAdapter {
  private readonly anthropic: Anthropic;
  private readonly model: string;
  private readonly requestDelayMs: number;
  private client: Client | undefined;
  private transport: StdioClientTransport | undefined;

  constructor(private readonly opts: ClaudeMcpAdapterOptions) {
    this.anthropic = new Anthropic({
      ...(opts.apiKey ? { apiKey: opts.apiKey } : {}),
      ...(opts.baseURL ? { baseURL: opts.baseURL } : {}),
      maxRetries: opts.maxRetries ?? 8,
    });
    this.model = opts.model ?? DEFAULT_MODEL;
    this.requestDelayMs = Math.max(0, opts.requestDelayMs ?? 0);
  }

  async startServer(mode: HarnessMode): Promise<void> {
    console.log(`[harness] spawning MCP server (mode=${mode}, lazy=${mode === 'lazy' ? '1' : '0'})…`);
    this.transport = new StdioClientTransport({
      command: 'node',
      args: [this.opts.serverEntry],
      env: {
        ...process.env as Record<string, string>,
        ...(this.opts.serverEnv ?? {}),
        // Lazy mode advertises only the core + meta tools upfront.
        ROBLOX_MCP_LAZY_TOOLS: mode === 'lazy' ? '1' : '0',
      },
      // Surface the server's own startup logs (plugin install, bridge status,
      // "Studio connected") so a failed/proxy-mode bridge is visible, not silent.
      stderr: 'inherit',
    });
    this.client = new Client({ name: 'mcp-eval-harness', version: '1.0.0' }, { capabilities: {} });
    await this.client.connect(this.transport);
    const toolCount = (await this.listTools()).length;
    console.log(`[harness] MCP server connected over stdio (${toolCount} tools advertised).`);
    await this.waitForStudio();
  }

  /**
   * Block until the Studio plugin has (re)connected to this server, or abort with
   * an actionable message. The plugin long-polls on an interval, so after a server
   * (re)spawn it takes a few seconds to register — checking once immediately races
   * that and yields a false "no Studio". Polls until a place appears or timeout.
   */
  private async waitForStudio(
    timeoutMs = Number(process.env.EVAL_STUDIO_TIMEOUT_MS) || 30000,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let announcedWait = false;
    for (;;) {
      const conn = await this.checkStudioConnection();
      if (conn.count > 0) {
        console.log(
          `[harness] Studio connected: ${conn.count} instance(s) — ` +
            conn.instances.map((i) => `${i.role ?? '?'}@${i.instanceId ?? '?'}`).join(', '),
        );
        return;
      }
      if (Date.now() >= deadline) {
        await this.stopServer();
        throw new Error(
          `No Roblox Studio connected after ${Math.round(timeoutMs / 1000)}s.\n` +
            '  - Open Roblox Studio with the MCP plugin installed and a place loaded.\n' +
            "  - If you saw 'entering proxy mode' above, another MCP server (a Claude Code /\n" +
            '    Cursor session) holds port 58741 — close it so this run is the primary.\n' +
            '  - The plugin reconnects to a new primary on its poll interval; raise the wait\n' +
            '    with EVAL_STUDIO_TIMEOUT_MS if your Studio is slow to reconnect.',
        );
      }
      if (!announcedWait) {
        console.log('[harness] waiting for Studio plugin to connect…');
        announcedWait = true;
      }
      await sleep(2000);
    }
  }

  async stopServer(): Promise<void> {
    await this.client?.close().catch(() => {});
    await this.transport?.close().catch(() => {});
    this.client = undefined;
    this.transport = undefined;
  }

  /**
   * Ask the running server which Roblox Studio places are connected. Used as a
   * preflight so the run aborts loudly when Studio isn't reachable (the spawned
   * server falls back to proxy mode and every case would silently fail).
   * Requires startServer() to have been called.
   */
  async checkStudioConnection(): Promise<{ count: number; instances: Array<Record<string, unknown>> }> {
    if (!this.client) throw new Error('checkStudioConnection called before startServer');
    try {
      const result = await this.client.callTool({ name: 'get_connected_instances', arguments: {} });
      const text = extractText(result.content);
      const parsed = JSON.parse(text) as { instances?: Array<Record<string, unknown>>; count?: number };
      const instances = parsed.instances ?? [];
      return { count: parsed.count ?? instances.length, instances };
    } catch {
      return { count: 0, instances: [] };
    }
  }

  private async listTools(): Promise<McpToolDef[]> {
    const res = await this.client!.listTools();
    return res.tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema as Record<string, unknown> }));
  }

  async runTask(task: EvalCase): Promise<RunResult> {
    const trace: TraceEvent[] = [];
    const start = Date.now();
    let cumulativeInputTokens = 0;
    let cumulativeOutputTokens = 0;
    let initInputTokens = 0;
    let toolSchemaTokensSeen = 0;
    let toolCalls = 0;
    let invalidToolCalls = 0;
    const distinct = new Set<string>();

    let tools = await this.listTools();
    toolSchemaTokensSeen += approxTokens(tools);
    const toAnthropicTools = () => tools.map((t) => ({ name: t.name, description: t.description ?? '', input_schema: t.inputSchema as Anthropic.Tool.InputSchema }));

    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: task.prompt }];
    let finalText = '';
    let success = false;

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      if (this.requestDelayMs > 0) await sleep(this.requestDelayMs);
      const response = await this.anthropic.messages.create({
        model: this.model,
        max_tokens: 4096,
        tools: toAnthropicTools(),
        messages,
      });
      const cacheReadIn = response.usage.cache_read_input_tokens ?? 0;
      const cacheWriteIn = response.usage.cache_creation_input_tokens ?? 0;
      const usageIn = response.usage.input_tokens + cacheReadIn + cacheWriteIn;
      cumulativeInputTokens += usageIn;
      cumulativeOutputTokens += response.usage.output_tokens;
      if (i === 0) initInputTokens = usageIn;
      trace.push({ t: Date.now() - start, type: 'model', tokensIn: usageIn, cacheReadIn, cacheWriteIn, tokensOut: response.usage.output_tokens });

      const toolUses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
      for (const b of response.content) {
        if (b.type === 'text') finalText += b.text;
      }
      // Replay only text + tool_use back into history. Some Messages-compatible
      // gateways (e.g. deepseek-v4-flash) emit unsolicited `thinking` blocks whose
      // signatures don't survive a round-trip; we never enabled extended thinking,
      // so dropping them is safe and avoids signature-validation rejections.
      const replayContent = response.content.filter(
        (b) => b.type === 'text' || b.type === 'tool_use',
      );
      messages.push({ role: 'assistant', content: replayContent });

      if (response.stop_reason !== 'tool_use' || toolUses.length === 0) {
        success = response.stop_reason === 'end_turn';
        break;
      }

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      let loadedToolset = false;
      for (const tu of toolUses) {
        toolCalls += 1;
        distinct.add(tu.name);
        let isError = false;
        let text = '';
        try {
          const result = await this.client!.callTool({ name: tu.name, arguments: (tu.input ?? {}) as Record<string, unknown> });
          isError = result.isError === true;
          text = extractText(result.content);
          if (tu.name === 'load_toolset') loadedToolset = true;
        } catch (err) {
          isError = true;
          text = err instanceof Error ? err.message : String(err);
        }
        if (isError) invalidToolCalls += 1;
        console.log(`      → ${tu.name}${isError ? ' [error]' : ''}`);
        trace.push({ t: Date.now() - start, type: 'tool_call', name: tu.name, args: tu.input, isError });
        trace.push({ t: Date.now() - start, type: 'tool_result', name: tu.name, resultSummary: text.slice(0, 200) });
        toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: text, is_error: isError });
      }
      messages.push({ role: 'user', content: toolResults });

      // Lazy mode: after load_toolset the advertised tool set grew — refresh it.
      if (loadedToolset) {
        tools = await this.listTools();
        toolSchemaTokensSeen += approxTokens(tools);
      }
    }

    const metrics: RunMetrics = {
      initInputTokens,
      cumulativeInputTokens,
      cumulativeOutputTokens,
      toolSchemaTokensSeen,
      toolCalls,
      distinctToolsCalled: distinct.size,
      unnecessaryToolCalls: 0, // computed by scoreTrajectory against the gold spec
      invalidToolCalls,
      retriesAfterRecoverableError: 0,
      wallClockMs: Date.now() - start,
      success: success && factsPresent(finalText, task.must_contain_facts),
    };
    return { finalAnswer: finalText, trace, metrics };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function approxTokens(tools: McpToolDef[]): number {
  // Rough proxy for how much schema text the model sees (≈4 chars/token).
  return Math.ceil(JSON.stringify(tools).length / 4);
}

function extractText(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content
    .filter((c): c is { type: 'text'; text: string } => !!c && typeof c === 'object' && (c as { type?: string }).type === 'text')
    .map((c) => c.text)
    .join('\n');
}

function factsPresent(answer: string, facts?: string[]): boolean {
  if (!facts || facts.length === 0) return true;
  const lower = answer.toLowerCase();
  // Lenient keyword presence — a real run pairs this with an LLM-as-judge.
  return facts.some((f) => lower.includes(f.toLowerCase().split(' ')[0]));
}
