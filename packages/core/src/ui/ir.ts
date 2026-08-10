// One description of an interface, and several ways to emit it.
//
// Roadmap 04, item 5. The alternative is a tool per UI library, each generating
// its own tree from its own half of the requirements — and then "make the
// button disabled state match" is a change in four places that drift apart the
// first week.
//
// So: one IR, validated once, and exporters that are dumb translations of it.
// Everything a target could disagree about — what a token means, which nodes
// are focusable, what happens at a narrow width — is decided here.
//
// The rule that makes this more than a schema: **a style value is a token
// reference, never a literal.** `Color3.fromRGB(37, 99, 235)` in a component is
// a number nobody can re-theme and nobody can audit; `surface.accent` is a
// decision with a name. This is the same contract `design_lint` already
// enforces on live instances, pushed one step earlier — to before the instance
// exists.

export type NodeKind = 'frame' | 'text' | 'button' | 'image' | 'input' | 'list';

/** The interaction states a target has to be able to render. */
export const STATES = ['default', 'hover', 'pressed', 'disabled', 'focused'] as const;
export type StateName = (typeof STATES)[number];

export interface TokenSet {
  /** Colours as `#rrggbb`. The only place a literal colour is allowed to exist. */
  color: Record<string, string>;
  /** Spacing, radius and stroke in pixels. */
  space: Record<string, number>;
  /** Text sizes in pixels. */
  text: Record<string, number>;
}

export type TokenRef = `color.${string}` | `space.${string}` | `text.${string}`;

export interface Style {
  background?: TokenRef;
  foreground?: TokenRef;
  border?: TokenRef;
  radius?: TokenRef;
  padding?: TokenRef;
  gap?: TokenRef;
  fontSize?: TokenRef;
}

export interface Layout {
  /** Fraction of the parent, 0..1. Absolute pixels are deliberately not offered. */
  width?: number;
  height?: number;
  /** Fixed pixel size, when a fraction genuinely is wrong (an icon, a divider). */
  widthPx?: number;
  heightPx?: number;
  direction?: 'row' | 'column';
  align?: 'start' | 'center' | 'end' | 'stretch';
  justify?: 'start' | 'center' | 'end' | 'space-between';
  order?: number;
}

export interface Accessibility {
  /** What a screen reader or a controller-navigation hint would say. */
  label?: string;
  role?: 'button' | 'heading' | 'image' | 'text' | 'input' | 'list' | 'group';
  /** Position in the focus ring. Interactive nodes need one; others must not have one. */
  focusOrder?: number;
  /** Marks a node as decorative, which is how an image legitimately has no label. */
  decorative?: boolean;
}

export interface UiNode {
  id: string;
  kind: NodeKind;
  /** Literal text. A `text` or `button` without it renders an empty box. */
  content?: string;
  layout?: Layout;
  style?: Style;
  /** Style overrides per interaction state. `default` is the node's own style. */
  states?: Partial<Record<Exclude<StateName, 'default'>, Style>>;
  /** Named alternatives — `primary`, `danger` — as overrides on the same node. */
  variants?: Record<string, Style>;
  /** Layout overrides per breakpoint name. */
  responsive?: Record<string, Layout>;
  /** What drives this node at runtime, as a path a target resolves. */
  binding?: { source: string; property: 'content' | 'visible' | 'enabled' };
  accessibility?: Accessibility;
  children?: UiNode[];
}

export interface UiScreen {
  id: string;
  name: string;
  tokens: TokenSet;
  /** Breakpoint name to minimum width in pixels. */
  breakpoints?: Record<string, number>;
  root: UiNode;
}

const INTERACTIVE: ReadonlySet<NodeKind> = new Set<NodeKind>(['button', 'input']);
const NEEDS_CONTENT: ReadonlySet<NodeKind> = new Set<NodeKind>(['text', 'button']);

export interface ValidationIssue {
  nodeId?: string;
  rule: string;
  message: string;
  severity: 'error' | 'warning';
}

/**
 * Everything a target would otherwise have to decide for itself.
 *
 * Errors are things no exporter can render correctly; warnings are things it
 * can render but nobody meant. The split matters because an exporter refuses on
 * an error and proceeds on a warning, and mixing them turns either into noise.
 */
export function validateScreen(screen: UiScreen): { ok: boolean; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  const add = (severity: 'error' | 'warning', rule: string, message: string, nodeId?: string) =>
    issues.push({ severity, rule, message, ...(nodeId ? { nodeId } : {}) });

  if (!screen.root) {
    add('error', 'root', 'The screen has no root node.');
    return { ok: false, issues };
  }

  const seenIds = new Set<string>();
  const focusOrders: { id: string; order: number }[] = [];
  const breakpoints = new Set(Object.keys(screen.breakpoints ?? {}));

  const visit = (node: UiNode, depth: number) => {
    if (!node.id) add('error', 'id', 'A node has no id, so nothing can refer to it.');
    else if (seenIds.has(node.id)) add('error', 'id', `Duplicate node id ${node.id}; a binding or an override could not say which one it meant.`, node.id);
    else seenIds.add(node.id);

    for (const [where, style] of styleEntries(node)) {
      for (const [property, ref] of Object.entries(style)) {
        if (typeof ref !== 'string') continue;
        if (!resolveToken(screen.tokens, ref)) {
          add('error', 'token', `${where}.${property} refers to ${ref}, which the token set does not define.`, node.id);
        }
      }
    }

    if (NEEDS_CONTENT.has(node.kind) && !node.content && !node.binding) {
      add('warning', 'content', `A ${node.kind} with neither content nor a binding renders an empty box.`, node.id);
    }

    const a11y = node.accessibility;
    if (INTERACTIVE.has(node.kind)) {
      if (!a11y?.label) add('error', 'a11y-label', `An interactive ${node.kind} has no accessible label, so it is unreachable by anything but a mouse.`, node.id);
      if (a11y?.focusOrder === undefined) add('error', 'a11y-focus', `An interactive ${node.kind} has no focusOrder, so controller and keyboard navigation skip it.`, node.id);
      else focusOrders.push({ id: node.id, order: a11y.focusOrder });
    } else if (a11y?.focusOrder !== undefined) {
      add('warning', 'a11y-focus', `A ${node.kind} declares focusOrder but is not interactive; the focus ring would stop on nothing.`, node.id);
    }
    if (node.kind === 'image' && !a11y?.label && !a11y?.decorative) {
      add('warning', 'a11y-label', 'An image is neither labelled nor marked decorative, so it is ambiguous rather than absent.', node.id);
    }

    for (const name of Object.keys(node.responsive ?? {})) {
      if (!breakpoints.has(name)) {
        add('error', 'responsive', `Override for breakpoint ${name}, which the screen does not define.`, node.id);
      }
    }

    if (depth > 24) add('warning', 'depth', 'Nesting past 24 levels; most of it is unlikely to be doing anything.', node.id);
    for (const child of node.children ?? []) visit(child, depth + 1);
  };
  visit(screen.root, 0);

  const orders = focusOrders.map((f) => f.order);
  const duplicated = orders.filter((o, i) => orders.indexOf(o) !== i);
  if (duplicated.length > 0) {
    add('error', 'a11y-focus', `Focus order ${[...new Set(duplicated)].join(', ')} used more than once; the ring's path is then undefined.`);
  }

  return { ok: !issues.some((i) => i.severity === 'error'), issues };
}

function styleEntries(node: UiNode): [string, Style][] {
  const rows: [string, Style][] = [];
  if (node.style) rows.push(['style', node.style]);
  for (const [state, style] of Object.entries(node.states ?? {})) rows.push([`states.${state}`, style]);
  for (const [variant, style] of Object.entries(node.variants ?? {})) rows.push([`variants.${variant}`, style]);
  return rows;
}

/** Resolve a token reference, or `undefined` when it names nothing. Never a default. */
export function resolveToken(tokens: TokenSet, ref: string): string | number | undefined {
  const split = ref.indexOf('.');
  if (split <= 0) return undefined;
  const group = ref.slice(0, split);
  const key = ref.slice(split + 1);
  if (group === 'color') return tokens.color[key];
  if (group === 'space') return tokens.space[key];
  if (group === 'text') return tokens.text[key];
  return undefined;
}

// ─── Native Instance exporter ────────────────────────────────────────

export interface NativeInstance {
  className: string;
  name: string;
  properties: Record<string, unknown>;
  /** Attributes, including the token key each resolved value came from. */
  attributes: Record<string, unknown>;
  children: NativeInstance[];
}

const CLASS_OF: Record<NodeKind, string> = {
  frame: 'Frame',
  text: 'TextLabel',
  button: 'TextButton',
  image: 'ImageLabel',
  input: 'TextBox',
  list: 'ScrollingFrame',
};

/**
 * Emit Roblox Instances.
 *
 * Refuses an invalid screen rather than emitting a partial tree: half a UI in a
 * place is harder to find and fix than none, because it looks like a bug in the
 * design instead of a refusal to build one.
 *
 * Every resolved token is stamped as an attribute next to the value it produced
 * — the same trick `apply_theme` uses, and for the same reason: without it, a
 * later reader sees a colour and cannot tell whether it came from the theme or
 * from somebody's hand.
 */
export function exportNative(screen: UiScreen): NativeInstance {
  const verdict = validateScreen(screen);
  if (!verdict.ok) {
    const errors = verdict.issues.filter((i) => i.severity === 'error');
    throw new Error(`Cannot export ${screen.id}: ${errors.length} error(s). First: ${errors[0].rule} — ${errors[0].message}`);
  }
  return instanceOf(screen, screen.root);
}

function instanceOf(screen: UiScreen, node: UiNode): NativeInstance {
  const properties: Record<string, unknown> = {};
  const attributes: Record<string, unknown> = { BloxForgeNodeId: node.id, BloxForgeKind: node.kind };

  const put = (ref: TokenRef | undefined, apply: (value: string | number) => void, attributeKey: string) => {
    if (!ref) return;
    const value = resolveToken(screen.tokens, ref);
    if (value === undefined) return; // validate() already refused this screen
    apply(value);
    attributes[attributeKey] = ref;
  };

  const style = node.style ?? {};
  put(style.background, (v) => { properties.BackgroundColor3 = hexToRgb(String(v)); }, 'BloxForgeToken_Background');
  put(style.foreground, (v) => { properties.TextColor3 = hexToRgb(String(v)); }, 'BloxForgeToken_Foreground');
  put(style.border, (v) => { properties.BorderColor3 = hexToRgb(String(v)); }, 'BloxForgeToken_Border');
  put(style.fontSize, (v) => { properties.TextSize = Number(v); }, 'BloxForgeToken_FontSize');

  if (node.content !== undefined) properties.Text = node.content;
  if (node.kind === 'button' || node.kind === 'input') properties.AutoButtonColor = false;
  properties.Size = udim2Of(node.layout);
  if (style.background === undefined) properties.BackgroundTransparency = 1;

  const children: NativeInstance[] = [];
  // A radius or a padding is a child Instance in Roblox, not a property. The
  // token stamp goes on the child that carries the value, so a reader who finds
  // the UICorner finds the decision that put it there.
  put(style.radius, (v) => children.push({
    className: 'UICorner', name: 'Corner',
    properties: { CornerRadius: { scale: 0, offset: Number(v) } },
    attributes: { BloxForgeToken_Radius: style.radius }, children: [],
  }), 'BloxForgeToken_Radius');
  put(style.padding, (v) => children.push({
    className: 'UIPadding', name: 'Padding',
    properties: Object.fromEntries(['PaddingTop', 'PaddingBottom', 'PaddingLeft', 'PaddingRight']
      .map((side) => [side, { scale: 0, offset: Number(v) }])),
    attributes: { BloxForgeToken_Padding: style.padding }, children: [],
  }), 'BloxForgeToken_Padding');

  if (node.layout?.direction) {
    const gap = style.gap ? resolveToken(screen.tokens, style.gap) : undefined;
    children.push({
      className: 'UIListLayout', name: 'Layout',
      properties: {
        FillDirection: node.layout.direction === 'row' ? 'Horizontal' : 'Vertical',
        HorizontalAlignment: alignmentOf(node.layout.align),
        VerticalAlignment: alignmentOf(node.layout.justify),
        SortOrder: 'LayoutOrder',
        ...(gap === undefined ? {} : { Padding: { scale: 0, offset: Number(gap) } }),
      },
      attributes: style.gap ? { BloxForgeToken_Gap: style.gap } : {},
      children: [],
    });
  }
  if (node.layout?.order !== undefined) properties.LayoutOrder = node.layout.order;

  if (node.accessibility?.label) attributes.BloxForgeLabel = node.accessibility.label;
  if (node.accessibility?.role) attributes.BloxForgeRole = node.accessibility.role;
  if (node.accessibility?.focusOrder !== undefined) {
    properties.SelectionOrder = node.accessibility.focusOrder;
    properties.Selectable = true;
  }
  if (node.binding) attributes.BloxForgeBinding = `${node.binding.property}=${node.binding.source}`;
  // States and variants are data, not instances: a target that can react (a
  // script, Fusion, React) reads them, and a static tree simply has the default.
  // Emitting five copies of a button would be the other, worse answer.
  if (node.states) attributes.BloxForgeStates = JSON.stringify(node.states);
  if (node.variants) attributes.BloxForgeVariants = JSON.stringify(node.variants);
  if (node.responsive) attributes.BloxForgeResponsive = JSON.stringify(node.responsive);

  for (const child of node.children ?? []) children.push(instanceOf(screen, child));

  return { className: CLASS_OF[node.kind], name: node.id, properties, attributes, children };
}

function alignmentOf(value: Layout['align'] | Layout['justify']): string {
  switch (value) {
    case 'center': return 'Center';
    case 'end': return 'Right';
    case 'space-between': return 'Center';
    default: return 'Left';
  }
}

function udim2Of(layout: Layout | undefined): { xScale: number; xOffset: number; yScale: number; yOffset: number } {
  return {
    xScale: layout?.widthPx === undefined ? layout?.width ?? 1 : 0,
    xOffset: layout?.widthPx ?? 0,
    yScale: layout?.heightPx === undefined ? layout?.height ?? 1 : 0,
    yOffset: layout?.heightPx ?? 0,
  };
}

/** `#rrggbb` to 0..255 channels. Throws on anything else rather than returning black. */
export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const matched = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!matched) throw new Error(`Not a #rrggbb colour: ${JSON.stringify(hex)}. A colour that silently became black is a bug nobody reports.`);
  const value = parseInt(matched[1], 16);
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}
