import { TRANSPARENT, createGrid, type Cell, type Grid } from "@zenith/core";
import { maskAt, tileIndexForMask } from "./blob47";

/**
 * Maps: a grid of terrain flags resolved into a grid of tile indices, then
 * composited into one image.
 *
 * The terrain layout and the tile choice are kept separate on purpose. An
 * author edits "is this cell grass", never "which of the 47 grass tiles goes
 * here" — the second is derived, and deriving it is what makes editing a map
 * feel like painting instead of bookkeeping.
 */

export interface TerrainMap {
  readonly width: number;
  readonly height: number;
  /** True where the terrain is present. */
  readonly filled: readonly boolean[];
}

export function createTerrain(width: number, height: number, filled = false): TerrainMap {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error(
      `A map must have positive integer dimensions, received ${String(width)}x${String(height)}.`
    );
  }
  return { width, height, filled: new Array<boolean>(width * height).fill(filled) };
}

export type EdgeRule =
  /** Outside the map counts as the same terrain — edges tile as interiors. */
  | "extend"
  /** Outside the map counts as empty — the terrain visibly ends at the border. */
  | "clip";

/**
 * Resolves each filled cell to a tile index.
 *
 * Empty cells are `null` rather than a tile index, so a caller can leave them
 * transparent instead of guessing at a background tile.
 */
export function resolveTileIndices(
  terrain: TerrainMap,
  edges: EdgeRule = "clip"
): (number | null)[] {
  const inside = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < terrain.width && y < terrain.height;

  const isSame = (x: number, y: number): boolean => {
    if (!inside(x, y)) {
      return edges === "extend";
    }
    return terrain.filled[y * terrain.width + x] === true;
  };

  const out: (number | null)[] = new Array<number | null>(terrain.width * terrain.height).fill(null);

  for (let y = 0; y < terrain.height; y += 1) {
    for (let x = 0; x < terrain.width; x += 1) {
      if (terrain.filled[y * terrain.width + x] !== true) {
        continue;
      }
      out[y * terrain.width + x] = tileIndexForMask(maskAt(x, y, isSame));
    }
  }

  return out;
}

/** Draws a resolved map into one grid. Empty cells stay transparent. */
export function assembleMap(
  terrain: TerrainMap,
  tiles: readonly Grid[],
  edges: EdgeRule = "clip"
): Grid {
  if (tiles.length === 0) {
    throw new Error("Assembling a map needs a tileset with at least one tile.");
  }

  const tileSize = (tiles[0] as Grid).width;
  for (const tile of tiles) {
    if (tile.width !== tileSize || tile.height !== tileSize) {
      throw new Error(
        `Every tile must be square and the same size. Expected ${String(tileSize)}x${String(tileSize)}, found ${String(tile.width)}x${String(tile.height)}.`
      );
    }
  }

  const indices = resolveTileIndices(terrain, edges);
  const map = createGrid(terrain.width * tileSize, terrain.height * tileSize, TRANSPARENT);

  for (let cellY = 0; cellY < terrain.height; cellY += 1) {
    for (let cellX = 0; cellX < terrain.width; cellX += 1) {
      const index = indices[cellY * terrain.width + cellX];
      if (index === null || index === undefined) {
        continue;
      }

      const tile = tiles[index];
      if (tile === undefined) {
        throw new Error(
          `Tile index ${String(index)} is outside the tileset, which has ${String(tiles.length)} tiles. A blob set needs all 47.`
        );
      }

      for (let y = 0; y < tileSize; y += 1) {
        for (let x = 0; x < tileSize; x += 1) {
          map.cells[(cellY * tileSize + y) * map.width + cellX * tileSize + x] = (tile.cells[
            y * tileSize + x
          ] ?? TRANSPARENT) as Cell;
        }
      }
    }
  }

  return map;
}

export type Side = "north" | "south" | "east" | "west";

/**
 * Grows a map, preserving what is already there.
 *
 * New cells default to empty rather than copying the border: extending a map
 * should add room to draw in, not silently invent terrain the author did not
 * place.
 */
export function extendMap(terrain: TerrainMap, side: Side, cells: number): TerrainMap {
  if (!Number.isInteger(cells) || cells < 1) {
    throw new Error(`Extension must be a positive integer number of cells, received ${String(cells)}.`);
  }

  const width = side === "east" || side === "west" ? terrain.width + cells : terrain.width;
  const height = side === "north" || side === "south" ? terrain.height + cells : terrain.height;
  const offsetX = side === "west" ? cells : 0;
  const offsetY = side === "north" ? cells : 0;

  const filled = new Array<boolean>(width * height).fill(false);
  for (let y = 0; y < terrain.height; y += 1) {
    for (let x = 0; x < terrain.width; x += 1) {
      filled[(y + offsetY) * width + (x + offsetX)] = terrain.filled[y * terrain.width + x] === true;
    }
  }

  return { width, height, filled };
}
