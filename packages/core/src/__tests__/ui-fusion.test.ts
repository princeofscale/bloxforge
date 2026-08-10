import { exportFusion, FUSION_TARGET } from '../ui/fusion.js';
import type { UiNode, UiScreen } from '../ui/ir.js';

const tokens = {
  color: { surface: '#101014', accent: '#2563eb', accentHover: '#3b82f6', onAccent: '#ffffff' },
  space: { sm: 4, md: 8, radius: 6 },
  text: { body: 14 },
};

const button = (over: Partial<UiNode> = {}): UiNode => ({
  id: 'play',
  kind: 'button',
  content: 'Play',
  style: { background: 'color.accent', foreground: 'color.onAccent', radius: 'space.radius' },
  accessibility: { label: 'Play', role: 'button', focusOrder: 1 },
  ...over,
});

const screenOf = (root: UiNode, over: Partial<UiScreen> = {}): UiScreen => ({
  id: 'menu', name: 'Main menu', tokens, breakpoints: { wide: 900 }, root, ...over,
});

const luauOf = (root: UiNode) => exportFusion(screenOf(root)).luau;

describe('what a reactive target can do that a static tree cannot', () => {
  it('turns a hover state into an event pair driving one Value', () => {
    // One Value per node, not one per state: two independent booleans would let
    // a node be hovered and not hovered at once.
    const luau = luauOf(button({ states: { hover: { background: 'color.accentHover' } } }));
    expect(luau).toMatch(/local playState = scope:Value\("default"\)/);
    expect(luau).toMatch(/\[OnEvent "MouseEnter"\] = function\(\) playState:set\("hover"\) end,/);
    expect(luau).toMatch(/\[OnEvent "MouseLeave"\] = function\(\) playState:set\("default"\) end,/);
  });

  it('makes only the properties that differ Computed', () => {
    // Wrapping every property would re-evaluate the whole tree on a mouse move.
    const luau = luauOf(button({ states: { hover: { background: 'color.accentHover' } } }));
    expect(luau).toMatch(/BackgroundColor3 = scope:Computed\(function\(use\)/);
    expect(luau).toMatch(/if state == "hover" then return Color3\.fromRGB\(59, 130, 246\) end/);
    // The foreground does not differ between states, so it stays a plain value.
    expect(luau).toMatch(/TextColor3 = Color3\.fromRGB\(255, 255, 255\),/);
  });

  it('makes a binding live rather than writing it once', () => {
    const luau = luauOf({ id: 'coins', kind: 'text', binding: { source: 'player.Coins', property: 'content' } });
    expect(luau).toMatch(/Text = scope:Computed\(function\(use\) return use\(props\.player_Coins\) end\),/);
  });

  it('drives pressed from the mouse button, not from hover', () => {
    const luau = luauOf(button({ states: { pressed: { background: 'color.surface' } } }));
    expect(luau).toMatch(/OnEvent "MouseButton1Down"/);
    expect(luau).toMatch(/OnEvent "MouseButton1Up"/);
  });
});

describe('refusals', () => {
  it('refuses a state no event drives, rather than emitting a style that never applies', () => {
    // A hover colour that never appears is harder to notice than one that was
    // never generated.
    expect(() => exportFusion(screenOf(button({ states: { disabled: { background: 'color.surface' } } }))))
      .toThrow(/no event drives disabled/);
  });

  it('names the states it can drive when it refuses', () => {
    expect(() => exportFusion(screenOf(button({ states: { focused: { background: 'color.surface' } } }))))
      .toThrow(/drives hover and pressed/);
  });

  it('refuses an invalid screen before generating anything', () => {
    expect(() => exportFusion(screenOf(button({ style: { background: 'color.missing' } }))))
      .toThrow(/Cannot export menu: 1 error\(s\)/);
  });
});

describe('the generated module', () => {
  const luau = () => luauOf({
    id: 'root', kind: 'frame',
    layout: { direction: 'column' },
    style: { background: 'color.surface', padding: 'space.md', gap: 'space.sm', radius: 'space.radius' },
    children: [button()],
  });

  it('says which Fusion release it targets instead of leaving it to be discovered', () => {
    // Pre-0.3 has no scopes and would reject every line of this.
    expect(luau()).toMatch(new RegExp(`Targets Fusion ${FUSION_TARGET}`));
    expect(FUSION_TARGET).toBe('0.3');
  });

  it('uses the scoped API verified in Fusion 0.3, not the pre-0.3 shape', () => {
    const out = luau();
    expect(out).toMatch(/scope = scope or Fusion\.scoped\(Fusion\)/);
    expect(out).toMatch(/scope:New "Frame" \{/);
    expect(out).toMatch(/\[Children\] = \{/);
  });

  it('emits the layout helpers as children, which is what they are in Roblox', () => {
    const out = luau();
    expect(out).toMatch(/scope:New "UICorner" \{ CornerRadius = UDim\.new\(0, 6\) \}/);
    expect(out).toMatch(/scope:New "UIPadding" \{ PaddingTop = UDim\.new\(0, 8\)/);
    expect(out).toMatch(/scope:New "UIListLayout" \{ FillDirection = Enum\.FillDirection\.Vertical, SortOrder = Enum\.SortOrder\.LayoutOrder, Padding = UDim\.new\(0, 4\) \}/);
  });

  it('accepts a caller-supplied scope so the component can be torn down with its parent', () => {
    expect(luau()).toMatch(/return function\(props, scope\)/);
  });

  it('makes a focusable node selectable, not merely ordered', () => {
    expect(luau()).toMatch(/Selectable = true,\n\t*SelectionOrder = 1,/);
  });

  it('leaves a node with no background transparent rather than defaulting it', () => {
    expect(luauOf({ id: 'x', kind: 'frame' })).toMatch(/BackgroundTransparency = 1,/);
  });
});
