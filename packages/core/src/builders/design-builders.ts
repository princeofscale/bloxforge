// Track D — UI design quality. These builders emit Luau executed in the plugin
// edit context (no plugin rebuild). `design_lint` is a deterministic, reproducible
// UI-quality metric; `ui_component_catalog` and `apply_theme` give the agent a
// canon to build against instead of re-inventing spacing/typography each time.
//
// Edit-mode note: GuiObjects parented under StarterGui DO get AbsolutePosition/
// AbsoluteSize computed in edit, so geometric checks (overlap/offscreen) work
// without a playtest. Topbar/safe-area insets are 0 in edit and need a playtest.

import { luaString, PATH_RESOLVER_LUA, luaNumber } from './luau-emit.js';

function wrap(body: string): string {
  return `${PATH_RESOLVER_LUA}\n${body}`;
}

// ─── Design system: tokens + canonical components (the build canon) ──────────
// A small, opinionated system the agent composes from instead of re-inventing
// spacing/typography/color on every screen. Pure data — no Studio round-trip.

export interface ThemeTokens {
  bg: [number, number, number];
  surface: [number, number, number];
  primary: [number, number, number];
  onPrimary: [number, number, number];
  text: [number, number, number];
  muted: [number, number, number];
  stroke: [number, number, number];
  danger: [number, number, number];
}

// Every foreground/background pair an agent is told to use meets WCAG 2.2 AA,
// and `theme-contrast.test.ts` proves it on every run. It did not before: the
// catalog's own `button` recipe says "BackgroundColor3 = primary, TextColor3 =
// onPrimary", and white on indigo-6 is 4.32:1 — under the 4.5:1 minimum for
// normal text, in both themes, on the most-used pair in the system. Light
// `muted` was 3.15:1 and light `danger` 4.28:1. So `design_lint` would have
// flagged UI that BloxForge's own canon produced.
//
// The three corrections stay inside Open Color, so the palette keeps its
// character: primary indigo-6 -> indigo-7, light muted gray-6 -> #5C636A, light
// danger red-8 -> red-9.
export const THEMES: Record<string, ThemeTokens> = {
  dark: {
    bg: [26, 27, 30], surface: [37, 38, 43], primary: [66, 99, 235], onPrimary: [255, 255, 255],
    text: [233, 236, 239], muted: [144, 146, 150], stroke: [55, 58, 64], danger: [250, 82, 82],
  },
  light: {
    bg: [248, 249, 250], surface: [255, 255, 255], primary: [66, 99, 235], onPrimary: [255, 255, 255],
    text: [33, 37, 41], muted: [92, 99, 106], stroke: [222, 226, 230], danger: [201, 42, 42],
  },
};

export const UI_DESIGN_CATALOG = {
  themes: Object.keys(THEMES),
  tokens: {
    spacing: [4, 8, 12, 16, 24, 32, 48],
    radius: { sm: 6, md: 10, lg: 16 },
    typography: {
      display: { size: 32, font: 'GothamBold' },
      heading: { size: 22, font: 'GothamBold' },
      body: { size: 16, font: 'Gotham' },
      caption: { size: 13, font: 'Gotham' },
    },
    minTextSize: 14,
    color: THEMES.dark,
  },
  components: [
    { name: 'button', description: 'Primary action.', parts: ['TextButton', 'UICorner(md)', 'UIPadding(12,8)', 'optional UIStroke'], tips: ['BackgroundColor3 = primary, TextColor3 = onPrimary', 'AutomaticSize = X for label-fit', 'set Selectable + NextSelection* for gamepad'] },
    { name: 'card', description: 'Grouped content surface.', parts: ['Frame', 'UICorner(md)', 'UIPadding(16)', 'UIListLayout(Vertical, 12)'], tips: ['BackgroundColor3 = surface', 'AutomaticSize = Y to fit children'] },
    { name: 'modal', description: 'Centered overlay dialog.', parts: ['Frame dimmer (bg, 0.5 transp)', 'Frame panel (surface, UICorner(lg), UIPadding(24))'], tips: ['AnchorPoint 0.5,0.5 + Position 0.5,0.5', 'UIAspectRatioConstraint to stay readable'] },
    { name: 'hud_meter', description: 'Health/resource bar.', parts: ['Frame track (surface)', 'Frame fill (primary, Size scale-X)', 'UICorner(sm)'], tips: ['drive fill via Size = UDim2.fromScale(pct,1)', 'use Scale not Offset so it scales'] },
    { name: 'list_row', description: 'Repeating list item.', parts: ['Frame/TextButton', 'UIListLayout on parent', 'UIPadding(12,8)'], tips: ['let the parent UIListLayout position rows; never hand-place'] },
    { name: 'nav_rail', description: 'Side navigation.', parts: ['Frame (surface)', 'UIListLayout(Vertical, 8)', 'icon TextButtons'], tips: ['Size with Scale on Y, Offset on X', 'highlight selected with primary'] },
  ],
  guidance: [
    'Use UIListLayout/UIGridLayout for any repeating or stacked content — never hand-position 4+ siblings.',
    'Prefer Scale (or UIScale/UIAspectRatioConstraint) over pure Offset so UI scales across devices.',
    'Keep text >= 14px; for dynamic/localized text use AutomaticSize + UITextSizeConstraint (MinTextSize >= 9).',
    'Use 9-slice (ScaleType.Slice + SliceCenter) for stretched decorative images so borders do not distort.',
    'Account for the topbar/safe-area inset (GuiService:GetGuiInset / IgnoreGuiInset) on full-screen UIs.',
    'Make interactive elements Selectable and wire NextSelection* for gamepad navigation.',
  ],
};

export function getDesignCatalog() {
  return UI_DESIGN_CATALOG;
}

// ─── apply_theme: standardize an existing GUI onto a theme ───────────────────

export interface ApplyThemeOptions {
  rootPath: string;
  /** Theme name (default "dark"). */
  theme?: string;
  /** Raise any text below this size (default 14). */
  minTextSize?: number;
  /** Add a UICorner where missing (default true). */
  roundCorners?: boolean;
}

function color3(rgb: [number, number, number]): string {
  return `Color3.fromRGB(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}

export function buildApplyThemeLuau(options: ApplyThemeOptions): string {
  const themeName = options.theme && THEMES[options.theme] ? options.theme : 'dark';
  const t = THEMES[themeName];
  const minTextSize = options.minTextSize ?? 14;
  const radiusMd = UI_DESIGN_CATALOG.tokens.radius.md;
  const roundCorners = options.roundCorners !== false;

  const body = `local root = resolvePath(${luaString(options.rootPath)})
if root == nil then error("Root not found: " .. ${luaString(options.rootPath)}) end
local SURFACE = ${color3(t.surface)}
local PRIMARY = ${color3(t.primary)}
local ON_PRIMARY = ${color3(t.onPrimary)}
local TEXT = ${color3(t.text)}
local MIN_TEXT = ${luaNumber(Number(minTextSize))}
local ROUND = ${roundCorners ? 'true' : 'false'}
local styled = 0
local function ensureCorner(o)
\tif not ROUND then return end
\tif o:FindFirstChildWhichIsA("UICorner") == nil then
\t\tlocal c = Instance.new("UICorner")
\t\tc.CornerRadius = UDim.new(0, ${luaNumber(Number(radiusMd))})
\t\tc.Parent = o
\tend
end
for _, o in ipairs(root:GetDescendants()) do
\tif _G.__mcp and _G.__mcp.checkCancelled and _G.__mcp.checkCancelled() then return { cancelled = true } end
\tif o:IsA("GuiButton") then
\t\to.BackgroundColor3 = PRIMARY
\t\to.BorderSizePixel = 0
\t\tif o:IsA("TextButton") then
\t\t\to.TextColor3 = ON_PRIMARY
\t\t\tif not o.TextScaled and o.TextSize < MIN_TEXT then o.TextSize = MIN_TEXT end
\t\tend
\t\tensureCorner(o)
\t\tstyled = styled + 1
\telseif o:IsA("Frame") or o:IsA("ScrollingFrame") then
\t\to.BackgroundColor3 = SURFACE
\t\to.BorderSizePixel = 0
\t\tensureCorner(o)
\t\tstyled = styled + 1
\telseif o:IsA("TextLabel") or o:IsA("TextBox") then
\t\to.TextColor3 = TEXT
\t\tif not o.TextScaled and o.TextSize < MIN_TEXT then o.TextSize = MIN_TEXT end
\t\tstyled = styled + 1
\tend
end
return { success = true, theme = ${luaString(themeName)}, styledCount = styled, rootPath = root:GetFullName() }`;
  return wrap(body);
}

// ─── design_review capture helpers ──────────────────────────────────────────
// A ScreenGui under StarterGui does not render to the editor viewport, so to
// screenshot it we temporarily reparent it to CoreGui (which renders over the
// editor), capture, then restore. Verified live: reparenting + cross-call state
// persist in the edit DM.

export function buildReviewReparentLuau(rootPath: string): string {
  const body = `local target = resolvePath(${luaString(rootPath)})
if target == nil then error("Root not found: " .. ${luaString(rootPath)}) end
if not target:IsA("LayerCollector") then error("design_review needs a ScreenGui (LayerCollector); got a " .. target.ClassName .. ". Pass the ScreenGui path.") end
local CoreGui = game:GetService("CoreGui")
local origParent = target.Parent
target:SetAttribute("__dr_origParent", origParent and origParent:GetFullName() or "StarterGui")
target.Enabled = true
target.Parent = CoreGui
task.wait()
return { newPath = target:GetFullName(), origParentPath = origParent and origParent:GetFullName() or "StarterGui", name = target.Name }`;
  return wrap(body);
}

export function buildReviewRestoreLuau(newPath: string, origParentPath: string): string {
  const body = `local target = resolvePath(${luaString(newPath)})
if target == nil then return { restored = false } end
target:SetAttribute("__dr_origParent", nil)
local origParent = resolvePath(${luaString(origParentPath)})
if origParent ~= nil then target.Parent = origParent end
return { restored = target.Parent ~= nil and target.Parent.Name == ${luaString(origParentPath.split('.').pop() ?? 'StarterGui')} }`;
  return wrap(body);
}

/** The fixed reviewer rubric. The agent's extra instruction (if any) is appended. */
export function designReviewPrompt(instruction?: string): string {
  return [
    'You are a senior Roblox UI/UX designer reviewing a screenshot of in-game UI.',
    instruction ? `Reviewer focus: ${instruction}` : '',
    'Rate the UI 1-10 on each of: visual hierarchy, spacing & density, color & contrast, alignment & consistency, and "AI slop" risk (generic/unrefined look).',
    'Then give 3-5 SPECIFIC, actionable fixes phrased in Roblox terms (UIListLayout/UIPadding, Scale vs Offset, TextSize, color tokens, 9-slice, AutomaticSize).',
    'Be concise. Format as: one line "Scores: hierarchy=x spacing=x color=x alignment=x slop=x", then a short "Fixes:" bullet list, then a one-line "Verdict:".',
  ].filter(Boolean).join(' ');
}

export interface DesignLintOptions {
  /** A specific ScreenGui/GuiObject path. Omit to scan every ScreenGui in StarterGui. */
  rootPath?: string;
  /** Minimum readable text size (default 9). */
  minTextSize?: number;
}

// WCAG 2.2 contrast, computed honestly or not at all.
//
// The maths is exact for opaque, solid colours after sRGB linearization. It is
// not exact for anything else, and the difference matters: a gradient backdrop
// has a *range* of contrast, an image backdrop has no static answer, and text
// over nothing opaque sits on the 3D viewport. Those come back as
// `contrast_unknown` with the reason, never as an optimistic number — a
// confident wrong ratio is worse than an admitted gap, because it gets fixed
// once and trusted forever.
//
// Two Roblox specifics the formula has to respect:
//   * `TextSize` is the *line height*, not the font's em size, so it cannot be
//     substituted into WCAG's large-text thresholds (24px / 18.66px bold),
//     which are font sizes. Using it directly would classify text as "large"
//     that is not, and hand it the weaker 3:1 bar. So the 4.5:1 minimum always
//     decides severity, and the large-text exemption is only ever reported as
//     "a human may apply this" — never applied here.
//   * `TextStrokeTransparency` is documented as "multiple renderings ...
//     essentially multiplicative on itself four times over". WCAG has no model
//     for an outline, and an outline usually helps legibility, so a stroked
//     label reports its ratio at `info` rather than `warn`, saying why.
//
// `UIGradient` blends with the rendering of its *parent* only and never
// descendants (verified: create.roblox.com UIGradient), so finding one on an
// ancestor is enough to give up on a single number for that layer.
const CONTRAST_LUA = `local function srgbToLinear(c)
\tif c <= 0.03928 then return c / 12.92 end
\treturn ((c + 0.055) / 1.055) ^ 2.4
end

local function luminance(color)
\treturn 0.2126 * srgbToLinear(color.R) + 0.7152 * srgbToLinear(color.G) + 0.0722 * srgbToLinear(color.B)
end

local function contrastRatio(a, b)
\tlocal la, lb = luminance(a), luminance(b)
\tif la < lb then la, lb = lb, la end
\treturn (la + 0.05) / (lb + 0.05)
end

local function hex(color)
\treturn string.format("#%02X%02X%02X",
\t\tmath.floor(color.R * 255 + 0.5), math.floor(color.G * 255 + 0.5), math.floor(color.B * 255 + 0.5))
end

local function blend(over, overAlpha, under)
\treturn Color3.new(
\t\tover.R * overAlpha + under.R * (1 - overAlpha),
\t\tover.G * overAlpha + under.G * (1 - overAlpha),
\t\tover.B * overAlpha + under.B * (1 - overAlpha))
end

-- Front-to-back "over" compositing, starting at the text element itself and
-- walking outward. Returns the resolved Color3, or nil plus the reason no
-- single colour exists.
local function effectiveBackground(textObject)
\tlocal accR, accG, accB, accA = 0, 0, 0, 0
\tlocal node = textObject
\twhile node do
\t\tif node:IsA("GuiObject") then
\t\t\tif node:FindFirstChildWhichIsA("UIGradient") then
\t\t\t\treturn nil, string.format("a UIGradient on %s makes the backdrop a range, not a colour", node.Name)
\t\t\tend
\t\t\tif (node:IsA("ImageLabel") or node:IsA("ImageButton")) and node.Image ~= "" and node.ImageTransparency < 1 then
\t\t\t\treturn nil, string.format("an image backdrop on %s; no static answer, sample it in a screenshot", node.Name)
\t\t\tend
\t\t\tlocal alpha = 1 - node.BackgroundTransparency
\t\t\tif alpha > 0 then
\t\t\t\tlocal c = node.BackgroundColor3
\t\t\t\tlocal w = (1 - accA) * alpha
\t\t\t\taccR, accG, accB = accR + w * c.R, accG + w * c.G, accB + w * c.B
\t\t\t\taccA += w
\t\t\t\tif accA >= 0.999 then return Color3.new(accR, accG, accB), nil end
\t\t\tend
\t\telseif node:IsA("LayerCollector") then
\t\t\tbreak
\t\tend
\t\tnode = node.Parent
\tend
\treturn nil, "nothing opaque behind the text; it sits on the 3D viewport or another ScreenGui"
end

-- WCAG large text is 24px, or 18.66px bold, as FONT sizes. TextSize is a line
-- height, so this only ever reports that the exemption may apply.
-- The whole lookup sits inside the pcall, Enum comparison included: a host that
-- has no FontFace property probably has no Enum.FontWeight either, and an error
-- escaping here would take down the entire lint over a severity nicety.
local function isBold(o)
\tlocal ok, bold = pcall(function()
\t\treturn o.FontFace.Weight.Value >= Enum.FontWeight.Bold.Value
\tend)
\treturn ok and bold or false
end`;

export function buildDesignLintLuau(options: DesignLintOptions = {}): string {
  const minTextSize = options.minTextSize ?? 9;
  const rootResolution = options.rootPath
    ? `local r = resolvePath(${luaString(options.rootPath)})
if r == nil then error("Root not found: " .. ${luaString(options.rootPath)}) end
table.insert(roots, r)`
    : `for _, sg in ipairs(StarterGui:GetChildren()) do
\tif sg:IsA("LayerCollector") or sg:IsA("GuiObject") then table.insert(roots, sg) end
end`;

  const body = `local StarterGui = game:GetService("StarterGui")
local Workspace = game:GetService("Workspace")
local camera = Workspace.CurrentCamera
local viewport = (camera and camera.ViewportSize) or Vector2.new(1280, 720)
local MIN_TEXT_SIZE = ${luaNumber(Number(minTextSize))}
local MIN_CONTRAST = 4.5
local LARGE_TEXT_CONTRAST = 3.0

${CONTRAST_LUA}

local findings = {}
local function add(rule, severity, inst, detail, extra)
\tlocal f = { rule = rule, severity = severity, path = inst:GetFullName(), className = inst.ClassName, detail = detail }
\tif extra then for k, v in pairs(extra) do f[k] = v end end
\ttable.insert(findings, f)
end

local function checkContrast(o)
\tif not o.Visible or o.Text == "" or o.TextTransparency >= 1 then return end
\tif o:FindFirstChildWhichIsA("UIGradient") then
\t\tadd("contrast_unknown", "info", o, "a UIGradient on the text element makes the foreground a range, not a colour")
\t\treturn
\tend
\tlocal bg, why = effectiveBackground(o)
\tif bg == nil then
\t\tadd("contrast_unknown", "info", o, why)
\t\treturn
\tend
\t-- Partly transparent text composites over what is behind it before it is read.
\tlocal fg = blend(o.TextColor3, 1 - o.TextTransparency, bg)
\tlocal ratio = contrastRatio(fg, bg)
\tif ratio >= MIN_CONTRAST then return end

\tlocal stroked = o.TextStrokeTransparency < 1
\tlocal maybeLarge = o.TextSize >= 24 or (o.TextSize >= 19 and isBold(o))
\tlocal extra = {
\t\tratio = math.floor(ratio * 100 + 0.5) / 100,
\t\trequired = MIN_CONTRAST,
\t\tforeground = hex(fg),
\t\tbackground = hex(bg),
\t\ttextSize = o.TextSize,
\t}
\tif stroked then
\t\tadd("contrast_unknown", "info", o, string.format(
\t\t\t"%s on %s is %.2f:1, under %.1f:1 — but this text has a stroke, and WCAG does not model an outline. Judge it in a screenshot.",
\t\t\textra.foreground, extra.background, ratio, MIN_CONTRAST), extra)
\telseif maybeLarge and ratio >= LARGE_TEXT_CONTRAST then
\t\tadd("low_contrast", "info", o, string.format(
\t\t\t"%s on %s is %.2f:1, under the %.1f:1 needed for normal text. TextSize %d may qualify for WCAG's %.1f:1 large-text exemption, but TextSize is a line height and the exemption is stated in font sizes, so that cannot be decided here.",
\t\t\textra.foreground, extra.background, ratio, MIN_CONTRAST, o.TextSize, LARGE_TEXT_CONTRAST), extra)
\telse
\t\tadd("low_contrast", "warn", o, string.format(
\t\t\t"%s on %s is %.2f:1, under WCAG 2.2 AA's %.1f:1 for normal text — darken the background or lighten the text",
\t\t\textra.foreground, extra.background, ratio, MIN_CONTRAST), extra)
\tend
end

local function rectsOverlap(aPos, aSize, bPos, bSize)
\treturn aPos.X < bPos.X + bSize.X and aPos.X + aSize.X > bPos.X
\t\tand aPos.Y < bPos.Y + bSize.Y and aPos.Y + aSize.Y > bPos.Y
end

local function lintRoot(root)
\tlocal interactives = {}
\tfor _, o in ipairs(root:GetDescendants()) do
\t\tif _G.__mcp and _G.__mcp.checkCancelled and _G.__mcp.checkCancelled() then return { cancelled = true } end
\t\tif o:IsA("GuiObject") then
\t\t\tif o:IsA("TextLabel") or o:IsA("TextButton") or o:IsA("TextBox") then
\t\t\t\tif not o.TextScaled and o.TextSize < MIN_TEXT_SIZE then
\t\t\t\t\tadd("tiny_text", "warn", o, string.format("TextSize %d < %d; hard to read — raise it or use TextScaled + UITextSizeConstraint", o.TextSize, MIN_TEXT_SIZE))
\t\t\t\tend
\t\t\t\tcheckContrast(o)
\t\t\tend
\t\t\tif o.Visible and o.AbsoluteSize.X > 0 and o.AbsoluteSize.Y > 0 then
\t\t\t\tlocal p, s = o.AbsolutePosition, o.AbsoluteSize
\t\t\t\tif p.X < -1 or p.Y < -1 or p.X + s.X > viewport.X + 1 or p.Y + s.Y > viewport.Y + 1 then
\t\t\t\t\tadd("offscreen", "warn", o, string.format("extends beyond the %dx%d viewport", math.floor(viewport.X), math.floor(viewport.Y)))
\t\t\t\tend
\t\t\t\tif o.Size.X.Scale == 0 and o.Size.Y.Scale == 0 and (s.X > viewport.X * 0.5 or s.Y > viewport.Y * 0.5) then
\t\t\t\t\tadd("non_responsive_size", "info", o, "large element sized in pure offset; it won't scale across devices — add Scale or a UIScale/UIAspectRatioConstraint")
\t\t\t\tend
\t\t\t\tif (o:IsA("ImageLabel") or o:IsA("ImageButton")) and o.Image ~= "" and o.ScaleType == Enum.ScaleType.Stretch and s.X > 64 and s.Y > 64 then
\t\t\t\t\tadd("stretched_image_no_slice", "info", o, "stretched image >64px without 9-slice; set ScaleType=Slice + SliceCenter so borders don't distort")
\t\t\t\tend
\t\t\t\tif o:IsA("GuiButton") then table.insert(interactives, o) end
\t\t\tend
\t\t\tlocal guiKids = 0
\t\t\tfor _, c in ipairs(o:GetChildren()) do if c:IsA("GuiObject") then guiKids += 1 end end
\t\t\tif guiKids >= 4 then
\t\t\t\tlocal hasLayout = o:FindFirstChildWhichIsA("UIListLayout") or o:FindFirstChildWhichIsA("UIGridLayout") or o:FindFirstChildWhichIsA("UITableLayout")
\t\t\t\tif not hasLayout then
\t\t\t\t\tadd("no_layout_container", "info", o, string.format("%d GUI children with no UIListLayout/UIGridLayout; manual positioning is brittle under localization/scaling", guiKids))
\t\t\t\tend
\t\t\tend
\t\tend
\tend
\tfor i = 1, #interactives do
\t\tfor j = i + 1, #interactives do
\t\t\tlocal a, b = interactives[i], interactives[j]
\t\t\tif not a:IsDescendantOf(b) and not b:IsDescendantOf(a) then
\t\t\t\tif rectsOverlap(a.AbsolutePosition, a.AbsoluteSize, b.AbsolutePosition, b.AbsoluteSize) then
\t\t\t\t\tadd("overlap_interactive", "warn", a, "overlaps another interactive element: " .. b:GetFullName())
\t\t\t\tend
\t\t\tend
\t\tend
\tend
end

local roots = {}
${rootResolution}

for _, r in ipairs(roots) do lintRoot(r) end

local score = 100
for _, f in ipairs(findings) do
\tscore = score - (f.severity == "warn" and 8 or 3)
end
if score < 0 then score = 0 end

return {
\tsuccess = true,
\tscore = score,
\tfindingCount = #findings,
\tscannedRoots = #roots,
\tviewport = { x = math.floor(viewport.X), y = math.floor(viewport.Y) },
\tfindings = findings,
\tnote = "Geometric checks use edit-mode layout; topbar/safe-area insets read 0 in edit and need a playtest to verify. Contrast is exact only for opaque solid colours; a gradient, image or see-through backdrop returns contrast_unknown with the reason rather than a guess.",
}`;
  return wrap(body);
}
