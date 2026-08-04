import { PLACE_SCOPE_LUA } from '../builders/luau-emit.js';
import { buildWorldSnapshotLuau } from '../builders/world-model.js';
import { buildSceneSearchLuau } from '../builders/scene-search.js';
import { buildSceneSummaryLuau } from '../builders/scene-summary.js';
import { buildWorldFingerprintLuau } from '../builders/world-fingerprint.js';

// Studio parents its own plumbing into the DataModel next to the developer's
// content, and it dominates: on an empty baseplate 1676 of 1714 descendants were
// Stats / StylingService / MemStorageService / PluginGuiService / CoreGui.
// Measured consequences before this scoping existed:
//   scene_search("button")  -> 29 hits, every one of them Studio's own UI
//   scene_search("frame")   -> 47 hits, every one of them Studio's own UI
//   world fingerprint       -> 202KB of noise carrying 3KB of real content
// get_world_snapshot was fixed first; these are its sibling callers.
const SCOPED_GENERATORS: [string, () => string][] = [
  ['get_world_snapshot', () => buildWorldSnapshotLuau()],
  ['scene_search', () => buildSceneSearchLuau('button')],
  ['get_scene_summary', () => buildSceneSummaryLuau('game')],
  ['get_changes_since', () => buildWorldFingerprintLuau()],
];

describe('place scoping', () => {
  it.each(SCOPED_GENERATORS)('%s walks the place, not the DataModel', (_name, build) => {
    const code = build();
    expect(code).toContain('local DEVELOPER_SERVICES');
    expect(code).toContain('scopedDescendants(root)');
    // Never silently return different numbers than the DataModel holds.
    expect(code).toContain('scopeLabel(root)');
  });

  it.each(SCOPED_GENERATORS)('%s emits the prelude exactly once', (_name, build) => {
    const code = build();
    expect(code.split('local DEVELOPER_SERVICES').length - 1).toBe(1);
  });

  it('leaves an explicit subtree unfiltered', () => {
    // The escape hatch: CoreGui and Stats stay reachable when asked for by path.
    expect(PLACE_SCOPE_LUA).toContain('if root ~= game then return root:GetDescendants() end');
    expect(PLACE_SCOPE_LUA).toContain('return root ~= game or DEVELOPER_SERVICES[child.Name] == true');
    expect(PLACE_SCOPE_LUA).toContain('return "exact subtree"');
  });

  it('covers the services a place actually stores', () => {
    for (const service of [
      'Workspace', 'Players', 'Lighting', 'ReplicatedStorage', 'ServerScriptService',
      'ServerStorage', 'StarterGui', 'StarterPack', 'StarterPlayer', 'SoundService',
      'TextChatService', 'Teams', 'MaterialService', 'ReplicatedFirst',
    ]) {
      expect(PLACE_SCOPE_LUA).toContain(`${service} = true`);
    }
    // ...and none of Studio's own. (Match the table entry, not the bare name —
    // scopeLabel's prose names CoreGui and Stats to explain what it excluded.)
    for (const internal of ['CoreGui', 'Stats', 'StylingService', 'MemStorageService', 'PluginGuiService']) {
      expect(PLACE_SCOPE_LUA).not.toContain(`${internal} = true`);
    }
  });
});
