// Four tools for every integration, however many packs there are.
//
// The catalog costs 49.9k tokens per request in full mode. Three tools per
// library would put that cost on every agent on every call, including the ones
// that never touch the library — so a pack adds a row to `integration_inspect`,
// not four rows to the catalog.
//
// `integration_apply` re-plans internally and compares hashes rather than
// taking a plan back over the wire. Same reason `wally_install_apply` does: a
// plan that survives the round trip unchanged is not evidence that the project
// did.

import { defineTool, type RegisteredTool, type ToolRegistry } from './tool-pipeline.js';
import type { ToolDefinition } from './definitions.js';
import {
  applyIntegration,
  fileContext,
  inspectIntegration,
  listPacks,
  PACK_EFFECT_CEILING,
  planIntegration,
  validateIntegration,
} from '../integrations/pack.js';
import { resolve } from 'node:path';
// Side-effect import: registers the packs that ship with BloxForge.
import '../integrations/builtin.js';

const OUTPUT = { type: 'object', additionalProperties: true };

const PACK_ID = {
  packId: { type: 'string', description: 'Integration pack id. Omit on integration_inspect to list every registered pack.' },
};
const ROOT = {
  root: { type: 'string', description: 'Project root, inside BLOXFORGE_PROJECT_ROOT. Defaults to it.' },
};
const REQUEST = {
  request: {
    type: 'object',
    additionalProperties: true,
    description: 'Pack-specific arguments. Hashed into planHash by content, so key order does not matter but every value does.',
  },
};

function rootOf(args: Record<string, unknown>): string {
  const base = process.env.BLOXFORGE_PROJECT_ROOT?.trim() || process.cwd();
  return resolve(base, (args.root as string | undefined) ?? '.');
}

const INTEGRATION_TOOLS: RegisteredTool[] = [
  defineTool({
    name: 'integration_inspect',
    description: 'List the registered integration packs, or detect one in this project: whether it is present, which version and variant, and the evidence that decided it. Reads only. Each pack reports its licence and the primary source it was written against.',
    category: 'read',
    effects: ['local.files.read', 'local.process.execute'],
    inputSchema: { type: 'object', properties: { ...PACK_ID, ...ROOT } },
    outputSchema: OUTPUT,
    handler: async (_runtime, args) => {
      const packId = args.packId as string | undefined;
      if (!packId) return { packs: listPacks() };
      return inspectIntegration(packId, fileContext(rootOf(args)));
    },
  }),
  defineTool({
    name: 'integration_plan',
    description: 'Preview what a pack would change, as ordered steps each marked automatic or blocked. Writes nothing. Returns a planHash covering the pack version, the request, the steps, every file the plan depends on, and every remote identity it resolved.',
    category: 'read',
    effects: ['local.files.read', 'local.process.execute', 'network.external'],
    inputSchema: {
      type: 'object',
      properties: { ...PACK_ID, ...ROOT, ...REQUEST },
      required: ['packId'],
    },
    outputSchema: OUTPUT,
    handler: async (_runtime, args) => planIntegration(
      args.packId as string,
      fileContext(rootOf(args)),
      (args.request as Record<string, unknown> | undefined) ?? {},
    ),
  }),
  defineTool({
    name: 'integration_apply',
    description: 'Run the automatic steps of a previously planned integration, in order, re-reading each step\'s files immediately before it writes. Requires confirm=true and an expectedPlanHash that still matches; a blocked step is never run and is reported with what would permit it.',
    category: 'write',
    effects: [...PACK_EFFECT_CEILING],
    inputSchema: {
      type: 'object',
      properties: {
        ...PACK_ID,
        ...ROOT,
        ...REQUEST,
        confirm: { type: 'boolean', description: 'Required to execute. Modifies the project.' },
        expectedPlanHash: { type: 'string', description: 'planHash returned by integration_plan for the same packId and request.' },
      },
      required: ['packId', 'confirm', 'expectedPlanHash'],
    },
    outputSchema: OUTPUT,
    handler: async (_runtime, args) => {
      const ctx = fileContext(rootOf(args));
      const request = (args.request as Record<string, unknown> | undefined) ?? {};
      const plan = await planIntegration(args.packId as string, ctx, request);
      return applyIntegration(
        args.packId as string,
        ctx,
        plan,
        args.expectedPlanHash as string | undefined,
        args.confirm as boolean | undefined,
      );
    },
  }),
  defineTool({
    name: 'integration_validate',
    description: 'Run the postconditions a pack declares for itself and report each as pass, fail or unknown. An unknown blocking check fails the validation: a check that could not run is not a check that passed.',
    category: 'read',
    effects: ['local.files.read', 'local.process.execute'],
    inputSchema: {
      type: 'object',
      properties: {
        ...PACK_ID,
        ...ROOT,
        request: {
          type: 'object',
          additionalProperties: true,
          description: 'Pack-specific arguments a check needs but cannot discover — an allowlist, a project file name.',
        },
      },
      required: ['packId'],
    },
    outputSchema: OUTPUT,
    handler: async (_runtime, args) => validateIntegration(
      args.packId as string,
      fileContext(rootOf(args)),
      (args.request as Record<string, unknown> | undefined) ?? {},
    ),
  }),
];

export const INTEGRATION_TOOL_DEFINITIONS: ToolDefinition[] = INTEGRATION_TOOLS.map((tool) => tool.definition);

export function registerIntegrationTools(registry: ToolRegistry): void {
  registry.register(...INTEGRATION_TOOLS);
}
