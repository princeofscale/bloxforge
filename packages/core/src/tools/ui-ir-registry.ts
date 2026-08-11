// The UI IR's two tools. Both pure: they read a description and return another
// one, and neither touches a place — applying the exported tree is the existing
// mutation path's job, with the confirmation and the undo record that come with
// it.
//
// Two tools rather than one because "check this design" and "build this design"
// are different questions, and folding the first into the second would put it
// behind a write category the inspector cannot serve.

import { defineTool, type RegisteredTool, type ToolRegistry } from './tool-pipeline.js';
import type { ToolDefinition } from './definitions.js';
import { exportNative, validateScreen, type UiScreen } from '../ui/ir.js';
import { exportFusion, FUSION_TARGET } from '../ui/fusion.js';

const OUTPUT = { type: 'object', additionalProperties: true };

const SCREEN = {
  screen: {
    type: 'object',
    additionalProperties: true,
    description: 'A UiScreen: id, name, tokens {color,space,text}, optional breakpoints, and a root node tree. Every style value is a token reference such as "color.accent", never a literal.',
  },
};

function screenOf(args: Record<string, unknown>): UiScreen {
  const screen = args.screen;
  if (!screen || typeof screen !== 'object' || Array.isArray(screen)) {
    throw new Error('screen must be an object describing a UiScreen.');
  }
  return screen as UiScreen;
}

const UI_IR_TOOLS: RegisteredTool[] = [
  defineTool({
    name: 'ui_validate_screen',
    description: 'Check a UI screen description before anything is built: every token reference resolves, every interactive node has a label and a place in the focus ring that nothing else claims, every responsive override names a declared breakpoint, and no two nodes share an id. Errors are what no exporter can render correctly; warnings are what it can render but nobody meant.',
    category: 'read',
    effects: [],
    inputSchema: { type: 'object', properties: SCREEN, required: ['screen'] },
    outputSchema: OUTPUT,
    handler: async (_runtime, args) => validateScreen(screenOf(args)),
  }),
  defineTool({
    name: 'ui_export_screen',
    description: 'Turn a validated UI screen into a Roblox Instance tree specification, or into a Fusion component — classes, properties, and the token each resolved value came from stamped as an attribute beside it. Returns the specification; it does not create anything. Refuses an invalid screen rather than emitting a partial tree.',
    category: 'read',
    effects: [],
    inputSchema: {
      type: 'object',
      properties: {
        ...SCREEN,
        target: { type: 'string', enum: ['native', 'fusion'], description: `Export target. "native" emits a Roblox Instance tree; "fusion" emits a Fusion ${FUSION_TARGET} component whose states actually render and whose bindings are live. React and Vide are roadmap items and are deliberately absent rather than stubbed.` },
      },
      required: ['screen'],
    },
    outputSchema: OUTPUT,
    handler: async (_runtime, args) => {
      const target = (args.target as string | undefined) ?? 'native';
      const screen = screenOf(args);
      // Fail closed on a target that does not exist rather than silently
      // emitting native and letting the caller believe they got React.
      if (target === 'native') return { target, tree: exportNative(screen) };
      // `exportFusion` reports the Fusion release it targets, which is more
      // specific than the caller's "fusion" and is the one that matters.
      if (target === 'fusion') return exportFusion(screen);
      throw new Error(`Unknown export target ${JSON.stringify(target)}. "native" and "fusion" exist today.`);
    },
  }),
];

export const UI_IR_TOOL_DEFINITIONS: ToolDefinition[] = UI_IR_TOOLS.map((tool) => tool.definition);

export function registerUiIrTools(registry: ToolRegistry): void {
  registry.register(...UI_IR_TOOLS);
}
