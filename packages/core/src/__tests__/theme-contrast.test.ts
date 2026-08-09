import { THEMES, ThemeTokens, getDesignCatalog, buildDesignLintLuau } from '../builders/design-builders.js';

// design_lint now fails UI whose text is under WCAG 2.2 AA. The palette that
// `apply_theme` writes, and that `ui_component_catalog` tells an agent to build
// against, has to clear the same bar — otherwise the tool flags what its own
// canon produced.
//
// It did not. White on the old `primary` (indigo-6, #4C6EF5) is 4.32:1, under
// the 4.5:1 minimum, in both themes — and that is the single pair the `button`
// recipe names. Light `muted` was 3.15:1 and light `danger` 4.28:1.
//
// This is a property of the constants, so it is checked here rather than
// through Studio: an edit to THEMES that drops a pair below its threshold fails
// on the next run, naming the pair and the ratio.

// 0.04045, per WCAG 2.2: "Before May 2021 the value of 0.04045 in the
// definition was different (0.03928). It was taken from an older version of the
// specification and has been updated."
const SRGB_LINEAR_BREAKPOINT = 0.04045;

const srgbToLinear = (channel: number) => {
  const c = channel / 255;
  return c <= SRGB_LINEAR_BREAKPOINT ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

const luminance = ([r, g, b]: [number, number, number]) =>
  0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);

const contrastRatio = (a: [number, number, number], b: [number, number, number]) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// 4.5:1 for normal text, 3:1 for a non-text UI cue (WCAG 2.2 1.4.3 / 1.4.11).
// `primary` on a surface is the fill of a button, not text on it.
const PAIRS: Array<[keyof ThemeTokens, keyof ThemeTokens, number]> = [
  ['text', 'bg', 4.5],
  ['text', 'surface', 4.5],
  ['muted', 'bg', 4.5],
  ['muted', 'surface', 4.5],
  ['danger', 'bg', 4.5],
  ['danger', 'surface', 4.5],
  ['onPrimary', 'primary', 4.5],
  ['primary', 'bg', 3],
  ['primary', 'surface', 3],
];

describe('the shipped themes clear the bar design_lint enforces', () => {
  for (const [themeName, tokens] of Object.entries(THEMES)) {
    describe(themeName, () => {
      // The failure prints the received ratio, which is the number needed to
      // pick a replacement colour.
      it.each(PAIRS)('%s on %s is at least %s:1', (fg, bg, minimum) => {
        expect(contrastRatio(tokens[fg], tokens[bg])).toBeGreaterThanOrEqual(minimum);
      });
    });
  }

  it('the catalog advertises the same colours the checked tokens hold', () => {
    // getDesignCatalog exposes THEMES.dark as `tokens.color`; if that ever
    // stops being the same object the assertions above stop covering what an
    // agent is actually handed.
    expect(getDesignCatalog().tokens.color).toEqual(THEMES.dark);
  });
});

// The formula itself, against values published with WCAG 2.2, so a mistake in
// the maths cannot silently make the palette assertions pass.
describe('contrast maths', () => {
  it.each<[string, [number, number, number], [number, number, number], number]>([
    ['black on white', [0, 0, 0], [255, 255, 255], 21],
    ['white on white', [255, 255, 255], [255, 255, 255], 1],
    ['mid grey on white', [119, 119, 119], [255, 255, 255], 4.48],
  ])('%s is %s:1', (_label, a, b, expected) => {
    expect(contrastRatio(a, b)).toBeCloseTo(expected, 2);
  });

  it('is symmetric', () => {
    expect(contrastRatio([12, 34, 56], [210, 180, 140]))
      .toBeCloseTo(contrastRatio([210, 180, 140], [12, 34, 56]), 10);
  });

  // The two candidate breakpoints bracket no 8-bit channel — 0.03928 and
  // 0.04045 are 10.02/255 and 10.31/255 — so an 8-bit test cannot tell them
  // apart. Roblox Color3 channels are floats, which can land between them, so
  // the branch is checked directly.
  it('takes the linear branch at the WCAG 2.2 breakpoint and the power branch past it', () => {
    expect(srgbToLinear(SRGB_LINEAR_BREAKPOINT * 255)).toBeCloseTo(SRGB_LINEAR_BREAKPOINT / 12.92, 12);
    const justOver = SRGB_LINEAR_BREAKPOINT + 1e-9;
    expect(srgbToLinear(justOver * 255)).toBeCloseTo(((justOver + 0.055) / 1.055) ** 2.4, 12);
    // A value the old 0.03928 would have sent down the power branch.
    expect(srgbToLinear(0.04 * 255)).toBeCloseTo(0.04 / 12.92, 12);
  });

  it('ships the same breakpoint in the generated Luau', () => {
    const code = buildDesignLintLuau();
    expect(code).toContain('if c <= 0.04045 then return c / 12.92 end');
    expect(code).not.toContain('0.03928');
  });
});
