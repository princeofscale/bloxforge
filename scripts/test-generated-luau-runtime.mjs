#!/usr/bin/env node
// Runs the Luau this server generates under Lune, against a real DataModel.
//
// Generated Luau is where the read tools actually compute their answers, and
// none of it is reachable from Jest. Calling the builders here and running
// their output keeps the test and the thing under test the same artefact: it
// cannot drift from the builder by copying it.
//
// Only builders whose Luau Lune can execute are listed. Lune reads properties
// from rbx-dom, which has no value for a property that was never assigned and
// has no default, so `game.PlaceId` (world snapshot) and `Script.Enabled`
// (sanitize scan) cannot run here. That is a limitation of the host, not a
// defect in those builders.

import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const builders = path.join(repoRoot, 'packages/core/dist/builders');
const dist = path.join(repoRoot, 'packages/core/dist');

const load = async (file) => {
  try {
    return await import(path.join(builders, file));
  } catch {
    console.error(`${file} not built. Run \`npm run build -w packages/core\` first.`);
    process.exit(1);
  }
};

const { buildSpatialLayoutLuau } = await load('scene-layout.js');
const { buildNodeBatchLuau } = await load('world-model.js');
const { buildSceneSearchLuau } = await load('scene-search.js');
const { buildSceneSummaryLuau } = await load('scene-summary.js');
const { buildWorldFingerprintLuau } = await load('world-fingerprint.js');
const { buildFitScanLuau } = await load('asset-fit.js');
const { buildDesignLintLuau } = await load('design-builders.js');
const { buildMutationPlanLuau } = await load('mutation-plan.js');
const { buildSanitizeApplyLuau } = await load('asset-sanitize.js');
const { buildScreenGuiLuau, buildGuiObjectLuau, buildApplyLayoutLuau, buildMobileFriendlyLuau } = await load('ui-builders.js');

// The network and UI generators emit Luau for the *user's* game rather than for
// BloxForge to run, so nothing else here would ever parse them. A generator
// that emits unparseable Luau is the failure that would otherwise reach a
// player, and it is invisible to every string assertion in Jest.
//
// ponytail: these three are compiled, not executed. Ceiling: compiling catches
// a syntax error and nothing else — a guard that is present but wrong still
// compiles. Accepted because the server module needs ReplicatedStorage and a
// Players service, and the Fusion module needs Fusion itself, neither of which
// the host has. Upgrade path: stub those services and require a vendored
// Fusion, then run them. The token bucket below is the part where being wrong
// matters most, and it is executed rather than compiled for exactly that
// reason.
const loadDist = async (file) => {
  try {
    return await import(path.join(dist, file));
  } catch {
    console.error(`${file} not built. Run \`npm run build -w packages/core\` first.`);
    process.exit(1);
  }
};
const { generateNative } = await loadDist('network/ir.js');
const { exportFusion } = await loadDist('ui/fusion.js');

const network = generateNative({
  folder: 'Net',
  messages: [
    {
      id: 'BuyItem', direction: 'client-to-server', kind: 'event', reliable: true,
      args: [
        { name: 'itemId', type: 'string', maxLength: 64 },
        { name: 'count', type: 'integer', range: { min: 1, max: 99 }, optional: true },
      ],
      rateLimit: { perSecond: 4, burst: 8 },
      permission: { policy: 'named-roles', roles: ['member'] },
    },
    { id: 'ScoreChanged', direction: 'server-to-client', kind: 'event', reliable: true, args: [{ name: 'score', type: 'integer' }] },
    {
      id: 'GetBalance', direction: 'client-to-server', kind: 'request', reliable: true, args: [],
      returns: [{ name: 'balance', type: 'integer' }],
      rateLimit: { perSecond: 1 }, permission: { policy: 'anyone', rationale: 'read only' },
    },
    {
      id: 'FastPing', direction: 'client-to-server', kind: 'event', reliable: false,
      args: [{ name: 'ms', type: 'number' }],
      rateLimit: { perSecond: 30 }, permission: { policy: 'anyone', rationale: 'telemetry' },
    },
  ],
});

const fusion = exportFusion({
  id: 'menu', name: 'Main menu',
  tokens: {
    color: { surface: '#101014', accent: '#2563eb', accentHover: '#3b82f6', onAccent: '#ffffff' },
    space: { sm: 4, md: 8, radius: 6 },
    text: { body: 14 },
  },
  breakpoints: { wide: 900 },
  root: {
    id: 'root', kind: 'frame', layout: { direction: 'column' },
    style: { background: 'color.surface', padding: 'space.md', gap: 'space.sm', radius: 'space.radius' },
    children: [
      { id: 'title', kind: 'text', content: 'BloxForge', style: { foreground: 'color.onAccent', fontSize: 'text.body' } },
      {
        id: 'play', kind: 'button', content: 'Play',
        style: { background: 'color.accent', foreground: 'color.onAccent', radius: 'space.radius' },
        states: { hover: { background: 'color.accentHover' }, pressed: { background: 'color.surface' } },
        accessibility: { label: 'Play', focusOrder: 1 },
      },
      { id: 'coins', kind: 'text', binding: { source: 'player.Coins', property: 'content' } },
    ],
  },
});

// Names are what the Luau side asserts on; keep them in step.
const MUT = 'game.Workspace.MutTarget';
const generated = {
  'spatial-layout': buildSpatialLayoutLuau('game.Workspace', 16, 10),
  'node-batch': buildNodeBatchLuau(
    ['game.Workspace.Ground', 'game.Workspace.Nope'],
    ['Anchored'],
    true,
  ),
  // The value serializer's own branches, against real Roblox values. Every one
  // of these types is on the capability registry's lossy list, which is only a
  // guard if the serializer actually structures them.
  'node-batch-values': buildNodeBatchLuau(
    ['game.Workspace.Ground'],
    ['Size', 'CFrame', 'Color', 'BrickColor', 'Material', 'CustomPhysicalProperties'],
    false,
  ),
  // A place with more spawns than the reported list holds. The cap used to stop
  // the *collection*, so whether the floor was confirmed depended on which
  // twelve the traversal reached first.
  'spatial-layout-spawns': buildSpatialLayoutLuau('game.Workspace.SpawnField', 8, 6),
  'scene-search': buildSceneSearchLuau('ground', 'game.Workspace', 10),
  'scene-summary': buildSceneSummaryLuau('game.Workspace', 20),
  'world-fingerprint': buildWorldFingerprintLuau('game.Workspace'),
  'fit-scan': buildFitScanLuau('game.Workspace.Nope'),
  // design_lint's contrast rule is arithmetic over composited colours, which is
  // exactly the kind of thing that looks right in a diff and is wrong on a
  // screen. Jest can only assert the emitted text contains a rule name.
  'design-lint': buildDesignLintLuau({ rootPath: 'StarterGui.Menu' }),
  // Compiled, not executed: these need ReplicatedStorage and Fusion, which the
  // host does not have. Compiling is still the check that matters — the
  // generator either emits Luau or it does not.
  'network-server': network.serverLuau,
  'network-client': network.clientLuau,
  'ui-fusion': fusion.luau,
  // apply_mutation_plan is the only generated Luau here that writes, so its
  // preconditions and its rollback are the two places being wrong costs the
  // user their scene. Both were only ever asserted as strings.
  'mutation-dry-run': buildMutationPlanLuau(
    [{ op: 'set_property', target: MUT, property: 'Anchored', value: false }], true),
  // `expected: null` is the guard against creating something that already
  // exists. JSON null decodes to nil, and a nil `expected` used to read as no
  // precondition at all — so the guard silently did not run.
  'mutation-expect-unset-taken': buildMutationPlanLuau(
    [{ op: 'set_attribute', target: MUT, name: 'Owner', value: 'plan', expected: null }], false),
  'mutation-expect-unset-free': buildMutationPlanLuau(
    [{ op: 'set_attribute', target: MUT, name: 'Fresh', value: 'plan', expected: null }], false),
  'mutation-expect-untagged': buildMutationPlanLuau(
    [{ op: 'add_tag', target: MUT, tag: 'Existing', expected: null }], false),
  // A precondition naming a property that does not exist: the read throws, and
  // unguarded it took the whole plan down with a raw Luau error.
  'mutation-unreadable': buildMutationPlanLuau(
    [{ op: 'set_property', target: MUT, property: 'Anchoredd', value: true, expected: true }], false),
  // Atomic rollback: a tag and a property applied, then a type error, then the
  // reverse plan run backwards.
  'mutation-rollback': buildMutationPlanLuau([
    { op: 'add_tag', target: MUT, tag: 'Rolled' },
    { op: 'set_property', target: MUT, property: 'Anchored', value: false },
    { op: 'set_property', target: MUT, property: 'Anchored', value: 'not a boolean' },
  ], false, true),
  // asset_sanitize_apply neutralises scripts in a model the user did not write,
  // and its target list comes back from the scan as paths. Two children may
  // share a name — in a foreign model that usually means two `Script`s called
  // "Script" — so the plan legitimately names the same path twice.
  'sanitize-disable': buildSanitizeApplyLuau(
    'game.Workspace.Foreign',
    [
      'game.Workspace.Foreign.Script',
      'game.Workspace.Foreign.Script',
      'game.Workspace.Foreign.Mod',
    ],
    'disable',
  ),
  'sanitize-remove': buildSanitizeApplyLuau(
    'game.Workspace.Foreign2',
    ['game.Workspace.Foreign2.Script', 'game.Workspace.Foreign2.Script'],
    'remove',
  ),
  // A dot in a name makes GetFullName() ambiguous: a Script called "A.B" and a
  // Script "B" inside a Folder "A" have the same full name. Roblox writes both
  // that way, so the scan reports both, and resolving the path found the folder
  // one twice.
  'sanitize-remove-dotted': buildSanitizeApplyLuau(
    'game.Workspace.Foreign3',
    ['game.Workspace.Foreign3.A.B', 'game.Workspace.Foreign3.A.B'],
    'remove',
  ),
  // The ui_create_* family writes real instances into StarterGui from typed
  // options. Every property here is a typed Roblox value assembled by string
  // concatenation, and a UDim2 with the arguments in the wrong order looks
  // exactly like a correct one in a diff.
  'ui-screen-gui': buildScreenGuiLuau({
    name: 'Generated', parentPath: 'StarterGui', ignoreGuiInset: true, displayOrder: 5,
  }),
  'ui-text-button': buildGuiObjectLuau('TextButton', {
    parentPath: 'StarterGui.Generated', name: 'Play',
    size: [0, 200, 0, 50], position: [0.5, 0, 0.5, 0], anchorPoint: [0.5, 0.5],
    backgroundColor: [37, 99, 235], text: 'Play', font: 'GothamBold',
    textColor: [255, 255, 255], textSize: 18, zIndex: 3,
  }),
  'ui-layout': buildApplyLayoutLuau('StarterGui.Generated', {
    layout: 'list', fillDirection: 'Vertical', padding: 8,
    horizontalAlignment: 'Center', sortOrder: 'LayoutOrder',
  }),
  'ui-mobile': buildMobileFriendlyLuau('StarterGui.Generated'),
  // atomic = false is a different promise: the operations that worked stay.
  // A receipt that calls that state clean is the same mistake as a rollback
  // that never checked.
  'mutation-non-atomic': buildMutationPlanLuau([
    { op: 'set_attribute', target: MUT, name: 'Kept', value: 'yes' },
    { op: 'set_property', target: MUT, property: 'Anchored', value: 'not a boolean' },
  ], false, false),
  // Executed. The bucket is the security path in everything the network
  // generator emits, and a limiter that refills wrong is a limiter that is not
  // there. The server module embeds this verbatim.
  'network-rate-limiter': network.rateLimiterLuau,
};

const dir = await mkdtemp(path.join(tmpdir(), 'bloxforge-luau-'));
try {
  for (const [name, code] of Object.entries(generated)) {
    await writeFile(path.join(dir, `${name}.luau`), code, 'utf8');
  }
  const result = spawnSync(
    process.execPath,
    [
      path.join(repoRoot, 'scripts/run-lune.mjs'),
      'run',
      path.join(repoRoot, 'tests/generated-luau-runtime.luau'),
      dir,
    ],
    { stdio: 'inherit', cwd: repoRoot },
  );
  process.exit(result.status ?? 1);
} finally {
  await rm(dir, { recursive: true, force: true });
}
