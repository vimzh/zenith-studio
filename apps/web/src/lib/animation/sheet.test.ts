import { describe, expect, test } from "bun:test";
import { TRANSPARENT, createGrid, gridsEqual, parseHex, type Grid } from "@zenith/core";
import { encodeIndexedPng } from "@/lib/export";
import { pixelize, type RasterImage } from "@/lib/pixelize";
import {
  cellOrigin,
  composeSheet,
  contentBottom,
  planSheets,
  registerToBaseline,
  sheetLayouts,
  shiftRaster,
  sourceBaseline,
  splitSheet,
  type SheetLayout,
} from "./sheet";

/** IHDR width and height, so a composed sheet can be checked without a decoder for indexed PNGs. */
function pngSize(bytes: Uint8Array): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

function rasterFromGrid(grid: Grid, palette: readonly string[], scale: number): RasterImage {
  const width = grid.width * scale;
  const height = grid.height * scale;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const cell = grid.cells[Math.floor(y / scale) * grid.width + Math.floor(x / scale)] ?? TRANSPARENT;
      if (cell === TRANSPARENT) continue;
      const { r, g, b } = parseHex(palette[cell] as string);
      data.set([r, g, b, 255], (y * width + x) * 4);
    }
  }
  return { width, height, data };
}

function summary(layout: SheetLayout): [number, number, number, number, number] {
  return [layout.columns, layout.rows, layout.scale, layout.width, layout.height];
}

describe("planSheets", () => {
  test.each([
    [128, 4, [[3, 2, 4, 1536, 1024]]],
    [128, 3, [[2, 2, 4, 1024, 1024]]],
    [128, 8, [[3, 2, 4, 1536, 1024], [2, 2, 4, 1024, 1024]]],
    [128, 12, [[3, 2, 4, 1536, 1024], [3, 2, 4, 1536, 1024], [2, 2, 4, 1024, 1024]]],
    [64, 4, [[3, 2, 8, 1536, 1024]]],
    [64, 8, [[4, 4, 4, 1024, 1024]]],
    [32, 4, [[3, 2, 16, 1536, 1024]]],
    [32, 12, [[4, 4, 8, 1024, 1024]]],
    [16, 4, [[4, 4, 16, 1024, 1024]]],
  ] as const)("a %ipx asset with %i frames buys the fewest sheets at the largest cells", (size, frames, expected) => {
    expect(planSheets(size, size, frames).map(summary)).toEqual(expected.map((entry) => [...entry]));
  });

  test("the chosen sheets carry every frame and never an unnecessary one", () => {
    for (const size of [16, 32, 64, 128]) {
      for (let frames = 1; frames <= 12; frames += 1) {
        const plan = planSheets(size, size, frames);
        const capacity = plan.reduce((sum, layout) => sum + layout.capacity, 0);
        expect(capacity).toBeGreaterThanOrEqual(frames);
        expect(capacity - (plan.at(-1)?.capacity ?? 0)).toBeLessThan(frames);
      }
    }
  });

  test("an asset too large to sit beside a frame at four pixels per cell is refused for free", () => {
    expect(() => planSheets(256, 256, 2)).toThrow("No sprite-sheet layout");
    expect(() => planSheets(32, 32, 0)).toThrow("positive integer");
  });

  test("every layout's cells and gutters fit inside its canvas", () => {
    for (const size of [16, 32, 48, 64, 100, 128]) {
      for (const layout of sheetLayouts(size, size)) {
        expect(layout.scale).toBeGreaterThanOrEqual(4);
        expect(layout.columns * layout.cellWidth + (layout.columns + 1) * layout.gutterX).toBeLessThanOrEqual(layout.width / layout.scale);
        expect(layout.rows * layout.cellHeight + (layout.rows + 1) * layout.gutterY).toBeLessThanOrEqual(layout.height / layout.scale);
        const last = cellOrigin(layout, layout.columns * layout.rows - 1);
        expect((last.x + layout.cellWidth) * layout.scale).toBeLessThanOrEqual(layout.width);
        expect((last.y + layout.cellHeight) * layout.scale).toBeLessThanOrEqual(layout.height);
      }
    }
  });

  test("an asset that does not divide the canvas gets its slack as even gutters", () => {
    const layout = sheetLayouts(48, 48).find((candidate) => candidate.scale === 8 && candidate.width === 1024);
    expect(layout).toBeDefined();
    expect(layout?.columns).toBe(2);
    expect(layout?.gutterX).toBe(10);
    expect(cellOrigin(layout as SheetLayout, 0)).toEqual({ x: 10, y: 10 });
    expect(cellOrigin(layout as SheetLayout, 1)).toEqual({ x: 68, y: 10 });
    expect(cellOrigin(layout as SheetLayout, 2)).toEqual({ x: 10, y: 68 });
    expect(() => cellOrigin(layout as SheetLayout, 4)).toThrow("outside");
  });
});

describe("composeSheet", () => {
  test("places the exact source in cell 0 and leaves every other cell transparent, at the model's size", () => {
    const source = createGrid(32, 32, TRANSPARENT);
    source.cells[5 * 32 + 7] = 1;
    source.cells[31 * 32 + 31] = 2;
    const [layout] = planSheets(32, 32, 4);
    const sheet = composeSheet(source, layout as SheetLayout);
    expect(sheet.width).toBe(96);
    expect(sheet.height).toBe(64);
    expect(sheet.cells[5 * 96 + 7]).toBe(1);
    expect(sheet.cells[31 * 96 + 31]).toBe(2);
    expect(sheet.cells.filter((cell) => cell !== TRANSPARENT)).toHaveLength(2);

    const png = encodeIndexedPng(sheet, ["#000000", "#ff0000", "#00ff00"], { scale: (layout as SheetLayout).scale });
    expect(pngSize(png)).toEqual({ width: 1536, height: 1024 });
  });

  test("refuses a source that is not the layout's cell size", () => {
    const [layout] = planSheets(32, 32, 2);
    expect(() => composeSheet(createGrid(16, 16), layout as SheetLayout)).toThrow("16x16");
  });
});

describe("splitSheet", () => {
  const [layout] = planSheets(32, 32, 4) as [SheetLayout];

  function paintedSheet(width: number, height: number): RasterImage {
    const data = new Uint8ClampedArray(width * height * 4);
    const cell = 32 * layout.scale;
    for (let index = 0; index < layout.columns * layout.rows; index += 1) {
      const origin = cellOrigin(layout, index);
      const left = Math.round((origin.x * layout.scale * width) / layout.width);
      const top = Math.round((origin.y * layout.scale * height) / layout.height);
      const w = Math.round((cell * width) / layout.width);
      const h = Math.round((cell * height) / layout.height);
      for (let y = top; y < top + h; y += 1) {
        for (let x = left; x < left + w; x += 1) {
          data.set([(index + 1) * 40, 0, 0, 255], (y * width + x) * 4);
        }
      }
    }
    return { width, height, data };
  }

  test("cuts fixed windows at the layout's cell positions, reference first", () => {
    const cells = splitSheet(paintedSheet(layout.width, layout.height), layout);
    expect(cells).toHaveLength(6);
    cells.forEach((cell, index) => {
      expect(cell.width).toBe(512);
      expect(cell.height).toBe(512);
      for (let i = 0; i < cell.data.length; i += 4) {
        expect(cell.data[i]).toBe((index + 1) * 40);
        expect(cell.data[i + 3]).toBe(255);
      }
    });
  });

  test("resamples a sheet returned at another size onto the layout before cutting", () => {
    const cells = splitSheet(paintedSheet(768, 512), layout);
    cells.forEach((cell, index) => {
      expect(cell.width).toBe(512);
      const reds = new Set<number>();
      for (let i = 0; i < cell.data.length; i += 4) reds.add(cell.data[i] as number);
      expect([...reds]).toEqual([(index + 1) * 40]);
    });
  });
});

describe("registerToBaseline", () => {
  function cellWithBottom(bottom: number, size = 64): RasterImage {
    const data = new Uint8ClampedArray(size * size * 4);
    for (let y = bottom - 10; y < bottom; y += 1) {
      for (let x = 20; x < 40; x += 1) data.set([255, 255, 255, 255], (y * size + x) * 4);
    }
    return { width: size, height: size, data };
  }

  const tolerance = { down: 12, up: 5 };

  test("moves a grounded frame that drifted back onto the ground line, in either direction", () => {
    const { cells, shifts } = registerToBaseline([cellWithBottom(50), cellWithBottom(56)], 52, ["grounded", "grounded"], tolerance);
    expect(shifts).toEqual([2, -4]);
    expect(contentBottom(cells[0] as RasterImage)).toBe(52);
    expect(contentBottom(cells[1] as RasterImage)).toBe(52);
  });

  test("brings a floating grounded frame down further than it lifts a hanging one", () => {
    // A whole row drawn 12 pixels high is a defect; a blade trailing 6 below the feet may be the pose.
    const { shifts } = registerToBaseline([cellWithBottom(40), cellWithBottom(58)], 52, ["grounded", "grounded"], tolerance);
    expect(shifts).toEqual([12, 0]);
  });

  test("leaves airborne frames, large differences and empty cells alone", () => {
    const empty: RasterImage = { width: 64, height: 64, data: new Uint8ClampedArray(64 * 64 * 4) };
    const { cells, shifts } = registerToBaseline(
      [cellWithBottom(50), cellWithBottom(30), empty],
      52,
      ["airborne", "grounded", "grounded"],
      tolerance,
    );
    expect(shifts).toEqual([0, 0, 0]);
    expect(contentBottom(cells[0] as RasterImage)).toBe(50);
    expect(contentBottom(cells[1] as RasterImage)).toBe(30);
    expect(contentBottom(cells[2] as RasterImage)).toBeNull();
  });

  test("shifting fills with transparency and never wraps", () => {
    const shifted = shiftRaster(cellWithBottom(64), 0, 10);
    // All ten rows went off the bottom; none reappeared at the top.
    expect(contentBottom(shifted)).toBeNull();
    let opaque = 0;
    for (let i = 3; i < shifted.data.length; i += 4) if ((shifted.data[i] as number) > 0) opaque += 1;
    expect(opaque).toBe(0);
    expect(contentBottom(shiftRaster(cellWithBottom(64), 0, -4))).toBe(60);
    expect(shiftRaster(shifted, 0, 0)).toBe(shifted);
  });

  test("the source baseline is one past its last opaque row, in sheet pixels", () => {
    const source = createGrid(32, 32, TRANSPARENT);
    source.cells[27 * 32 + 10] = 1;
    expect(sourceBaseline(source, 16)).toBe(28 * 16);
    expect(sourceBaseline(createGrid(32, 32, TRANSPARENT), 16)).toBeNull();
  });
});

describe("a sheet round-trips through the real pixeliser", () => {
  test("each frame comes back as the grid that was drawn in its cell, with the source untouched", () => {
    const palette = ["#000000", "#ff0000", "#00ff00"];
    const [layout] = planSheets(32, 32, 4) as [SheetLayout];
    const frames = [0, 1, 2, 3].map((frame) => {
      const grid = createGrid(32, 32, TRANSPARENT);
      // A body that moves right one cell per frame, plus a frame-specific arm.
      for (let y = 8; y < 28; y += 1) for (let x = 12 + frame; x < 20 + frame; x += 1) grid.cells[y * 32 + x] = 1;
      for (let x = 20 + frame; x < 24 + frame * 2; x += 1) grid.cells[(10 + frame) * 32 + x] = 2;
      return grid;
    });
    const source = createGrid(32, 32, TRANSPARENT);
    for (let y = 8; y < 28; y += 1) for (let x = 12; x < 20; x += 1) source.cells[y * 32 + x] = 1;

    const sheet = composeSheet(source, layout);
    frames.forEach((frame, index) => {
      const origin = cellOrigin(layout, index + 1);
      for (let y = 0; y < 32; y += 1) sheet.cells.set(frame.cells.subarray(y * 32, y * 32 + 32), (origin.y + y) * sheet.width + origin.x);
    });

    const cells = splitSheet(rasterFromGrid(sheet, palette, layout.scale), layout);
    const decoded = cells.slice(1, 5).map((cell) => {
      const result = pixelize(cell, { targetWidth: 32, targetHeight: 32, maxColors: palette.length });
      const grid = createGrid(32, 32, TRANSPARENT);
      result.grid.cells.forEach((value, index) => {
        grid.cells[index] = value === TRANSPARENT ? TRANSPARENT : palette.indexOf(result.palette[value] as string);
      });
      return grid;
    });
    decoded.forEach((grid, index) => expect(gridsEqual(grid, frames[index] as Grid)).toBe(true));
    // The reference cell is what was composed, not something the pixeliser invented.
    const reference = pixelize(cells[0] as RasterImage, { targetWidth: 32, targetHeight: 32, maxColors: 3 });
    expect(reference.grid.cells.filter((cell) => cell !== TRANSPARENT)).toHaveLength(20 * 8);
  });
});
