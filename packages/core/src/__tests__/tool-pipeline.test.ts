import { defineTool, ToolRegistry } from '../tools/tool-pipeline.js';
import { RoutingFailure } from '../bridge-service.js';

describe('defineTool', () => {
  const spec = {
    name: 'test_tool',
    description: 'A test tool',
    category: 'read' as const,
    inputSchema: { type: 'object', properties: { x: { type: 'number' } } },
    outputSchema: {
      type: 'object',
      properties: { result: { type: 'string' } },
      required: ['result'],
    },
    handler: async (_tools: unknown, args: Record<string, unknown>) => ({
      result: `got ${String(args.x)}`,
    }),
  };

  it('returns a definition with metadata and outputSchema', () => {
    const { definition } = defineTool(spec);
    expect(definition.name).toBe('test_tool');
    expect(definition.description).toBe('A test tool');
    expect(definition.category).toBe('read');
    expect(definition.inputSchema).toEqual({ type: 'object', properties: { x: { type: 'number' } } });
    expect(definition.outputSchema).toBe(spec.outputSchema);
  });

  it('wrappedHandler returns MCP-ready result with structuredContent on success', async () => {
    const { wrappedHandler } = defineTool(spec);
    const result = await wrappedHandler(null, { x: 42 });
    expect(result).toHaveProperty('content');
    expect(result).toHaveProperty('structuredContent');
    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toContain('got 42');
    expect(result.structuredContent).toEqual({ result: 'got 42' });
  });

  it('wrappedHandler wraps thrown errors in the error envelope', async () => {
    const errorSpec = {
      ...spec,
      handler: async () => { throw new Error('something broke'); },
    };
    const { wrappedHandler } = defineTool(errorSpec);
    const result = await wrappedHandler(null, {});
    expect(result.isError).toBe(true);
    const text = JSON.parse(result.content[0].text);
    expect(text.ok).toBe(false);
    expect(text.error.message).toContain('something broke');
    expect(text.error.code).toBeDefined();
    expect(text.error.retryable).toBe(false);
  });

  it('wrappedHandler handles RoutingFailure inline', async () => {
    const routingSpec = {
      ...spec,
      handler: async () => {
        throw new RoutingFailure({
          code: 'ambiguous_target' as const,
          message: 'Multiple instances match',
          data: { instances: [], count: 0 },
        });
      },
    };
    const { wrappedHandler } = defineTool(routingSpec);
    const result = await wrappedHandler(null, {});
    expect(result.isError).toBe(true);
    const text = JSON.parse(result.content[0].text);
    expect(text.error).toBe('ambiguous_target');
    expect(text.message).toContain('Multiple instances');
  });
});

describe('ToolRegistry', () => {
  const toolA = defineTool({
    name: 'tool_a',
    description: 'First tool',
    category: 'read',
    inputSchema: {},
    handler: async () => ({ ok: true }),
  });

  const toolB = defineTool({
    name: 'tool_b',
    description: 'Second tool',
    category: 'write',
    inputSchema: {},
    handler: async () => ({ ok: true }),
  });

  it('register adds definitions and makes tools available', () => {
    const registry = new ToolRegistry();
    registry.register(toolA, toolB);
    expect(registry.has('tool_a')).toBe(true);
    expect(registry.has('tool_b')).toBe(true);
    expect(registry.has('unknown')).toBe(false);
    expect(registry.definitions).toHaveLength(2);
    expect(registry.definitions[0].name).toBe('tool_a');
    expect(registry.definitions[1].name).toBe('tool_b');
  });

  it('register throws on duplicate names', () => {
    const registry = new ToolRegistry();
    registry.register(toolA);
    expect(() => registry.register(toolA)).toThrow('Tool already registered');
  });

  it('callTool dispatches through the pipeline', async () => {
    const registry = new ToolRegistry();
    registry.register(toolA);
    const result = await registry.callTool('tool_a', null, {});
    expect(result).toBeDefined();
    expect((result as any).structuredContent).toEqual({ ok: true });
  });

  it('callTool returns undefined for unknown tools', async () => {
    const registry = new ToolRegistry();
    const result = await registry.callTool('nonexistent', null, {});
    expect(result).toBeUndefined();
  });
});

describe('ToolRegistry lazy mode', () => {
  const toolCore = defineTool({
    name: 'core_tool',
    description: 'Always-on core tool',
    category: 'read',
    inputSchema: {},
    handler: async () => ({ ok: true }),
  });

  const toolScene = defineTool({
    name: 'scene_tool',
    description: 'Scene domain tool',
    category: 'read',
    inputSchema: {},
    handler: async () => ({ ok: true }),
  });

  it('definitions filters to active names when lazy mode is on', () => {
    const registry = new ToolRegistry();
    registry.register(toolCore, toolScene);
    registry.enableLazy(['core_tool']);
    const defs = registry.definitions;
    expect(defs).toHaveLength(1);
    expect(defs[0].name).toBe('core_tool');
  });

  it('definitions returns all tools when lazy mode is off', () => {
    const registry = new ToolRegistry();
    registry.register(toolCore, toolScene);
    expect(registry.definitions).toHaveLength(2);
  });

  it('activate adds names to the active set', () => {
    const registry = new ToolRegistry();
    registry.register(toolCore, toolScene);
    registry.enableLazy(['core_tool']);
    expect(registry.definitions).toHaveLength(1);
    registry.activate('scene_tool');
    expect(registry.definitions).toHaveLength(2);
  });

  it('lazyMode reflects the mode state', () => {
    const registry = new ToolRegistry();
    expect(registry.lazyMode).toBe(false);
    registry.enableLazy(['core']);
    expect(registry.lazyMode).toBe(true);
  });
});
