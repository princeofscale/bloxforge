// Generators for Terrain operations. Terrain has no settable "property" form,
// so these must run as Luau in the plugin edit context against workspace.Terrain.
// Volume helpers are exported so the tool layer can enforce hard size limits
// (preventing an AI from freezing Studio with a giant FillRegion) before the
// generated code is ever sent.

import { luaNumber, vector3, enumMember } from './luau-emit.js';

export type Vec3 = [number, number, number];

export function boxVolume(size: Vec3): number {
  return Math.abs(size[0]) * Math.abs(size[1]) * Math.abs(size[2]);
}

export function regionVolume(min: Vec3, max: Vec3): number {
  return Math.abs(max[0] - min[0]) * Math.abs(max[1] - min[1]) * Math.abs(max[2] - min[2]);
}

function material(name: string, option = 'material'): string {
  return enumMember('Material', option, name);
}

function region3(min: Vec3, max: Vec3): string {
  return `Region3.new(${vector3(...min)}, ${vector3(...max)}):ExpandToGrid(4)`;
}

export interface BaseplateOptions {
  size: Vec3;
  position?: Vec3;
  material?: string;
}

export function buildBaseplateLuau(options: BaseplateOptions): string {
  const pos = options.position ?? [0, 0, 0];
  const mat = material(options.material ?? 'Grass');
  return [
    'local Terrain = workspace.Terrain',
    'if _G.__mcp and _G.__mcp.checkCancelled and _G.__mcp.checkCancelled() then return { cancelled = true } end',
    `Terrain:FillBlock(CFrame.new(${vector3(...pos)}), ${vector3(...options.size)}, ${mat})`,
    `return { shape = "baseplate", volume = ${luaNumber(boxVolume(options.size))}, success = true }`,
  ].join('\n');
}

export interface IslandOptions {
  center: Vec3;
  radius: number;
  material?: string;
  waterMaterial?: string;
  waterRadius?: number;
}

export function buildIslandLuau(options: IslandOptions): string {
  const mat = material(options.material ?? 'Sand');
  const lines = [
    'local Terrain = workspace.Terrain',
    'if _G.__mcp and _G.__mcp.checkCancelled and _G.__mcp.checkCancelled() then return { cancelled = true } end',
    `Terrain:FillBall(${vector3(...options.center)}, ${luaNumber(options.radius)}, ${mat})`,
  ];
  if (options.waterMaterial || options.waterRadius) {
    const wr = options.waterRadius ?? options.radius * 1.6;
    const cy = options.center[1];
    const waterMat = material(options.waterMaterial ?? 'Water');
    // A shallow water disk around the island, sitting at the island's base.
    lines.push(`Terrain:FillBlock(CFrame.new(${vector3(options.center[0], cy - options.radius * 0.5, options.center[2])}), ${vector3(wr * 2, options.radius, wr * 2)}, ${waterMat})`);
  }
  lines.push(`return { shape = "island", radius = ${luaNumber(options.radius)}, success = true }`);
  return lines.join('\n');
}

export interface MountainsOptions {
  center: Vec3;
  extent: [number, number];
  maxHeight: number;
  material?: string;
  resolution?: number;
  seed?: number;
  frequency?: number;
}

/**
 * How many FillBlock calls `buildMountainsLuau` will make.
 *
 * The tool layer gates terrain on volume, which is the right measure for one
 * FillBlock or FillRegion. Mountains are a grid of them, and the grid is
 * quadratic in `resolution` — extent 2000×2000 at the minimum resolution of 4
 * is ~250,000 calls, whatever `maxHeight` says the volume is. Freezing Studio
 * is the thing these helpers exist to prevent, so the count is a measure too.
 */
export function mountainCells(extent: [number, number], resolution?: number): number {
  const res = resolution && resolution >= 4 ? resolution : 16;
  return (Math.floor(Math.abs(extent[0]) / res) + 1) * (Math.floor(Math.abs(extent[1]) / res) + 1);
}

// ponytail: a chosen ceiling, not a measured one — nobody has run a grid this
// large against Studio to find where it actually stops responding. Upgrade
// path: replace it with a number a run gives, and say which run.
export const MOUNTAIN_CELL_CEILING = 20000;

export function buildMountainsLuau(options: MountainsOptions): string {
  const cells = mountainCells(options.extent, options.resolution);
  if (cells > MOUNTAIN_CELL_CEILING) {
    throw new Error(
      `terrain_generate_mountains would make ${cells} FillBlock calls (ceiling ${MOUNTAIN_CELL_CEILING}). ` +
      `The grid is extent/resolution squared, so raise resolution (currently ${options.resolution && options.resolution >= 4 ? options.resolution : 16}) ` +
      'or generate the range in sections.',
    );
  }
  const mat = material(options.material ?? 'Rock');
  const res = options.resolution && options.resolution >= 4 ? options.resolution : 16;
  const seed = options.seed ?? 0;
  const freq = options.frequency ?? 100;
  const [cx, cy, cz] = options.center;
  const [ex, ez] = options.extent;
  return [
    'local Terrain = workspace.Terrain',
    `local res = ${luaNumber(res)}`,
    `local maxHeight = ${luaNumber(options.maxHeight)}`,
    `local seed = ${luaNumber(seed)}`,
    `local baseX, baseY, baseZ = ${luaNumber(cx - ex / 2)}, ${luaNumber(cy)}, ${luaNumber(cz - ez / 2)}`,
    `for gx = 0, ${luaNumber(ex)}, res do`,
    '\tif _G.__mcp and _G.__mcp.checkCancelled and _G.__mcp.checkCancelled() then return { cancelled = true } end',
    `\tfor gz = 0, ${luaNumber(ez)}, res do`,
    '\t\tlocal wx = baseX + gx',
    '\t\tlocal wz = baseZ + gz',
    `\t\tlocal n = (math.noise(wx / ${luaNumber(freq)} + seed, wz / ${luaNumber(freq)} + seed) + 1) * 0.5`,
    '\t\tlocal h = math.max(4, n * maxHeight)',
    `\t\tTerrain:FillBlock(CFrame.new(wx, baseY + h / 2, wz), Vector3.new(res, h, res), ${mat})`,
    '\tend',
    'end',
    'return { shape = "mountains", success = true }',
  ].join('\n');
}

export interface WaterOptions {
  size: Vec3;
  position?: Vec3;
}

export function buildWaterLuau(options: WaterOptions): string {
  const pos = options.position ?? [0, 0, 0];
  return [
    'local Terrain = workspace.Terrain',
    'if _G.__mcp and _G.__mcp.checkCancelled and _G.__mcp.checkCancelled() then return { cancelled = true } end',
    `Terrain:FillBlock(CFrame.new(${vector3(...pos)}), ${vector3(...options.size)}, Enum.Material.Water)`,
    `return { shape = "water", volume = ${luaNumber(boxVolume(options.size))}, success = true }`,
  ].join('\n');
}

export interface PaintMaterialOptions {
  min: Vec3;
  max: Vec3;
  material: string;
  replaceMaterial?: string;
}

export function buildPaintMaterialLuau(options: PaintMaterialOptions): string {
  const target = material(options.material);
  const region = region3(options.min, options.max);
  const op = options.replaceMaterial
    ? `Terrain:ReplaceMaterial(${region}, 4, ${material(options.replaceMaterial, 'replaceMaterial')}, ${target})`
    : `Terrain:FillRegion(${region}, 4, ${target})`;
  return [
    'local Terrain = workspace.Terrain',
    'if _G.__mcp and _G.__mcp.checkCancelled and _G.__mcp.checkCancelled() then return { cancelled = true } end',
    op,
    'return { shape = "paint", success = true }',
  ].join('\n');
}

export interface ClearRegionOptions {
  min: Vec3;
  max: Vec3;
}

export function buildClearRegionLuau(options: ClearRegionOptions): string {
  return [
    'local Terrain = workspace.Terrain',
    'if _G.__mcp and _G.__mcp.checkCancelled and _G.__mcp.checkCancelled() then return { cancelled = true } end',
    `Terrain:FillRegion(${region3(options.min, options.max)}, 4, Enum.Material.Air)`,
    'return { shape = "clear", success = true }',
  ].join('\n');
}
