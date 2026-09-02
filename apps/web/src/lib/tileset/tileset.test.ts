import { describe, expect, test } from "bun:test";
import { TRANSPARENT, createGrid, encodeGrid, gridFromRows } from "@zenith/core";
import {
  BLOB47_MASKS,
  EAST,
  NORTH,
  NORTH_EAST,
  SOUTH,
  WEST,
  maskAt,
  normalizeMask,
  quadrantKind,
  tileIndexForMask,
} from "./blob47";
import { composeTile, deriveBlobTileset, deriveQuadrants } from "./derive";
import { assembleMap, createTerrain, extendMap, resolveTileIndices } from "./map";

describe("blob47 normalisation", () => {
  test("collapses 256 configurations to exactly 47 tiles", () => {
    // The claim the whole phase rests on.
    expect(BLOB47_MASKS).toHaveLength(47);
  });

  test("a corner is invisible unless both its cardinals are set", () => {
    // NE alone changes nothing you can see, so it must normalise away.
    expect(normalizeMask(NORTH_EAST)).toBe(0);
    expect(normalizeMask(NORTH | NORTH_EAST)).toBe(NORTH);
    expect(normalizeMask(NORTH | EAST | NORTH_EAST)).toBe(NORTH | EAST | NORTH_EAST);
  });

  test("normalisation is idempotent", () => {
    for (let mask = 0; mask < 256; mask += 1) {
      expect(normalizeMask(normalizeMask(mask))).toBe(normalizeMask(mask));
    }
  });

  test("every one of the 256 configurations maps to a tile in range", () => {
    for (let mask = 0; mask < 256; mask += 1) {
      const index = tileIndexForMask(mask);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(47);
    }
  });

  test("masks that look identical share a tile", () => {
    expect(tileIndexForMask(NORTH_EAST)).toBe(tileIndexForMask(0));
    expect(tileIndexForMask(NORTH | NORTH_EAST)).toBe(tileIndexForMask(NORTH));
  });

  test("every tile is reachable — no orphan entries", () => {
    const reached = new Set<number>();
    for (let mask = 0; mask < 256; mask += 1) {
      reached.add(tileIndexForMask(mask));
    }
    expect(reached.size).toBe(47);
  });

  test("isolated and fully surrounded are distinct tiles", () => {
    expect(tileIndexForMask(0)).not.toBe(tileIndexForMask(0xff));
  });
});

describe("quadrantKind", () => {
  test("names the five outcomes", () => {
    expect(quadrantKind(0, "nw")).toBe("outer-corner");
    expect(quadrantKind(WEST, "nw")).toBe("edge-horizontal");
    expect(quadrantKind(NORTH, "nw")).toBe("edge-vertical");
    expect(quadrantKind(NORTH | WEST, "nw")).toBe("inner-corner");
    expect(quadrantKind(NORTH | WEST | 128, "nw")).toBe("fill");
  });

  test("a fully surrounded tile is fill on every corner", () => {
    for (const corner of ["nw", "ne", "se", "sw"] as const) {
      expect(quadrantKind(0xff, corner)).toBe("fill");
    }
  });

  test("an isolated tile is an outer corner on every corner", () => {
    for (const corner of ["nw", "ne", "se", "sw"] as const) {
      expect(quadrantKind(0, corner)).toBe("outer-corner");
    }
  });
});

describe("maskAt", () => {
  test("reads all eight neighbours", () => {
    const mask = maskAt(1, 1, () => true);
    expect(mask).toBe(0xff);
  });

  test("reads none when isolated", () => {
    expect(maskAt(1, 1, () => false)).toBe(0);
  });

  test("places each cardinal in the right bit", () => {
    expect(maskAt(1, 1, (x, y) => x === 1 && y === 0)).toBe(NORTH);
    expect(maskAt(1, 1, (x, y) => x === 2 && y === 1)).toBe(EAST);
    expect(maskAt(1, 1, (x, y) => x === 1 && y === 2)).toBe(SOUTH);
    expect(maskAt(1, 1, (x, y) => x === 0 && y === 1)).toBe(WEST);
  });
});

describe("deriving a tileset by composition", () => {
  const base = () => gridFromRows(["0011", "0011", "2233", "2233"]);

  test("produces all 47 tiles from one base, with no model", () => {
    const set = deriveBlobTileset(base());
    expect(set.tiles).toHaveLength(47);
    expect(set.masks).toHaveLength(47);
  });

  test("every tile is the base's size", () => {
    for (const tile of deriveBlobTileset(base()).tiles) {
      expect(tile.width).toBe(4);
      expect(tile.height).toBe(4);
    }
  });

  test("all 47 share one interior texture, which is why their edges meet", () => {
    // Independently generating 47 tiles is exactly what this avoids.
    const set = deriveBlobTileset(base());
    const fill = set.tiles[tileIndexForMask(0xff)] as never;
    expect(encodeGrid(fill)).toBe(encodeGrid(composeTile(set.quadrants, 0xff)));
  });

  test("an edge treatment marks exposed sides and leaves the interior alone", () => {
    const withEdge = deriveBlobTileset(base(), { edgeIndex: 9 });
    const isolated = withEdge.tiles[tileIndexForMask(0)] as never;
    const surrounded = withEdge.tiles[tileIndexForMask(0xff)] as never;

    expect(encodeGrid(isolated)).toContain("9");
    expect(encodeGrid(surrounded)).not.toContain("9");
  });

  test("rejects a non-square base", () => {
    expect(() => deriveQuadrants(createGrid(4, 8))).toThrow(/must be square/);
  });

  test("rejects an odd base that cannot split into quadrants", () => {
    expect(() => deriveQuadrants(createGrid(5, 5))).toThrow(/even size/);
  });

  test("is deterministic", () => {
    const first = deriveBlobTileset(base(), { edgeIndex: 9 }).tiles.map(encodeGrid).join("|");
    for (let n = 0; n < 3; n += 1) {
      expect(deriveBlobTileset(base(), { edgeIndex: 9 }).tiles.map(encodeGrid).join("|")).toBe(first);
    }
  });
});

describe("map assembly", () => {
  const tiles = () => deriveBlobTileset(gridFromRows(["0011", "0011", "2233", "2233"])).tiles;

  test("empty cells stay transparent rather than getting a background tile", () => {
    const terrain = createTerrain(2, 1, false);
    const map = assembleMap(terrain, tiles());
    for (const cell of map.cells) {
      expect(cell).toBe(TRANSPARENT);
    }
  });

  test("resolves interior cells differently from edge cells", () => {
    const terrain = createTerrain(3, 3, true);
    const indices = resolveTileIndices(terrain, "clip");
    expect(indices[4]).not.toBe(indices[0]); // centre vs corner
  });

  test("'extend' makes the border tile as interior, 'clip' does not", () => {
    const terrain = createTerrain(3, 3, true);
    const clipped = resolveTileIndices(terrain, "clip");
    const extended = resolveTileIndices(terrain, "extend");
    expect(extended[0]).not.toBe(clipped[0]);
    expect(extended[0]).toBe(extended[4] as number);
  });

  test("map dimensions are cells times tile size", () => {
    const map = assembleMap(createTerrain(3, 2, true), tiles());
    expect(map.width).toBe(12);
    expect(map.height).toBe(8);
  });

  test("refuses a tileset whose tiles disagree on size", () => {
    expect(() => assembleMap(createTerrain(1, 1, true), [createGrid(4, 4), createGrid(8, 8)])).toThrow(
      /same size/
    );
  });

  test("refuses an empty tileset", () => {
    expect(() => assembleMap(createTerrain(1, 1, true), [])).toThrow(/at least one tile/);
  });

  test("a one-tile set is enough for an isolated cell, which resolves to index 0", () => {
    // Not an error: mask 0 is tile 0, and a lone cell has no neighbours.
    expect(() => assembleMap(createTerrain(1, 1, true), [createGrid(4, 4)])).not.toThrow();
  });

  test("reports an out-of-range tile index rather than drawing nothing", () => {
    // A surrounded cell needs a high tile index, so a partial set is caught.
    expect(() => assembleMap(createTerrain(3, 3, true), [createGrid(4, 4)])).toThrow(
      /needs all 47/
    );
  });

  test("rejects non-positive dimensions", () => {
    expect(() => createTerrain(0, 4)).toThrow(/positive integer/);
  });
});

describe("extendMap", () => {
  test("preserves existing terrain when growing east", () => {
    const terrain = createTerrain(2, 2, true);
    const grown = extendMap(terrain, "east", 2);
    expect(grown.width).toBe(4);
    expect(grown.filled.slice(0, 2)).toEqual([true, true]);
    expect(grown.filled.slice(2, 4)).toEqual([false, false]);
  });

  test("offsets existing terrain when growing west", () => {
    const terrain = createTerrain(2, 1, true);
    const grown = extendMap(terrain, "west", 2);
    expect(grown.filled).toEqual([false, false, true, true]);
  });

  test("offsets when growing north", () => {
    const terrain = createTerrain(1, 1, true);
    const grown = extendMap(terrain, "north", 1);
    expect(grown.height).toBe(2);
    expect(grown.filled).toEqual([false, true]);
  });

  test("new cells are empty, not copies of the border", () => {
    const grown = extendMap(createTerrain(2, 2, true), "south", 1);
    expect(grown.filled.slice(4)).toEqual([false, false]);
  });

  test("rejects a non-positive extension", () => {
    expect(() => extendMap(createTerrain(2, 2), "east", 0)).toThrow(/positive integer/);
  });
});
