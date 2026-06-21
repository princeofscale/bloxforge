// Declarative tool registry + standard execution pipeline.
//
// Instead of scattering definitions across definitions/*.ts and handlers
// across TOOL_HANDLERS in http-server.ts, defineTool(...) keeps metadata,
// schemas, and the execute function in ONE place.
//
// The pipeline wraps every call:
//   - structuredContent attachment (dual-format: object + text)
//   - error classification via errorEnvelope (typed, agent-branchable)
//   - RoutingFailure serialization (inline instance list for recovery)
//
// Pipeline-wrapped handlers return the FINAL MCP-ready result, so the
// server dispatch should NOT re-apply attachStructuredContent.
//
// Migrate tool by tool: defineTool → { definition, wrappedHandler }.
// Servers check the registry first, fall back to TOOL_HANDLERS for
// non-migrated tools.

import type { ToolDefinition, JsonSchema } from './definitions.js';
import { toolErrorResult } from '../errors.js';
import { attachStructuredContent } from './structured-output.js';
import { RoutingFailure } from '../bridge-service.js';

// ─── Types ───────────────────────────────────────────────────────────

export interface ToolSpec {
  name: string;
  description: string;
  category: 'read' | 'write';
  inputSchema: object;
  outputSchema?: JsonSchema;
  /** Handler matching the existing ToolHandler pattern (tools, args) => result. */
  handler: (tools: unknown, args: Record<string, unknown>) => Promise<unknown>;
}

export interface RegisteredTool {
  spec: ToolSpec;
  definition: ToolDefinition;
  /** Pipeline-wrapped handler. Returns the FINAL MCP result (structuredContent
   *  + error envelope already applied). The server should NOT re-wrap. */
  wrappedHandler: (tools: unknown, args: Record<string, unknown>) => Promise<{
    content: Array<{ type: string; text: string }>;
    structuredContent?: Record<string, unknown>;
    isError?: boolean;
    [k: string]: unknown;
  }>;
}

// ─── defineTool ──────────────────────────────────────────────────────

/**
 * Define a tool that keeps schema + handler together. Returns a
 * `{ definition, wrappedHandler }` — the handler is already wrapped
 * in the standard pipeline.
 *
 * `definition` goes to ListTools; `wrappedHandler` is the CallTool
 * dispatch target. Because the pipeline returns the final MCP shape,
 * the server must NOT call attachStructuredContent on the result again.
 */
export function defineTool(spec: ToolSpec): RegisteredTool {
  const definition: ToolDefinition = {
    name: spec.name,
    description: spec.description,
    category: spec.category,
    inputSchema: spec.inputSchema,
    ...(spec.outputSchema ? { outputSchema: spec.outputSchema } : {}),
  };

  const wrappedHandler = runToolPipeline.bind(null, spec);

  return { spec, definition, wrappedHandler };
}

// ─── ToolRegistry ────────────────────────────────────────────────────

/**
 * A mutable registry of tool specs. Servers check the registry first on
 * CallTool, then fall back to the legacy TOOL_HANDLERS map for tools
 * that haven't been migrated yet.
 */
export class ToolRegistry {
  private _definitions: ToolDefinition[] = [];
  private _wrapped = new Map<string, RegisteredTool>();
  /** Names explicitly set as active (lazy mode). Starts empty = all active. */
  private _activeToolNames = new Set<string>();
  private _lazyMode = false;

  /** Register one or more tools. New definitions are appended. */
  register(...tools: RegisteredTool[]): void {
    for (const t of tools) {
      if (this._wrapped.has(t.spec.name)) {
        throw new Error(`Tool already registered: ${t.spec.name}`);
      }
      this._wrapped.set(t.spec.name, t);
      this._definitions.push(t.definition);
    }
  }

  /** Enable lazy mode — only activeToolNames are advertised. */
  enableLazy(coreNames: string[]): void {
    this._lazyMode = true;
    this._activeToolNames = new Set(coreNames);
  }

  /** Activate additional tool names by name. */
  activate(...names: string[]): void {
    for (const n of names) {
      this._activeToolNames.add(n);
    }
  }

  /** Whether lazy mode is on. */
  get lazyMode(): boolean {
    return this._lazyMode;
  }

  /** Currently active tool name set. */
  get activeNames(): Set<string> {
    return this._activeToolNames;
  }

  /** All definitions — or filtered to active names when lazy mode is on. */
  get definitions(): ToolDefinition[] {
    if (!this._lazyMode) return this._definitions;
    return this._definitions.filter(t => this._activeToolNames.has(t.name));
  }

  /** Check whether a tool is in the registry. */
  has(name: string): boolean {
    return this._wrapped.has(name);
  }

  /**
   * Dispatch a tool through the pipeline. Returns the MCP-ready result.
   * Returns `undefined` if the tool is not registered (caller should fall
   * back to TOOL_HANDLERS).
   */
  async callTool(
    name: string,
    tools: unknown,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const entry = this._wrapped.get(name);
    if (!entry) return undefined;
    return entry.wrappedHandler(tools, args ?? {});
  }
}

// ─── Pipeline ────────────────────────────────────────────────────────

/**
 * Standard execution pipeline.
 *
 * 1. Calls spec.handler(tools, args)
 * 2. Attaches structuredContent (dual-format)
 * 3. Catches errors → envelopes them (RoutingFailure → inline data,
 *    everything else → toolErrorResult)
 *
 * Returns the FINAL MCP result shape. Servers must NOT re-wrap.
 */
async function runToolPipeline(
  spec: ToolSpec,
  tools: unknown,
  args: Record<string, unknown>,
): Promise<{
  content: Array<{ type: string; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  [k: string]: unknown;
}> {
  try {
    const result = await spec.handler(tools, args ?? {});
    // If the handler already returned a tool-shaped result (has content[]),
    // just attach structuredContent. Otherwise, wrap the raw output into the
    // dual-format { content, structuredContent } shape.
    if (result && typeof result === 'object' && 'content' in (result as Record<string, unknown>)) {
      return attachStructuredContent(result as Record<string, unknown>) as {
        content: Array<{ type: string; text: string }>;
        structuredContent?: Record<string, unknown>;
      };
    }
    // Raw object output → dual-format wrapping.
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      structuredContent: result as Record<string, unknown>,
    };
  } catch (error: unknown) {
    if (error instanceof RoutingFailure) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              error: error.routingError.code,
              message: error.routingError.message,
              data: error.routingError.data,
            }),
          },
        ],
        isError: true,
      };
    }
    // Everything else → uniform typed envelope
    return toolErrorResult(error, spec.name) as {
      content: Array<{ type: string; text: string }>;
      isError: boolean;
    };
  }
}
