// The network IR's two tools, plus the scene tree diff.
//
// All three are pure: they read a description and return another one. Nothing
// here touches a place — creating the remotes and installing the modules is the
// existing mutation path's job, with the confirmation and the undo record that
// come with it.

import { defineTool, type RegisteredTool, type ToolRegistry } from './tool-pipeline.js';
import type { ToolDefinition } from './definitions.js';
import { generateNative, validateSurface, type NetworkSurface } from '../network/ir.js';
import { diffTrees, summarizeDiff, type TreeNode } from '../scene/tree-diff.js';

const OUTPUT = { type: 'object', additionalProperties: true };

const SURFACE = {
  surface: {
    type: 'object',
    additionalProperties: true,
    description: 'A NetworkSurface: folder, plus messages each carrying direction, kind (event or request), reliable, args, and — for client-to-server — a rateLimit and a permission.',
  },
};

function surfaceOf(args: Record<string, unknown>): NetworkSurface {
  const surface = args.surface;
  if (!surface || typeof surface !== 'object' || Array.isArray(surface)) {
    throw new Error('surface must be an object describing a NetworkSurface.');
  }
  return surface as NetworkSurface;
}

function treeOf(args: Record<string, unknown>, key: string): TreeNode {
  const tree = args[key];
  if (!tree || typeof tree !== 'object' || Array.isArray(tree)) {
    throw new Error(`${key} must be an object with name, className, and optionally properties and children.`);
  }
  return tree as TreeNode;
}

const NETWORK_TOOLS: RegisteredTool[] = [
  defineTool({
    name: 'network_validate_surface',
    description: 'Check a game\'s network surface before a remote exists. Refuses client-to-server traffic with no rate limit (a client can fire a remote in a loop — that is the exploit, not a performance note), with no declared permission, or with an argument type nothing can be checked against. Also refuses a request from server to client, where the client can never return and the server thread waits forever.',
    category: 'read',
    effects: [],
    inputSchema: { type: 'object', properties: SURFACE, required: ['surface'] },
    outputSchema: OUTPUT,
    handler: async (_runtime, args) => validateSurface(surfaceOf(args)),
  }),
  defineTool({
    name: 'network_generate',
    description: 'Generate the remotes and the Luau that guards them: a per-player token bucket, a permission check, and a type guard per argument, all from the declared surface. Returns the instance list and the server and client modules; it creates nothing. Refuses an invalid surface rather than generating half a network layer, because the missing half would be a guard and an absent guard looks exactly like one that passed.',
    category: 'read',
    effects: [],
    inputSchema: {
      type: 'object',
      properties: {
        ...SURFACE,
        target: { type: 'string', enum: ['native'], description: 'Only "native" (RemoteEvent/RemoteFunction plus generated guards) exists. ByteNet, Remo and TypedRemote targets are roadmap items and are absent rather than stubbed.' },
      },
      required: ['surface'],
    },
    outputSchema: OUTPUT,
    handler: async (_runtime, args) => {
      const target = (args.target as string | undefined) ?? 'native';
      if (target !== 'native') throw new Error(`Unknown network target ${JSON.stringify(target)}. Only "native" exists today.`);
      return { target, ...generateNative(surfaceOf(args)) };
    },
  }),
  defineTool({
    name: 'scene_diff_trees',
    description: 'Compare two instance trees and report what changed: a reparent as one move rather than a delete and an add, a class change as its own kind rather than as a property, and float differences inside a tolerance as no change at all. Unchanged subtrees are named once instead of walked. Works on any tree — a Studio read, a generated one, or a committed fixture.',
    category: 'read',
    effects: [],
    inputSchema: {
      type: 'object',
      properties: {
        before: { type: 'object', additionalProperties: true, description: 'Tree node: name, className, optional id, properties and children. Give each node a stable id when you have one: children are matched by id when both sides carry one and by name otherwise, and a reparent is only reportable as a move when the node can be identified in its new home.' },
        after: { type: 'object', additionalProperties: true, description: 'The same shape, after whatever happened.' },
        ignoreProperties: { type: 'array', items: { type: 'string' }, description: 'Properties to leave out entirely — timestamps, generated ids.' },
        epsilon: { type: 'number', description: 'Numbers closer than this count as equal. Defaults to 1e-6.' },
      },
      required: ['before', 'after'],
    },
    outputSchema: OUTPUT,
    handler: async (_runtime, args) => {
      const diff = diffTrees(treeOf(args, 'before'), treeOf(args, 'after'), {
        ignoreProperties: args.ignoreProperties as string[] | undefined,
        epsilon: args.epsilon as number | undefined,
      });
      return { ...diff, summary: summarizeDiff(diff) };
    },
  }),
];

export const NETWORK_TOOL_DEFINITIONS: ToolDefinition[] = NETWORK_TOOLS.map((tool) => tool.definition);

export function registerNetworkTools(registry: ToolRegistry): void {
  registry.register(...NETWORK_TOOLS);
}
