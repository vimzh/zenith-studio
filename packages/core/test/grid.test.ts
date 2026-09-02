import { describe, expect, test } from "bun:test";
import {
  createGrid,
  cropGrid,
  decodeGrid,
  encodeGrid,
  getCell,
  gridFromRows,
  gridsEqual,
  peekCell,
  scaleGrid,
  silhouette,
  TRANSPARENT,
} from "../src/index";
import { createRandom, randomInt } from "./random";

/** Exit criterion: grid -> text -> grid is byte-identical across 1000 random documents. */
describe("indexed grid text codec", () => {
  test("round-trips 1000 random documents byte-identically", () => {
    const random = createRandom(0x9e3779b9);

    for (let sample = 0; sample < 1000; sample += 1) {
      const width = randomInt(random, 1, 64);
      const height = randomInt(random, 1, 64);
      const paletteSize = randomInt(random, 1, 16);
      const grid = createGrid(width, height);
      for (let i = 0; i < grid.cells.length; i += 1) {
        grid.cells[i] = random() < 0.25 ? TRANSPARENT : randomInt(random, 0, paletteSize - 1);
      }

      const text = encodeGrid(grid);
      const decoded = decodeGrid(text);

      expect(decoded.width).toBe(width);
      expect(decoded.height).toBe(height);
      expect(Buffer.from(decoded.cells.buffer, decoded.cells.byteOffset, decoded.cells.byteLength)).toEqual(
        Buffer.from(grid.cells.buffer, grid.cells.byteOffset, grid.cells.byteLength),
      );
      expect(encodeGrid(decoded)).toBe(text);
    }
  });

  test("uses one uppercase hex character per cell and '.' for transparent", () => {
    const grid = createGrid(4, 2, TRANSPARENT);
    grid.cells[0] = 0;
    grid.cells[1] = 10;
    grid.cells[2] = 15;
    grid.cells[5] = 3;
    expect(encodeGrid(grid)).toBe("0AF.\n.3..");
  });

  test("accepts lowercase hex and a trailing newline on input", () => {
    expect(encodeGrid(decodeGrid("0af.\n.3..\n"))).toBe("0AF.\n.3..");
  });

  test("normalises CRLF line endings", () => {
    expect(encodeGrid(decodeGrid("01\r\n23"))).toBe("01\n23");
  });

  test("crops a sub-grid in asset-local coordinates", () => {
    const grid = decodeGrid("0123\n4567\n89AB\nCDEF");
    expect(encodeGrid(cropGrid(grid, { x: 1, y: 1, width: 2, height: 2 }))).toBe("56\n9A");
  });

  test("silhouette reports opacity only", () => {
    expect(silhouette(decodeGrid("0.1.\n..23"))).toBe("1010\n0011");
  });

  test("gridsEqual compares dimensions and cells", () => {
    expect(gridsEqual(decodeGrid("01\n23"), decodeGrid("01\n23"))).toBe(true);
    expect(gridsEqual(decodeGrid("01\n23"), decodeGrid("01\n24"))).toBe(false);
    expect(gridsEqual(decodeGrid("01"), decodeGrid("01\n23"))).toBe(false);
  });

  test("integer scale duplicates each cell exactly", () => {
    expect(encodeGrid(scaleGrid(decodeGrid("01\n23"), 2))).toBe("0011\n0011\n2233\n2233");
  });
});

describe("peekCell", () => {
  test("matches getCell inside the grid", () => {
    const grid = gridFromRows(["01", "23"]);
    for (let y = 0; y < grid.height; y += 1) {
      for (let x = 0; x < grid.width; x += 1) {
        expect(peekCell(grid, x, y)).toBe(getCell(grid, x, y));
      }
    }
  });

  test("returns transparent outside the grid, where getCell throws", () => {
    const grid = gridFromRows(["01", "23"]);
    expect(peekCell(grid, -1, 0)).toBe(TRANSPARENT);
    expect(peekCell(grid, 0, -1)).toBe(TRANSPARENT);
    expect(peekCell(grid, 2, 0)).toBe(TRANSPARENT);
    expect(peekCell(grid, 0, 2)).toBe(TRANSPARENT);
    expect(() => getCell(grid, 2, 0)).toThrow();
  });
});
