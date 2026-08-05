// Asset Manifest v1 — the declared, reproducible identity of every art asset in
// a project.
//
// The problem it solves: an asset in a place is an opaque numeric ID. Nothing in
// the place records which local file it came from, which import settings
// produced it, or which version is currently published, so "rebuild this asset
// on another machine" is guesswork and "did the source change since we
// uploaded?" is unanswerable.
//
// The manifest is declarative. It states the desired state; `assetManifestPlan`
// compares that against what is actually on disk and produces an immutable plan
// that an apply may only execute if its hash still matches. That is the same
// plan/planHash contract the Rojo syncback path uses — deliberately, so there is
// one preview-then-apply model in this codebase rather than two.
//
// Everything here is local and offline: reading, hashing, validating and
// diffing. Uploading and importing are separate, Studio- and Open-Cloud-facing
// steps that consume a plan produced here.
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { resolveProjectPath, resolveProjectRoot } from './rojo/source-mapper.js';

export const ASSET_MANIFEST_FILE = 'bloxforge.assets.json';
export const ASSET_MANIFEST_VERSION = 1;

const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;

export type PivotPolicy = 'base-center' | 'center' | 'origin';
export type CollisionPreset = 'hull' | 'box' | 'mesh' | 'none';
export type RenderFidelity = 'automatic' | 'precise' | 'performance';
export type OwnerType = 'user' | 'group';

export interface AssetSource {
  /** Project-relative path to the authored file (`.glb`, `.fbx`, `.obj`, …). */
  path: string;
  /** Content hash recorded when the asset was last published. */
  sha256?: string;
  dcc?: string;
  unitScale?: number;
  forwardAxis?: string;
  upAxis?: string;
}

export interface AssetImport {
  preset?: string;
  pivotPolicy?: PivotPolicy;
  collision?: CollisionPreset;
  renderFidelity?: RenderFidelity;
  package?: boolean;
}

export interface AssetMaterials {
  colorMap?: string | null;
  normalMap?: string | null;
  roughnessMap?: string | null;
  metalnessMap?: string | null;
}

export interface AssetRoblox {
  ownerType?: OwnerType;
  ownerId?: number;
  assetId?: number;
  assetVersion?: number;
  packageId?: number;
}

export interface AssetPolicy {
  scriptsAllowed?: boolean;
  license?: string;
  maxTriangles?: number;
  maxTextureSize?: number;
}

export interface AssetEntry {
  assetKey: string;
  source: AssetSource;
  import?: AssetImport;
  materials?: AssetMaterials;
  roblox?: AssetRoblox;
  policy?: AssetPolicy;
}

export interface AssetManifest {
  version: number;
  assets: AssetEntry[];
}

export interface LoadedAssetManifest {
  /** Absolute path of the manifest file. */
  path: string;
  /** Directory the manifest's relative paths resolve against. */
  directory: string;
  manifest: AssetManifest;
}

const MATERIAL_SLOTS = ['colorMap', 'normalMap', 'roughnessMap', 'metalnessMap'] as const;
export type MaterialSlot = (typeof MATERIAL_SLOTS)[number];

// ── validation ───────────────────────────────────────────────────────────────
// Unknown keys are rejected rather than ignored. A manifest is configuration a
// human edits by hand, and a silently-ignored `pivotPolicty` typo means the
// asset imports with the wrong pivot and nothing ever says so.

function fail(where: string, message: string): never {
  throw new Error(`${ASSET_MANIFEST_FILE}: ${where} ${message}`);
}

function requireObject(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(where, 'must be an object');
  return value as Record<string, unknown>;
}

function rejectUnknownKeys(value: Record<string, unknown>, allowed: readonly string[], where: string): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    fail(where, `has unknown key(s) ${unknown.map((k) => JSON.stringify(k)).join(', ')}; allowed: ${allowed.join(', ')}`);
  }
}

function optionalString(value: Record<string, unknown>, key: string, where: string): string | undefined {
  const raw = value[key];
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string' || raw === '') fail(`${where}.${key}`, 'must be a non-empty string');
  return raw;
}

function optionalNumber(value: Record<string, unknown>, key: string, where: string): number | undefined {
  const raw = value[key];
  if (raw === undefined) return undefined;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) fail(`${where}.${key}`, 'must be a finite number');
  return raw;
}

function optionalPositiveInt(value: Record<string, unknown>, key: string, where: string): number | undefined {
  const raw = optionalNumber(value, key, where);
  if (raw === undefined) return undefined;
  if (!Number.isInteger(raw) || raw <= 0) fail(`${where}.${key}`, 'must be a positive integer');
  return raw;
}

function optionalBoolean(value: Record<string, unknown>, key: string, where: string): boolean | undefined {
  const raw = value[key];
  if (raw === undefined) return undefined;
  if (typeof raw !== 'boolean') fail(`${where}.${key}`, 'must be true or false');
  return raw;
}

function optionalEnum<T extends string>(
  value: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
  where: string,
): T | undefined {
  const raw = optionalString(value, key, where);
  if (raw === undefined) return undefined;
  if (!allowed.includes(raw as T)) fail(`${where}.${key}`, `must be one of ${allowed.join(', ')}`);
  return raw as T;
}

/** A path inside the manifest must be relative and must not climb out of the project. */
function manifestRelativePath(raw: string, where: string): string {
  if (path.isAbsolute(raw)) fail(where, 'must be a project-relative path, not absolute');
  const normalized = raw.split('\\').join('/');
  if (normalized.split('/').includes('..')) fail(where, 'must not contain ".."');
  return normalized;
}

function parseSource(raw: unknown, where: string): AssetSource {
  const value = requireObject(raw, where);
  rejectUnknownKeys(value, ['path', 'sha256', 'dcc', 'unitScale', 'forwardAxis', 'upAxis'], where);
  const sourcePath = optionalString(value, 'path', where);
  if (!sourcePath) fail(`${where}.path`, 'is required');
  const sha256 = optionalString(value, 'sha256', where);
  if (sha256 !== undefined && !/^[0-9a-f]{64}$/.test(sha256)) {
    fail(`${where}.sha256`, 'must be a lowercase 64-character hex digest');
  }
  const unitScale = optionalNumber(value, 'unitScale', where);
  if (unitScale !== undefined && unitScale <= 0) fail(`${where}.unitScale`, 'must be greater than zero');
  return {
    path: manifestRelativePath(sourcePath, `${where}.path`),
    sha256,
    dcc: optionalString(value, 'dcc', where),
    unitScale,
    forwardAxis: optionalString(value, 'forwardAxis', where),
    upAxis: optionalString(value, 'upAxis', where),
  };
}

function parseImport(raw: unknown, where: string): AssetImport {
  const value = requireObject(raw, where);
  rejectUnknownKeys(value, ['preset', 'pivotPolicy', 'collision', 'renderFidelity', 'package'], where);
  return {
    preset: optionalString(value, 'preset', where),
    pivotPolicy: optionalEnum(value, 'pivotPolicy', ['base-center', 'center', 'origin'] as const, where),
    collision: optionalEnum(value, 'collision', ['hull', 'box', 'mesh', 'none'] as const, where),
    renderFidelity: optionalEnum(value, 'renderFidelity', ['automatic', 'precise', 'performance'] as const, where),
    package: optionalBoolean(value, 'package', where),
  };
}

function parseMaterials(raw: unknown, where: string): AssetMaterials {
  const value = requireObject(raw, where);
  rejectUnknownKeys(value, MATERIAL_SLOTS, where);
  const materials: AssetMaterials = {};
  for (const slot of MATERIAL_SLOTS) {
    const entry = value[slot];
    // `null` is meaningful: it declares "this asset has no metalness map",
    // which is different from not having decided yet.
    if (entry === null) {
      materials[slot] = null;
      continue;
    }
    const asPath = optionalString(value, slot, where);
    if (asPath !== undefined) materials[slot] = manifestRelativePath(asPath, `${where}.${slot}`);
  }
  return materials;
}

function parseRoblox(raw: unknown, where: string): AssetRoblox {
  const value = requireObject(raw, where);
  rejectUnknownKeys(value, ['ownerType', 'ownerId', 'assetId', 'assetVersion', 'packageId'], where);
  return {
    ownerType: optionalEnum(value, 'ownerType', ['user', 'group'] as const, where),
    ownerId: optionalPositiveInt(value, 'ownerId', where),
    assetId: optionalPositiveInt(value, 'assetId', where),
    assetVersion: optionalPositiveInt(value, 'assetVersion', where),
    packageId: optionalPositiveInt(value, 'packageId', where),
  };
}

function parsePolicy(raw: unknown, where: string): AssetPolicy {
  const value = requireObject(raw, where);
  rejectUnknownKeys(value, ['scriptsAllowed', 'license', 'maxTriangles', 'maxTextureSize'], where);
  return {
    scriptsAllowed: optionalBoolean(value, 'scriptsAllowed', where),
    license: optionalString(value, 'license', where),
    maxTriangles: optionalPositiveInt(value, 'maxTriangles', where),
    maxTextureSize: optionalPositiveInt(value, 'maxTextureSize', where),
  };
}

export function parseAssetManifest(raw: unknown): AssetManifest {
  const root = requireObject(raw, 'manifest');
  rejectUnknownKeys(root, ['version', 'assets'], 'manifest');

  const version = root.version;
  if (version !== ASSET_MANIFEST_VERSION) {
    fail('manifest.version', `must be ${ASSET_MANIFEST_VERSION}; found ${JSON.stringify(version ?? null)}`);
  }
  if (!Array.isArray(root.assets)) fail('manifest.assets', 'must be an array');

  const assets: AssetEntry[] = [];
  const seen = new Set<string>();
  root.assets.forEach((entryRaw, index) => {
    const where = `assets[${index}]`;
    const value = requireObject(entryRaw, where);
    rejectUnknownKeys(value, ['assetKey', 'source', 'import', 'materials', 'roblox', 'policy'], where);

    const assetKey = optionalString(value, 'assetKey', where);
    if (!assetKey) fail(`${where}.assetKey`, 'is required');
    // The key is the stable identity a place instance points back to, so a
    // duplicate would make provenance ambiguous for every instance using it.
    if (seen.has(assetKey)) fail(`${where}.assetKey`, `duplicates an earlier entry (${JSON.stringify(assetKey)})`);
    seen.add(assetKey);
    if (value.source === undefined) fail(`${where}.source`, 'is required');

    assets.push({
      assetKey,
      source: parseSource(value.source, `${where}.source`),
      import: value.import === undefined ? undefined : parseImport(value.import, `${where}.import`),
      materials: value.materials === undefined ? undefined : parseMaterials(value.materials, `${where}.materials`),
      roblox: value.roblox === undefined ? undefined : parseRoblox(value.roblox, `${where}.roblox`),
      policy: value.policy === undefined ? undefined : parsePolicy(value.policy, `${where}.policy`),
    });
  });

  return { version: ASSET_MANIFEST_VERSION, assets };
}

// ── loading ──────────────────────────────────────────────────────────────────

/** Loads the manifest, or returns undefined when the project has none. Throws on a damaged one. */
export function loadAssetManifest(root?: string): LoadedAssetManifest | undefined {
  const projectRoot = resolveProjectRoot(root ?? process.cwd());
  const file = path.join(projectRoot, ASSET_MANIFEST_FILE);
  if (!fs.existsSync(file)) return undefined;

  const size = fs.statSync(file).size;
  if (size > MAX_MANIFEST_BYTES) {
    throw new Error(`${ASSET_MANIFEST_FILE} is ${size} bytes, over the ${MAX_MANIFEST_BYTES}-byte limit`);
  }
  let data: unknown;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    // Fail closed: a manifest we cannot parse is not an empty manifest.
    throw new Error(
      `${ASSET_MANIFEST_FILE} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  return { path: file, directory: projectRoot, manifest: parseAssetManifest(data) };
}

// ── local inspection ─────────────────────────────────────────────────────────

function hashFile(file: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/**
 * Width/height of a PNG, read from its IHDR chunk. Only PNG is decoded on
 * purpose: it is the format whose header is unambiguous without a dependency,
 * and an unrecognised format reports `undefined` (unchecked) rather than
 * silently passing a texture budget it was never measured against.
 */
export function pngDimensions(file: string): { width: number; height: number } | undefined {
  let handle: number | undefined;
  try {
    handle = fs.openSync(file, 'r');
    const header = Buffer.alloc(24);
    if (fs.readSync(handle, header, 0, 24, 0) < 24) return undefined;
    if (header.readUInt32BE(0) !== 0x89504e47 || header.subarray(12, 16).toString('ascii') !== 'IHDR') return undefined;
    return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
  } catch {
    return undefined;
  } finally {
    if (handle !== undefined) fs.closeSync(handle);
  }
}

export type AssetState =
  | 'ok'
  | 'source-missing'
  | 'source-changed'
  | 'never-published'
  | 'policy-violation';

export interface AssetMaterialStatus {
  slot: MaterialSlot;
  path: string;
  present: boolean;
  width?: number;
  height?: number;
  /** Set when the map exceeds `policy.maxTextureSize`. */
  overBudget?: boolean;
}

export interface AssetStatus {
  assetKey: string;
  state: AssetState;
  /** What the manifest says the source is, and what it actually is right now. */
  source: { path: string; present: boolean; recordedSha256?: string; actualSha256?: string };
  /** The recipe identity: the import settings the asset was produced with. */
  recipe: AssetImport;
  roblox: AssetRoblox;
  materials: AssetMaterialStatus[];
  /** Human-readable reasons behind a non-`ok` state. */
  problems: string[];
}

function relativeFile(directory: string, relative: string): string | undefined {
  try {
    return resolveProjectPath(directory, relative, false);
  } catch {
    return undefined;
  }
}

function statusFor(loaded: LoadedAssetManifest, entry: AssetEntry): AssetStatus {
  const problems: string[] = [];
  const sourceFile = relativeFile(loaded.directory, entry.source.path);
  const present = !!sourceFile && fs.existsSync(sourceFile) && fs.statSync(sourceFile).isFile();
  const actualSha256 = present ? hashFile(sourceFile!) : undefined;

  const materials: AssetMaterialStatus[] = [];
  const maxTextureSize = entry.policy?.maxTextureSize;
  for (const slot of MATERIAL_SLOTS) {
    const declared = entry.materials?.[slot];
    if (typeof declared !== 'string') continue;
    const file = relativeFile(loaded.directory, declared);
    const mapPresent = !!file && fs.existsSync(file) && fs.statSync(file).isFile();
    const status: AssetMaterialStatus = { slot, path: declared, present: mapPresent };
    if (mapPresent) {
      const size = pngDimensions(file!);
      if (size) {
        status.width = size.width;
        status.height = size.height;
        if (maxTextureSize !== undefined && Math.max(size.width, size.height) > maxTextureSize) {
          status.overBudget = true;
          problems.push(
            `${slot} ${declared} is ${size.width}x${size.height}, over the declared maxTextureSize of ${maxTextureSize}`,
          );
        }
      }
    } else {
      problems.push(`${slot} ${declared} is declared but missing on disk`);
    }
    materials.push(status);
  }

  let state: AssetState;
  if (!present) {
    problems.unshift(`source ${entry.source.path} is missing on disk`);
    state = 'source-missing';
  } else if (entry.source.sha256 && entry.source.sha256 !== actualSha256) {
    problems.unshift(`source ${entry.source.path} changed since it was last published`);
    state = 'source-changed';
  } else if (entry.roblox?.assetId === undefined) {
    state = 'never-published';
  } else if (problems.length > 0) {
    state = 'policy-violation';
  } else {
    state = 'ok';
  }

  return {
    assetKey: entry.assetKey,
    state,
    source: { path: entry.source.path, present, recordedSha256: entry.source.sha256, actualSha256 },
    recipe: entry.import ?? {},
    roblox: entry.roblox ?? {},
    materials,
    problems,
  };
}

export interface AssetManifestStatus {
  manifestPath: string;
  assetCount: number;
  assets: AssetStatus[];
  counts: Record<AssetState, number>;
}

export function assetManifestStatus(root?: string): AssetManifestStatus {
  const loaded = loadAssetManifest(root);
  if (!loaded) {
    throw new Error(
      `No ${ASSET_MANIFEST_FILE} in the project root. Create one to declare the source, import recipe and ` +
      'published version of each art asset.',
    );
  }
  const assets = loaded.manifest.assets.map((entry) => statusFor(loaded, entry));
  const counts: Record<AssetState, number> = {
    'ok': 0,
    'source-missing': 0,
    'source-changed': 0,
    'never-published': 0,
    'policy-violation': 0,
  };
  for (const asset of assets) counts[asset.state] += 1;
  return { manifestPath: loaded.path, assetCount: assets.length, assets, counts };
}

// ── planning ─────────────────────────────────────────────────────────────────

export type AssetActionKind = 'publish' | 'republish' | 'repair' | 'none';

export interface AssetAction {
  assetKey: string;
  action: AssetActionKind;
  reason: string;
  /** The triple that makes the result reproducible: source hash, recipe, published version. */
  identity: {
    sourceSha256?: string;
    recipe: AssetImport;
    assetId?: number;
    assetVersion?: number;
  };
}

export interface AssetManifestPlan {
  manifestPath: string;
  planHash: string;
  actions: AssetAction[];
  /** Assets an apply cannot act on, with the reason. Blocking, not skipped silently. */
  blocked: { assetKey: string; reason: string }[];
}

function actionFor(status: AssetStatus): AssetActionKind {
  if (status.state === 'never-published') return 'publish';
  if (status.state === 'source-changed') return 'republish';
  if (status.state === 'policy-violation') return 'repair';
  return 'none';
}

/**
 * The hash must cover every input the apply depends on, so a plan cannot be
 * applied after any of them moved: the manifest itself, and the current content
 * of every local file it references. Recording only the manifest would let a
 * texture be swapped between preview and apply without invalidating the plan.
 */
function planHash(loaded: LoadedAssetManifest, actions: AssetAction[]): string {
  const digest = crypto.createHash('sha256');
  digest.update(JSON.stringify({
    manifestVersion: loaded.manifest.version,
    actions: actions.map((a) => ({ assetKey: a.assetKey, action: a.action, identity: a.identity })),
  }));
  digest.update(`\0manifest\0${hashFile(loaded.path)}`);
  for (const entry of loaded.manifest.assets) {
    const referenced = [entry.source.path, ...MATERIAL_SLOTS.map((slot) => entry.materials?.[slot])];
    for (const relative of referenced) {
      if (typeof relative !== 'string') continue;
      const file = relativeFile(loaded.directory, relative);
      const content = file && fs.existsSync(file) && fs.statSync(file).isFile() ? hashFile(file) : 'absent';
      digest.update(`\0${entry.assetKey}\0${relative}\0${content}`);
    }
  }
  return `sha256:${digest.digest('hex')}`;
}

// ── scanning ─────────────────────────────────────────────────────────────────
// Hand-writing a manifest entry per asset is what stops a manifest from being
// adopted, so the scan proposes entries from what is already on disk. It never
// writes: the proposal is reviewed and committed by whoever owns the art, which
// is also why an unrecognised map suffix is reported rather than guessed at.

const SOURCE_EXTENSIONS = ['.glb', '.gltf', '.fbx', '.obj'] as const;
const TEXTURE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.tga', '.tif', '.tiff'] as const;

/**
 * Suffix conventions, longest first so `_basecolor` is not matched as `_color`.
 * Roblox's SurfaceAppearance takes Color/Normal/Roughness/Metalness, so those
 * are the four slots; anything else found next to a source is reported as
 * unclassified rather than silently bound to a slot it does not belong in.
 */
const MAP_SUFFIXES: readonly (readonly [string, MaterialSlot])[] = [
  ['_basecolor', 'colorMap'],
  ['_base_color', 'colorMap'],
  ['_metallic', 'metalnessMap'],
  ['_metalness', 'metalnessMap'],
  ['_roughness', 'roughnessMap'],
  ['_diffuse', 'colorMap'],
  ['_albedo', 'colorMap'],
  ['_normal', 'normalMap'],
  ['_color', 'colorMap'],
  ['_rough', 'roughnessMap'],
  ['_metal', 'metalnessMap'],
  ['_nrm', 'normalMap'],
  ['_col', 'colorMap'],
];

export interface ScannedAsset {
  /** Suggested assetKey, derived from the path so it is stable across machines. */
  assetKey: string;
  sourcePath: string;
  sha256: string;
  materials: Partial<Record<MaterialSlot, string>>;
  /**
   * Textures named after this source whose suffix matched no known slot — a
   * `_curvature` bake, say. Distinct from a texture that belongs to no source
   * at all, which is reported once at scan level rather than under every asset.
   */
  unclassifiedTextures: string[];
  /** True when the manifest already declares this source. */
  declared: boolean;
}

export interface AssetManifestScan {
  root: string;
  scanned: number;
  proposals: ScannedAsset[];
  /** Manifest entries whose source no longer exists under the scanned tree. */
  orphanedEntries: string[];
  /** Textures whose name matches no 3D source found in the same directory. */
  unmatchedTextures: string[];
}

function walkFiles(directory: string, out: string[], depth = 0): void {
  // A depth cap keeps a symlinked or pathological tree from walking forever.
  if (depth > 12) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) walkFiles(full, out, depth + 1);
    else if (entry.isFile()) out.push(full);
  }
}

/**
 * `unrelated` and `unknown-suffix` are deliberately different answers. A texture
 * that simply belongs to another asset must not be listed under this one, or
 * every scan reads as though every asset had stray maps.
 */
function classifyTexture(stem: string, textureStem: string): MaterialSlot | 'unrelated' | 'unknown-suffix' {
  if (!textureStem.toLowerCase().startsWith(stem.toLowerCase())) return 'unrelated';
  const remainder = textureStem.slice(stem.length).toLowerCase();
  if (remainder === '') return 'colorMap';
  for (const [suffix, slot] of MAP_SUFFIXES) {
    if (remainder === suffix) return slot;
  }
  return 'unknown-suffix';
}

/** Proposes manifest entries for every 3D source found under `directory`. */
export function assetManifestScan(root?: string, directory = 'art'): AssetManifestScan {
  const projectRoot = resolveProjectRoot(root ?? process.cwd());
  const scanRoot = resolveProjectPath(projectRoot, directory, false);
  if (!fs.existsSync(scanRoot)) {
    throw new Error(`Scan directory ${directory} does not exist under the project root.`);
  }

  const files: string[] = [];
  walkFiles(scanRoot, files);

  const relative = (file: string) => path.relative(projectRoot, file).split(path.sep).join('/');
  const declared = new Set<string>();
  let loaded: LoadedAssetManifest | undefined;
  try {
    loaded = loadAssetManifest(projectRoot);
  } catch {
    // A damaged manifest must not stop a scan whose whole purpose is to help
    // rebuild one; every proposal simply reports declared: false.
    loaded = undefined;
  }
  for (const entry of loaded?.manifest.assets ?? []) declared.add(entry.source.path);

  const proposals: ScannedAsset[] = [];
  const claimedTextures = new Set<string>();
  const allTextures = new Set<string>();
  for (const file of files) {
    const extension = path.extname(file).toLowerCase();
    if (!(SOURCE_EXTENSIONS as readonly string[]).includes(extension)) continue;
    const stem = path.basename(file, path.extname(file));
    const siblings = files.filter(
      (candidate) => path.dirname(candidate) === path.dirname(file)
        && (TEXTURE_EXTENSIONS as readonly string[]).includes(path.extname(candidate).toLowerCase()),
    );

    const materials: Partial<Record<MaterialSlot, string>> = {};
    const unclassifiedTextures: string[] = [];
    for (const sibling of siblings) {
      allTextures.add(relative(sibling));
      const slot = classifyTexture(stem, path.basename(sibling, path.extname(sibling)));
      if (slot === 'unrelated') continue;
      claimedTextures.add(relative(sibling));
      if (slot === 'unknown-suffix') {
        unclassifiedTextures.push(relative(sibling));
        continue;
      }
      // First match wins so a rescan is deterministic regardless of readdir order.
      if (!materials[slot]) materials[slot] = relative(sibling);
    }

    const sourcePath = relative(file);
    proposals.push({
      assetKey: sourcePath.replace(/^art\//, '').replace(/\.[^.]+$/, ''),
      sourcePath,
      sha256: hashFile(file),
      materials,
      unclassifiedTextures: unclassifiedTextures.sort(),
      declared: declared.has(sourcePath),
    });
  }

  proposals.sort((a, b) => a.sourcePath.localeCompare(b.sourcePath));
  const found = new Set(proposals.map((proposal) => proposal.sourcePath));
  const orphanedEntries = [...declared].filter((source) => !found.has(source)).sort();

  const unmatchedTextures = [...allTextures].filter((texture) => !claimedTextures.has(texture)).sort();

  return {
    root: relative(scanRoot) || '.',
    scanned: proposals.length,
    proposals,
    orphanedEntries,
    unmatchedTextures,
  };
}

export function assetManifestPlan(root?: string): AssetManifestPlan {
  const loaded = loadAssetManifest(root);
  if (!loaded) throw new Error(`No ${ASSET_MANIFEST_FILE} in the project root; nothing to plan.`);

  const actions: AssetAction[] = [];
  const blocked: { assetKey: string; reason: string }[] = [];

  for (const entry of loaded.manifest.assets) {
    const status = statusFor(loaded, entry);
    // A missing source is blocking, not a step: an apply cannot invent the file,
    // and reporting it as a no-op would read as "this asset is fine".
    if (status.state === 'source-missing') {
      blocked.push({ assetKey: entry.assetKey, reason: status.problems[0] ?? 'source is missing on disk' });
      continue;
    }
    const action = actionFor(status);
    if (action === 'none') continue;
    actions.push({
      assetKey: entry.assetKey,
      action,
      reason: status.problems[0] ?? (action === 'publish' ? 'no assetId recorded yet' : 'source changed'),
      identity: {
        sourceSha256: status.source.actualSha256,
        recipe: status.recipe,
        assetId: status.roblox.assetId,
        assetVersion: status.roblox.assetVersion,
      },
    });
  }

  return { manifestPath: loaded.path, planHash: planHash(loaded, actions), actions, blocked };
}
