import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  ASSET_MANIFEST_FILE,
  assetManifestPlan,
  assetManifestScan,
  assetManifestStatus,
  loadAssetManifest,
  parseAssetManifest,
  pngDimensions,
} from '../asset-manifest.js';

let root: string;
let previousProjectRoot: string | undefined;

// A 1x1 PNG is enough to exercise the IHDR reader; `size` builds a header that
// claims larger dimensions so the texture budget can be tested without shipping
// a multi-megabyte fixture.
function writePng(file: string, width: number, height: number) {
  const png = Buffer.alloc(24);
  png.writeUInt32BE(0x89504e47, 0);
  png.writeUInt32BE(0x0d0a1a0a, 4);
  png.writeUInt32BE(13, 8);
  png.write('IHDR', 12, 'ascii');
  png.writeUInt32BE(width, 16);
  png.writeUInt32BE(height, 20);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, png);
}

function writeManifest(manifest: unknown) {
  fs.writeFileSync(path.join(root, ASSET_MANIFEST_FILE), JSON.stringify(manifest, null, 2));
}

function entry(overrides: Record<string, unknown> = {}) {
  return {
    assetKey: 'environment/tree/pine_a',
    source: { path: 'art/pine_a.glb' },
    import: { preset: 'environment-static', pivotPolicy: 'base-center', collision: 'hull' },
    ...overrides,
  };
}

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bloxforge-assets-')));
  previousProjectRoot = process.env.BLOXFORGE_PROJECT_ROOT;
  process.env.BLOXFORGE_PROJECT_ROOT = root;
  fs.mkdirSync(path.join(root, 'art'), { recursive: true });
  fs.writeFileSync(path.join(root, 'art/pine_a.glb'), 'glb-bytes');
});

afterEach(() => {
  if (previousProjectRoot === undefined) delete process.env.BLOXFORGE_PROJECT_ROOT;
  else process.env.BLOXFORGE_PROJECT_ROOT = previousProjectRoot;
  fs.rmSync(root, { recursive: true, force: true });
});

describe('manifest validation', () => {
  it('rejects an unknown key instead of ignoring it', () => {
    // The failure this guards: `pivotPolicty` silently ignored means the asset
    // imports with the wrong pivot and the manifest still reads as correct.
    expect(() => parseAssetManifest({
      version: 1,
      assets: [{ assetKey: 'a', source: { path: 'art/a.glb' }, import: { pivotPolicty: 'center' } }],
    })).toThrow(/unknown key\(s\) "pivotPolicty"/);
  });

  it('rejects a duplicate assetKey', () => {
    expect(() => parseAssetManifest({
      version: 1,
      assets: [entry(), entry()],
    })).toThrow(/duplicates an earlier entry/);
  });

  it('rejects a source path that climbs out of the project', () => {
    expect(() => parseAssetManifest({
      version: 1,
      assets: [{ assetKey: 'a', source: { path: '../../etc/passwd' } }],
    })).toThrow(/must not contain ".."/);
  });

  it('rejects an absolute source path', () => {
    expect(() => parseAssetManifest({
      version: 1,
      assets: [{ assetKey: 'a', source: { path: '/tmp/a.glb' } }],
    })).toThrow(/must be a project-relative path/);
  });

  it('rejects an unsupported manifest version rather than guessing', () => {
    expect(() => parseAssetManifest({ version: 2, assets: [] })).toThrow(/must be 1/);
  });

  it('rejects a malformed enum value', () => {
    expect(() => parseAssetManifest({
      version: 1,
      assets: [{ assetKey: 'a', source: { path: 'a.glb' }, import: { collision: 'convex' } }],
    })).toThrow(/must be one of hull, box, mesh, none/);
  });

  it('keeps null apart from absent for a material slot', () => {
    const parsed = parseAssetManifest({
      version: 1,
      assets: [{ assetKey: 'a', source: { path: 'a.glb' }, materials: { metalnessMap: null } }],
    });
    expect(parsed.assets[0].materials).toEqual({ metalnessMap: null });
  });

  it('fails closed on a damaged manifest instead of reading it as empty', () => {
    fs.writeFileSync(path.join(root, ASSET_MANIFEST_FILE), '{ "version": 1, ');
    expect(() => loadAssetManifest(root)).toThrow(/is not valid JSON/);
  });

  it('returns undefined when the project simply has no manifest', () => {
    expect(loadAssetManifest(root)).toBeUndefined();
  });
});

describe('status', () => {
  it('reports an asset that has never been published', () => {
    writeManifest({ version: 1, assets: [entry()] });
    const status = assetManifestStatus(root);
    expect(status.assets[0].state).toBe('never-published');
    expect(status.counts['never-published']).toBe(1);
  });

  it('answers "did the source change since we uploaded?"', () => {
    writeManifest({
      version: 1,
      assets: [entry({
        source: { path: 'art/pine_a.glb', sha256: 'a'.repeat(64) },
        roblox: { assetId: 456, assetVersion: 7 },
      })],
    });
    const status = assetManifestStatus(root);
    expect(status.assets[0].state).toBe('source-changed');
    expect(status.assets[0].source.actualSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is ok when the recorded hash still matches the file on disk', () => {
    const recorded = createHash('sha256').update('glb-bytes').digest('hex');
    writeManifest({
      version: 1,
      assets: [entry({
        source: { path: 'art/pine_a.glb', sha256: recorded },
        roblox: { assetId: 456, assetVersion: 7 },
      })],
    });
    const status = assetManifestStatus(root);
    expect(status.assets[0].state).toBe('ok');
    // The reproducibility triple the manifest exists to answer.
    expect(status.assets[0].source.actualSha256).toBe(recorded);
    expect(status.assets[0].recipe.preset).toBe('environment-static');
    expect(status.assets[0].roblox).toEqual({ assetId: 456, assetVersion: 7 });
  });

  it('reports a missing source rather than treating it as unpublished', () => {
    fs.rmSync(path.join(root, 'art/pine_a.glb'));
    writeManifest({ version: 1, assets: [entry()] });
    expect(assetManifestStatus(root).assets[0].state).toBe('source-missing');
  });

  it('flags a texture over the declared budget', () => {
    writePng(path.join(root, 'art/pine_a_color.png'), 4096, 4096);
    const recorded = createHash('sha256').update('glb-bytes').digest('hex');
    writeManifest({
      version: 1,
      assets: [entry({
        source: { path: 'art/pine_a.glb', sha256: recorded },
        materials: { colorMap: 'art/pine_a_color.png' },
        roblox: { assetId: 456 },
        policy: { maxTextureSize: 2048 },
      })],
    });
    const status = assetManifestStatus(root);
    expect(status.assets[0].state).toBe('policy-violation');
    expect(status.assets[0].materials[0]).toMatchObject({ width: 4096, height: 4096, overBudget: true });
    expect(status.assets[0].problems[0]).toContain('over the declared maxTextureSize of 2048');
  });

  it('reports a declared map that is missing on disk', () => {
    const recorded = createHash('sha256').update('glb-bytes').digest('hex');
    writeManifest({
      version: 1,
      assets: [entry({
        source: { path: 'art/pine_a.glb', sha256: recorded },
        materials: { normalMap: 'art/pine_a_normal.png' },
        roblox: { assetId: 456 },
      })],
    });
    expect(assetManifestStatus(root).assets[0].problems[0]).toMatch(/normalMap .* missing on disk/);
  });

  it('leaves a non-PNG map unmeasured rather than passing it silently', () => {
    fs.writeFileSync(path.join(root, 'art/pine_a_color.tga'), 'not-a-png');
    expect(pngDimensions(path.join(root, 'art/pine_a_color.tga'))).toBeUndefined();
  });
});

describe('scan', () => {
  it('binds sibling PBR maps to slots and leaves unknown suffixes unclassified', () => {
    writePng(path.join(root, 'art/pine_a_color.png'), 512, 512);
    writePng(path.join(root, 'art/pine_a_normal.png'), 512, 512);
    writePng(path.join(root, 'art/pine_a_roughness.png'), 512, 512);
    writePng(path.join(root, 'art/pine_a_curvature.png'), 512, 512);

    const scan = assetManifestScan(root);
    expect(scan.scanned).toBe(1);
    expect(scan.proposals[0]).toMatchObject({
      assetKey: 'pine_a',
      sourcePath: 'art/pine_a.glb',
      declared: false,
      materials: {
        colorMap: 'art/pine_a_color.png',
        normalMap: 'art/pine_a_normal.png',
        roughnessMap: 'art/pine_a_roughness.png',
      },
    });
    // A bake nobody asked for must not be bound to a slot it does not belong in.
    expect(scan.proposals[0].unclassifiedTextures).toEqual(['art/pine_a_curvature.png']);
  });

  it('prefers the longer suffix so _basecolor is not read as _color', () => {
    writePng(path.join(root, 'art/pine_a_basecolor.png'), 8, 8);
    expect(assetManifestScan(root).proposals[0].materials.colorMap).toBe('art/pine_a_basecolor.png');
  });

  it('does not bind a texture belonging to a different asset', () => {
    writePng(path.join(root, 'art/rock_color.png'), 8, 8);
    const scan = assetManifestScan(root);
    expect(scan.proposals[0].materials).toEqual({});
    // Nor list it as this asset's problem: it belongs to no scanned source, so
    // it is reported once at scan level instead of under every asset.
    expect(scan.proposals[0].unclassifiedTextures).toEqual([]);
    expect(scan.unmatchedTextures).toEqual(['art/rock_color.png']);
  });

  it('marks a source the manifest already declares', () => {
    writeManifest({ version: 1, assets: [entry()] });
    expect(assetManifestScan(root).proposals[0].declared).toBe(true);
  });

  it('reports a manifest entry whose source is gone', () => {
    writeManifest({ version: 1, assets: [entry({ source: { path: 'art/deleted.glb' } })] });
    expect(assetManifestScan(root).orphanedEntries).toEqual(['art/deleted.glb']);
  });

  it('still scans when the manifest is damaged, since that is when it is needed', () => {
    fs.writeFileSync(path.join(root, ASSET_MANIFEST_FILE), 'not json');
    const scan = assetManifestScan(root);
    expect(scan.scanned).toBe(1);
    expect(scan.proposals[0].declared).toBe(false);
  });

  it('is deterministic across runs', () => {
    writePng(path.join(root, 'art/pine_a_color.png'), 8, 8);
    fs.writeFileSync(path.join(root, 'art/b.glb'), 'b');
    expect(JSON.stringify(assetManifestScan(root))).toBe(JSON.stringify(assetManifestScan(root)));
  });

  it('refuses a scan directory outside the project', () => {
    expect(() => assetManifestScan(root, '../..')).toThrow(/Path must stay within project root/);
  });
});

describe('plan', () => {
  it('plans a publish for an unpublished asset and nothing for a settled one', () => {
    const recorded = createHash('sha256').update('glb-bytes').digest('hex');
    fs.writeFileSync(path.join(root, 'art/rock.glb'), 'rock-bytes');
    writeManifest({
      version: 1,
      assets: [
        entry({ source: { path: 'art/pine_a.glb', sha256: recorded }, roblox: { assetId: 1, assetVersion: 3 } }),
        { assetKey: 'environment/rock', source: { path: 'art/rock.glb' } },
      ],
    });
    const plan = assetManifestPlan(root);
    expect(plan.actions).toHaveLength(1);
    expect(plan.actions[0]).toMatchObject({ assetKey: 'environment/rock', action: 'publish' });
    expect(plan.planHash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('blocks a missing source instead of reporting it as a no-op', () => {
    fs.rmSync(path.join(root, 'art/pine_a.glb'));
    writeManifest({ version: 1, assets: [entry()] });
    const plan = assetManifestPlan(root);
    expect(plan.actions).toHaveLength(0);
    expect(plan.blocked[0]).toMatchObject({ assetKey: 'environment/tree/pine_a' });
  });

  it('changes the plan hash when a referenced file changes, not just the manifest', () => {
    // This is the invariant that makes the plan safe to apply: swapping a
    // texture between preview and apply must invalidate the preview.
    writePng(path.join(root, 'art/pine_a_color.png'), 512, 512);
    writeManifest({
      version: 1,
      assets: [entry({ materials: { colorMap: 'art/pine_a_color.png' } })],
    });
    const before = assetManifestPlan(root).planHash;

    writePng(path.join(root, 'art/pine_a_color.png'), 1024, 1024);
    expect(assetManifestPlan(root).planHash).not.toBe(before);
  });

  it('changes the plan hash when the source file changes', () => {
    writeManifest({ version: 1, assets: [entry()] });
    const before = assetManifestPlan(root).planHash;
    fs.writeFileSync(path.join(root, 'art/pine_a.glb'), 'different-bytes');
    expect(assetManifestPlan(root).planHash).not.toBe(before);
  });

  it('is stable when nothing changed', () => {
    writeManifest({ version: 1, assets: [entry()] });
    expect(assetManifestPlan(root).planHash).toBe(assetManifestPlan(root).planHash);
  });
});
