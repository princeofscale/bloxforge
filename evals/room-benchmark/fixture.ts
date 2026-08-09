// The one room, built three ways.
//
// Roadmap A3: the same 8x8 room — four walls, a floor, a doorway — with the
// same names, parent paths, materials, colours, anchoring and seed, reached by
// three routes. The point is not which route is prettiest; it is that the
// routes differ in what they put on the wire, and that difference has never
// been measured on identical work.
//
// Everything here is deliberate and fixed. A benchmark whose fixture drifts
// between runs compares two different benchmarks.

export const ROOM = {
  /** 8x8 modules of 4 studs each: a 32x32 stud room. */
  modules: 8,
  moduleStuds: 4,
  wallHeight: 12,
  wallThickness: 1,
  floorThickness: 1,
  parent: 'game.Workspace.BenchmarkRoom',
  material: 'Concrete',
  /** rgb(163, 162, 165) — Medium stone grey, the Roblox default part colour. */
  color: [163, 162, 165] as const,
  anchored: true,
  /** Which wall module the doorway replaces, counting from 0 along the north wall. */
  doorwayModule: 3,
  seed: 20260809,
};

export interface PartSpec {
  name: string;
  className: 'Part';
  parent: string;
  size: [number, number, number];
  position: [number, number, number];
  material: string;
  color: readonly [number, number, number];
  anchored: boolean;
}

/**
 * The room as a flat list of parts, in a fixed order.
 *
 * Derived rather than written out, because 8x8 written out is 33 near-identical
 * literals and one of them would eventually be wrong in a way no test would
 * catch. The order is the build order every route must follow, so a scene
 * digest can be compared across routes.
 */
export function roomParts(): PartSpec[] {
  const { modules, moduleStuds, wallHeight, wallThickness, floorThickness, parent, material, color, anchored, doorwayModule } = ROOM;
  const span = modules * moduleStuds;
  const half = span / 2;
  const parts: PartSpec[] = [];

  parts.push({
    name: 'Floor',
    className: 'Part',
    parent,
    size: [span, floorThickness, span],
    position: [0, floorThickness / 2, 0],
    material,
    color,
    anchored,
  });

  // North and south run along X; east and west along Z. Corners belong to the
  // north/south runs, so the east/west runs are two modules shorter and nothing
  // is built twice — a doubled corner would change the part count between
  // routes that dedupe and routes that do not.
  const y = floorThickness + wallHeight / 2;
  for (let i = 0; i < modules; i++) {
    const offset = -half + moduleStuds / 2 + i * moduleStuds;
    if (i !== doorwayModule) {
      parts.push({
        name: `WallNorth${String(i).padStart(2, '0')}`,
        className: 'Part',
        parent,
        size: [moduleStuds, wallHeight, wallThickness],
        position: [offset, y, -half],
        material, color, anchored,
      });
    }
    parts.push({
      name: `WallSouth${String(i).padStart(2, '0')}`,
      className: 'Part',
      parent,
      size: [moduleStuds, wallHeight, wallThickness],
      position: [offset, y, half],
      material, color, anchored,
    });
  }
  for (let i = 1; i < modules - 1; i++) {
    const offset = -half + moduleStuds / 2 + i * moduleStuds;
    parts.push({
      name: `WallWest${String(i).padStart(2, '0')}`,
      className: 'Part',
      parent,
      size: [wallThickness, wallHeight, moduleStuds],
      position: [-half, y, offset],
      material, color, anchored,
    });
    parts.push({
      name: `WallEast${String(i).padStart(2, '0')}`,
      className: 'Part',
      parent,
      size: [wallThickness, wallHeight, moduleStuds],
      position: [half, y, offset],
      material, color, anchored,
    });
  }
  return parts;
}
