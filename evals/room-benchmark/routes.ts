// The three routes, as the exact tool calls each one makes.
//
// Written as data rather than as a live agent loop on purpose: the payload
// accounting below runs with no model, no key and no Studio, so the one part of
// the roadmap's A3 measurement contract that does not need a budget can run in
// CI. What is left needing Studio and a provider is stated in the README, not
// implied away.
import { roomParts, ROOM, type PartSpec } from './fixture.js';

export type RouteName = 'A' | 'B' | 'C';

export interface ToolCall {
  tool: string;
  args: Record<string, unknown>;
}

/** A: one create_object per part, the way an agent reaches for it first. */
export function routeA(): ToolCall[] {
  return roomParts().map((p) => ({
    tool: 'create_object',
    args: {
      className: p.className,
      parent: p.parent,
      name: p.name,
      properties: {
        Size: p.size,
        Position: p.position,
        Material: p.material,
        Color: p.color,
        Anchored: p.anchored,
      },
    },
  }));
}

/** B: one batch call carrying every part. */
export function routeB(): ToolCall[] {
  return [{
    tool: 'mass_create_objects',
    args: {
      objects: roomParts().map((p: PartSpec) => ({
        className: p.className,
        parent: p.parent,
        name: p.name,
        properties: {
          Size: p.size,
          Position: p.position,
          Material: p.material,
          Color: p.color,
          Anchored: p.anchored,
        },
      })),
    },
  }];
}

/**
 * C: one execute_luau that builds the room from the same rules.
 *
 * Note what this route trades. The code is compact because it re-derives the
 * geometry instead of listing it — but it is Luau the model had to write
 * correctly, it needs `studio.execute`, and what it did is not visible as a
 * declarative diff. Cheap on the wire is not the same as cheap.
 */
export function routeC(): ToolCall[] {
  const { modules, moduleStuds, wallHeight, wallThickness, floorThickness, parent, material, color, doorwayModule } = ROOM;
  const code = `local root = Instance.new("Folder")
root.Name = "BenchmarkRoom"
root.Parent = workspace
local SPAN, M, H, T, F = ${modules * moduleStuds}, ${moduleStuds}, ${wallHeight}, ${wallThickness}, ${floorThickness}
local HALF, COLOR = SPAN / 2, Color3.fromRGB(${color[0]}, ${color[1]}, ${color[2]})
local function part(name, size, pos)
\tlocal p = Instance.new("Part")
\tp.Name, p.Size, p.Position = name, size, pos
\tp.Material, p.Color, p.Anchored = Enum.Material.${material}, COLOR, true
\tp.Parent = root
end
part("Floor", Vector3.new(SPAN, F, SPAN), Vector3.new(0, F / 2, 0))
local y = F + H / 2
for i = 0, ${modules - 1} do
\tlocal o = -HALF + M / 2 + i * M
\tif i ~= ${doorwayModule} then
\t\tpart(string.format("WallNorth%02d", i), Vector3.new(M, H, T), Vector3.new(o, y, -HALF))
\tend
\tpart(string.format("WallSouth%02d", i), Vector3.new(M, H, T), Vector3.new(o, y, HALF))
end
for i = 1, ${modules - 2} do
\tlocal o = -HALF + M / 2 + i * M
\tpart(string.format("WallWest%02d", i), Vector3.new(T, H, M), Vector3.new(-HALF, y, o))
\tpart(string.format("WallEast%02d", i), Vector3.new(T, H, M), Vector3.new(HALF, y, o))
end
return { built = #root:GetChildren() }`;
  return [{ tool: 'execute_luau', args: { code, undoLabel: `build ${parent}` } }];
}

export const ROUTES: Record<RouteName, () => ToolCall[]> = { A: routeA, B: routeB, C: routeC };
