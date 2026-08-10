import {
  exportNative,
  hexToRgb,
  resolveToken,
  validateScreen,
  type NativeInstance,
  type UiNode,
  type UiScreen,
} from '../ui/ir.js';

const tokens = {
  color: { surface: '#101014', accent: '#2563eb', onAccent: '#ffffff' },
  space: { sm: 4, md: 8, radius: 6 },
  text: { body: 14, title: 24 },
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
  id: 'menu', name: 'Main menu', tokens, breakpoints: { narrow: 0, wide: 900 }, root, ...over,
});

const find = (tree: NativeInstance, name: string): NativeInstance | undefined =>
  tree.name === name ? tree : tree.children.map((c) => find(c, name)).find(Boolean);

describe('token references', () => {
  it('resolves a reference and refuses one that names nothing', () => {
    expect(resolveToken(tokens, 'color.accent')).toBe('#2563eb');
    expect(resolveToken(tokens, 'color.invented')).toBeUndefined();
    expect(resolveToken(tokens, 'nonsense')).toBeUndefined();
    expect(resolveToken(tokens, 'shadow.big')).toBeUndefined();
  });

  it('rejects a style pointing at a token the screen does not define', () => {
    // A literal colour is a number nobody can re-theme; a dangling reference is
    // worse, because it looks like a decision that was made.
    const broken = validateScreen(screenOf(button({ style: { background: 'color.brand' } })));
    expect(broken.ok).toBe(false);
    expect(broken.issues[0]).toMatchObject({ rule: 'token', nodeId: 'play' });
    expect(broken.issues[0].message).toMatch(/which the token set does not define/);
  });

  it('checks state and variant styles too, not only the default one', () => {
    const hoverOnly = validateScreen(screenOf(button({
      states: { hover: { background: 'color.accentHover' } },
    })));
    expect(hoverOnly.issues.map((i) => i.message).join(' ')).toMatch(/states\.hover\.background/);
  });
});

describe('accessibility', () => {
  it('refuses an interactive node with no label', () => {
    const unlabelled = validateScreen(screenOf(button({ accessibility: { focusOrder: 1 } })));
    expect(unlabelled.ok).toBe(false);
    expect(unlabelled.issues[0].message).toMatch(/unreachable by anything but a mouse/);
  });

  it('refuses an interactive node with no place in the focus ring', () => {
    const unfocusable = validateScreen(screenOf(button({ accessibility: { label: 'Play' } })));
    expect(unfocusable.issues[0].message).toMatch(/controller and keyboard navigation skip it/);
  });

  it('refuses two nodes claiming the same focus position', () => {
    // With a duplicate the ring's path is undefined, and which one gets focus
    // depends on the exporter — which is exactly what the IR exists to decide.
    const two = validateScreen(screenOf({
      id: 'row', kind: 'frame',
      children: [button(), button({ id: 'quit', content: 'Quit', accessibility: { label: 'Quit', focusOrder: 1 } })],
    }));
    expect(two.ok).toBe(false);
    expect(two.issues.some((i) => i.message.includes("ring's path is then undefined"))).toBe(true);
  });

  it('warns about a focus order on something nothing can focus', () => {
    const odd = validateScreen(screenOf({ id: 'label', kind: 'text', content: 'Hi', accessibility: { focusOrder: 2 } }));
    expect(odd.ok).toBe(true);
    expect(odd.issues[0]).toMatchObject({ severity: 'warning', rule: 'a11y-focus' });
  });

  it('lets an image be unlabelled only by saying it is decorative', () => {
    expect(validateScreen(screenOf({ id: 'bg', kind: 'image' })).issues[0].rule).toBe('a11y-label');
    expect(validateScreen(screenOf({ id: 'bg', kind: 'image', accessibility: { decorative: true } })).issues).toEqual([]);
  });
});

describe('structure', () => {
  it('refuses duplicate ids, since a binding could not say which it meant', () => {
    const clash = validateScreen(screenOf({
      id: 'root', kind: 'frame',
      children: [{ id: 'same', kind: 'text', content: 'a' }, { id: 'same', kind: 'text', content: 'b' }],
    }));
    expect(clash.ok).toBe(false);
    expect(clash.issues[0].message).toMatch(/Duplicate node id same/);
  });

  it('refuses a responsive override for a breakpoint the screen never declared', () => {
    const ghost = validateScreen(screenOf(button({ responsive: { tablet: { width: 0.5 } } })));
    expect(ghost.ok).toBe(false);
    expect(ghost.issues[0].message).toMatch(/breakpoint tablet, which the screen does not define/);
  });

  it('warns rather than fails on text with nothing to show', () => {
    const empty = validateScreen(screenOf({ id: 't', kind: 'text' }));
    expect(empty.ok).toBe(true);
    expect(empty.issues[0]).toMatchObject({ severity: 'warning', rule: 'content' });
  });

  it('accepts a binding in place of literal content', () => {
    expect(validateScreen(screenOf({
      id: 't', kind: 'text', binding: { source: 'player.Coins', property: 'content' },
    })).issues).toEqual([]);
  });
});

describe('the native exporter', () => {
  const tree = () => exportNative(screenOf({
    id: 'root', kind: 'frame',
    layout: { direction: 'column', align: 'center' },
    style: { background: 'color.surface', padding: 'space.md', gap: 'space.sm' },
    children: [button()],
  }));

  it('refuses an invalid screen rather than emitting half a UI', () => {
    // Half a UI in a place looks like a bug in the design, not like a refusal
    // to build one, and is much harder to find.
    expect(() => exportNative(screenOf(button({ style: { background: 'color.nope' } }))))
      .toThrow(/Cannot export menu: 1 error\(s\)\. First: token/);
  });

  it('maps each kind to its Roblox class', () => {
    expect(tree().className).toBe('Frame');
    expect(find(tree(), 'play')!.className).toBe('TextButton');
  });

  it('resolves tokens to values and stamps which token produced each one', () => {
    // Without the stamp a later reader sees a colour and cannot tell whether it
    // came from the theme or from somebody's hand.
    const play = find(tree(), 'play')!;
    expect(play.properties.BackgroundColor3).toEqual({ r: 37, g: 99, b: 235 });
    expect(play.attributes.BloxForgeToken_Background).toBe('color.accent');
  });

  it('puts the radius stamp on the child that carries the radius', () => {
    const corner = find(tree(), 'Corner')!;
    expect(corner.className).toBe('UICorner');
    expect(corner.properties.CornerRadius).toEqual({ scale: 0, offset: 6 });
    expect(corner.attributes.BloxForgeToken_Radius).toBe('space.radius');
  });

  it('turns a direction into a UIListLayout and the gap into its padding', () => {
    const layout = find(tree(), 'Layout')!;
    expect(layout.properties).toMatchObject({ FillDirection: 'Vertical', Padding: { scale: 0, offset: 4 } });
    expect(layout.attributes.BloxForgeToken_Gap).toBe('space.sm');
  });

  it('carries states and variants as data instead of five copies of a button', () => {
    const withStates = exportNative(screenOf(button({ states: { hover: { background: 'color.onAccent' } } })));
    expect(JSON.parse(String(withStates.attributes.BloxForgeStates))).toEqual({ hover: { background: 'color.onAccent' } });
    // One button, not one per state.
    expect(withStates.children.filter((c) => c.className === 'TextButton')).toHaveLength(0);
  });

  it('makes a focusable node actually selectable, not only ordered', () => {
    const play = find(tree(), 'play')!;
    expect(play.properties).toMatchObject({ Selectable: true, SelectionOrder: 1 });
  });

  it('leaves a node with no background transparent rather than defaulting it to white', () => {
    const bare = exportNative(screenOf({ id: 'x', kind: 'frame' }));
    expect(bare.properties.BackgroundTransparency).toBe(1);
    expect(bare.properties.BackgroundColor3).toBeUndefined();
  });

  it('uses scale by default and offset only when pixels were asked for', () => {
    const sized = exportNative(screenOf({ id: 'x', kind: 'frame', layout: { width: 0.5, heightPx: 32 } }));
    expect(sized.properties.Size).toEqual({ xScale: 0.5, xOffset: 0, yScale: 0, yOffset: 32 });
  });
});

describe('colour parsing', () => {
  it('reads a six-digit hex with or without the hash', () => {
    expect(hexToRgb('#ffffff')).toEqual({ r: 255, g: 255, b: 255 });
    expect(hexToRgb('2563eb')).toEqual({ r: 37, g: 99, b: 235 });
  });

  it('throws instead of quietly producing black', () => {
    // A colour that silently became black is a bug nobody reports, because the
    // UI still renders.
    for (const bad of ['#fff', 'rebeccapurple', '', '#12345g']) {
      expect(() => hexToRgb(bad)).toThrow(/Not a #rrggbb colour/);
    }
  });
});
