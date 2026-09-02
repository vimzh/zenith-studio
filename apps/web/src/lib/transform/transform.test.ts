import { describe, expect, test } from "bun:test";
import { TRANSPARENT, createGrid, encodeGrid, gridFromRows } from "@zenith/core";
import {
  checkReadability,
  findColorRegions,
  resizeCanvas,
  rotateGrid,
  sortPalette,
} from "./transform";

describe("rotateGrid", () => {
  test("90 degrees swaps the axes", () => {
    const grid = gridFromRows(["012", "345"]);
    const turned = rotateGrid(grid, 90);
    expect(turned.width).toBe(2);
    expect(turned.height).toBe(3);
    expect(encodeGrid(turned)).toBe("30\n41\n52");
  });

  test("180 degrees keeps the shape and reverses both axes", () => {
    const grid = gridFromRows(["012", "345"]);
    expect(encodeGrid(rotateGrid(grid, 180))).toBe("543\n210");
  });

  test("270 is the inverse of 90", () => {
    const grid = gridFromRows(["012", "345"]);
    expect(encodeGrid(rotateGrid(rotateGrid(grid, 90), 270))).toBe(encodeGrid(grid));
  });

  test("four 90-degree turns return the original", () => {
    const grid = gridFromRows(["01.3", "4567"]);
    let turned = grid;
    for (let n = 0; n < 4; n += 1) {
      turned = rotateGrid(turned, 90);
    }
    expect(encodeGrid(turned)).toBe(encodeGrid(grid));
  });

  test("preserves transparency", () => {
    expect(encodeGrid(rotateGrid(gridFromRows(["0."]), 180))).toBe(".0");
  });
});

describe("resizeCanvas", () => {
  test("grows with transparency rather than stretching the art", () => {
    const grid = gridFromRows(["01", "23"]);
    expect(encodeGrid(resizeCanvas(grid, 4, 4, "top-left"))).toBe("01..\n23..\n....\n....");
  });

  test("centres by default", () => {
    const grid = gridFromRows(["0"]);
    expect(encodeGrid(resizeCanvas(grid, 3, 3))).toBe("...\n.0.\n...");
  });

  test("anchors to a corner when asked", () => {
    const grid = gridFromRows(["0"]);
    expect(encodeGrid(resizeCanvas(grid, 3, 3, "bottom-right"))).toBe("...\n...\n..0");
  });

  test("shrinking clips rather than scaling", () => {
    const grid = gridFromRows(["0123", "4567", "89AB", "CDEF"]);
    expect(encodeGrid(resizeCanvas(grid, 2, 2, "top-left"))).toBe("01\n45");
  });

  test("rejects non-positive dimensions", () => {
    expect(() => resizeCanvas(gridFromRows(["0"]), 0, 4)).toThrow(/positive integers/);
  });
});

describe("findColorRegions", () => {
  test("finds separate runs of one index", () => {
    const grid = gridFromRows(["0.0", "...", "0.."]);
    const regions = findColorRegions(grid, 0);
    expect(regions).toHaveLength(3);
  });

  test("joins 4-connected pixels into one region with its bounds", () => {
    const grid = gridFromRows(["00.", "00.", "..."]);
    const regions = findColorRegions(grid, 0);
    expect(regions).toHaveLength(1);
    expect(regions[0]).toEqual({ index: 0, x: 0, y: 0, width: 2, height: 2, count: 4 });
  });

  test("diagonal-only contact is two regions, not one", () => {
    const grid = gridFromRows(["0.", ".0"]);
    expect(findColorRegions(grid, 0)).toHaveLength(2);
  });

  test("an absent index yields no regions", () => {
    expect(findColorRegions(gridFromRows(["00"]), 5)).toEqual([]);
  });

  test("handles a fully filled grid without stack overflow", () => {
    const big = createGrid(64, 64, 0);
    const regions = findColorRegions(big, 0);
    expect(regions).toHaveLength(1);
    expect(regions[0]?.count).toBe(4096);
  });
});

describe("checkReadability", () => {
  test("flags a subject too small to see", () => {
    const grid = createGrid(32, 32, TRANSPARENT);
    grid.cells[0] = 0;
    const report = checkReadability(grid);
    expect(report.coverage).toBeLessThan(0.08);
    expect(report.problems.some((p) => p.includes("reads as empty"))).toBe(true);
  });

  test("flags too many colours to read as shapes", () => {
    const grid = createGrid(8, 8, 0);
    for (let i = 0; i < 16; i += 1) {
      grid.cells[i] = i as never;
    }
    const report = checkReadability(grid);
    expect(report.colorsUsed).toBeGreaterThan(12);
    expect(report.problems.some((p) => p.includes("colours in one sprite"))).toBe(true);
  });

  test("counts isolated pixels that vanish against a background", () => {
    const grid = createGrid(16, 16, TRANSPARENT);
    for (let i = 0; i < 20; i += 1) {
      grid.cells[i * 13] = 0;
    }
    expect(checkReadability(grid).isolatedPixels).toBeGreaterThan(0);
  });

  test("a solid well-formed sprite reports no problems", () => {
    const grid = createGrid(16, 16, 0);
    for (let i = 0; i < grid.cells.length; i += 1) {
      grid.cells[i] = (i % 4) as never;
    }
    expect(checkReadability(grid).problems).toEqual([]);
  });

  test("an empty grid does not divide by zero", () => {
    const report = checkReadability(createGrid(8, 8, TRANSPARENT));
    expect(report.coverage).toBe(0);
    expect(Number.isFinite(report.coverage)).toBe(true);
  });
});

describe("sortPalette", () => {
  test("orders by luminance and rewrites indices so nothing changes visually", () => {
    const grid = gridFromRows(["012"]);
    const palette = ["#ffffff", "#000000", "#808080"];
    const sorted = sortPalette(grid, palette, "luminance");

    expect(sorted.palette).toEqual(["#000000", "#808080", "#ffffff"]);
    // Index 0 was white, now index 2; the pixel must follow it.
    expect(encodeGrid(sorted.grid)).toBe("201");
  });

  test("preserves transparency", () => {
    const sorted = sortPalette(gridFromRows(["0.1"]), ["#ffffff", "#000000"], "luminance");
    expect(encodeGrid(sorted.grid)).toBe("1.0");
  });

  test("puts greys before hues when sorting by hue", () => {
    const sorted = sortPalette(gridFromRows(["012"]), ["#ff0000", "#808080", "#00ff00"], "hue");
    expect(sorted.palette[0]).toBe("#808080");
  });

  test("is stable for equal scores", () => {
    const palette = ["#010101", "#010101", "#000000"];
    const sorted = sortPalette(gridFromRows(["012"]), palette, "luminance");
    expect(sorted.palette).toEqual(["#000000", "#010101", "#010101"]);
  });
});
