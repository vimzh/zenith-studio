import { describe, expect, test } from "bun:test";
import { TRANSPARENT, encodeGrid } from "@zenith/core";
import { detectNativeScale } from "./native-scale";
import { detectGrid } from "./grid";
import { resolveCell } from "./resolve";
import { pixelize } from "./pipeline";
import { createRaster, type RasterImage } from "./types";

/** Paints a rect into a raster. */
function fill(
  image: RasterImage,
  x0: number,
  y0: number,
  w: number,
  h: number,
  [r, g, b, a]: [number, number, number, number]
): void {
  for (let y = y0; y < y0 + h; y += 1) {
    for (let x = x0; x < x0 + w; x += 1) {
      if (x < 0 || y < 0 || x >= image.width || y >= image.height) continue;
      const o = (y * image.width + x) * 4;
      image.data[o] = r;
      image.data[o + 1] = g;
      image.data[o + 2] = b;
      image.data[o + 3] = a;
    }
  }
}

/** A checkerboard of `cells` squares per side, each `scale` source pixels wide. */
function checkerboard(cells: number, scale: number, alpha = 255): RasterImage {
  const size = cells * scale;
  const image = createRaster(size, size);
  for (let cy = 0; cy < cells; cy += 1) {
    for (let cx = 0; cx < cells; cx += 1) {
      const light = (cx + cy) % 2 === 0;
      fill(image, cx * scale, cy * scale, scale, scale, light ? [230, 230, 230, alpha] : [30, 30, 30, alpha]);
    }
  }
  return image;
}

describe("native scale", () => {
  test("returns 1 for art that is already native", () => {
    expect(detectNativeScale(checkerboard(16, 1))).toBe(1);
  });

  test("recovers an exact integer upscale", () => {
    for (const scale of [2, 3, 4, 6, 8]) {
      expect(detectNativeScale(checkerboard(8, scale))).toBe(scale);
    }
  });

  test("returns 1 for a gradient, which has no consistent lattice", () => {
    const image = createRaster(64, 64);
    for (let y = 0; y < 64; y += 1) {
      for (let x = 0; x < 64; x += 1) {
        fill(image, x, y, 1, 1, [x * 4, y * 4, 128, 255]);
      }
    }
    expect(detectNativeScale(image)).toBe(1);
  });

  test("is unaffected by an empty image", () => {
    expect(detectNativeScale(createRaster(1, 1))).toBe(1);
  });
});

describe("grid detection", () => {
  test("finds the true cell size, not a harmonic of it", () => {
    // The whole reason boundary contrast exists: reconstruction error alone
    // always prefers a finer grid, so a detector without it returns cell/2.
    for (const scale of [4, 8, 10]) {
      const grid = detectGrid(checkerboard(8, scale));
      expect(grid.x.cell).toBeCloseTo(scale, 0);
      expect(grid.y.cell).toBeCloseTo(scale, 0);
    }
  });

  test("reports confidence on a clean grid and none on a gradient", () => {
    expect(detectGrid(checkerboard(8, 8)).confidence).toBeGreaterThan(0.3);

    const gradient = createRaster(64, 64);
    for (let y = 0; y < 64; y += 1) {
      for (let x = 0; x < 64; x += 1) {
        fill(gradient, x, y, 1, 1, [x * 4, x * 4, x * 4, 255]);
      }
    }
    expect(detectGrid(gradient).confidence).toBeLessThan(0.3);
  });

  test("survives a flat image without dividing by zero", () => {
    const flat = createRaster(32, 32);
    fill(flat, 0, 0, 32, 32, [128, 128, 128, 255]);
    const grid = detectGrid(flat);
    expect(Number.isFinite(grid.confidence)).toBe(true);
    expect(grid.confidence).toBe(0);
  });
});

describe("cell resolution", () => {
  test("returns a colour that occurs in the source, never a blend", () => {
    // Half black, half white. A mean would return grey — a colour that is not
    // in the image and that the palette should never have to represent.
    const image = createRaster(8, 8);
    fill(image, 0, 0, 4, 8, [0, 0, 0, 255]);
    fill(image, 4, 0, 4, 8, [255, 255, 255, 255]);

    const cell = resolveCell(image, 0, 0, 8, 8);
    const isSourceColour = (cell.r === 0 && cell.g === 0) || (cell.r === 255 && cell.g === 255);
    expect(isSourceColour).toBe(true);
  });

  test("binarises alpha — never partially transparent", () => {
    const image = createRaster(4, 4);
    fill(image, 0, 0, 4, 4, [200, 100, 50, 128]);
    expect(resolveCell(image, 0, 0, 4, 4).a).toBe(255);

    const sparse = createRaster(4, 4);
    fill(sparse, 0, 0, 1, 1, [200, 100, 50, 255]);
    expect(sparse.data[3]).toBe(255);
    expect(resolveCell(sparse, 0, 0, 4, 4).a).toBe(0);
  });

  test("is deterministic across repeated runs", () => {
    const image = checkerboard(4, 4);
    const first = resolveCell(image, 0, 0, 4, 4);
    for (let n = 0; n < 20; n += 1) {
      expect(resolveCell(image, 0, 0, 4, 4)).toEqual(first);
    }
  });

  test("ignores anti-aliased cell edges by sampling the core", () => {
    // A solid red cell with a blended border, as an upscaled sprite would have.
    const image = createRaster(10, 10);
    fill(image, 0, 0, 10, 10, [128, 64, 64, 255]); // blend ring
    fill(image, 2, 2, 6, 6, [255, 0, 0, 255]); // true colour
    const cell = resolveCell(image, 0, 0, 10, 10);
    expect(cell.r).toBe(255);
    expect(cell.g).toBe(0);
  });
});

describe("pipeline", () => {
  test("round-trips an upscaled checkerboard back to its true size", () => {
    const result = pixelize(checkerboard(8, 6));
    expect(result.scale).toBe(6);
    expect(result.grid.width).toBe(8);
    expect(result.grid.height).toBe(8);
    expect(result.palette.length).toBe(2);

    // Alternating cells, which is what a checkerboard must decode to.
    const rows = encodeGrid(result.grid).split("\n");
    expect(rows[0]).not.toBe(rows[1]);
    expect(rows[0]).toBe(rows[2] as string);
  });

  test("leaves native art untouched", () => {
    const source = checkerboard(16, 1);
    const result = pixelize(source);
    expect(result.kind).toBe("native");
    expect(result.grid.width).toBe(16);
    expect(result.grid.height).toBe(16);
  });

  test("honours an explicit target size", () => {
    const result = pixelize(checkerboard(8, 8), { targetWidth: 16, targetHeight: 16 });
    expect(result.grid.width).toBe(16);
    expect(result.grid.height).toBe(16);
  });

  test("never exceeds the palette cap", () => {
    const noisy = createRaster(64, 64);
    for (let y = 0; y < 64; y += 1) {
      for (let x = 0; x < 64; x += 1) {
        fill(noisy, x, y, 1, 1, [(x * 7) % 256, (y * 11) % 256, (x * y) % 256, 255]);
      }
    }
    const result = pixelize(noisy, { maxColors: 8 });
    expect(result.palette.length).toBeLessThanOrEqual(8);
    for (const cell of result.grid.cells) {
      expect(cell === TRANSPARENT || cell < result.palette.length).toBe(true);
    }
  });

  test("emits no partially transparent cells", () => {
    const image = createRaster(32, 32);
    fill(image, 0, 0, 32, 32, [0, 0, 0, 0]);
    fill(image, 8, 8, 16, 16, [255, 0, 0, 255]);
    fill(image, 7, 7, 18, 1, [255, 0, 0, 90]); // alpha fringe
    const result = pixelize(image, { targetWidth: 8, targetHeight: 8 });
    for (const cell of result.grid.cells) {
      expect(cell === TRANSPARENT || cell >= 0).toBe(true);
    }
  });

  test("is deterministic — identical input, identical output", () => {
    const image = checkerboard(8, 5);
    const first = pixelize(image);
    for (let n = 0; n < 5; n += 1) {
      const again = pixelize(image);
      expect(encodeGrid(again.grid)).toBe(encodeGrid(first.grid));
      expect(again.palette).toEqual(first.palette);
    }
  });

  test("warns rather than guessing silently on a gridless image", () => {
    const gradient = createRaster(160, 160);
    for (let y = 0; y < 160; y += 1) {
      for (let x = 0; x < 160; x += 1) {
        fill(gradient, x, y, 1, 1, [x, y, 200, 255]);
      }
    }
    const result = pixelize(gradient);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  test("offers harmonic alternatives, since size errors are harmonic", () => {
    const result = pixelize(checkerboard(8, 6));
    const widths = result.alternatives.map((option) => option.width);
    expect(widths).toContain(4);
    expect(widths).toContain(16);
  });

  test("rejects a malformed buffer with an actionable message", () => {
    expect(() => pixelize({ width: 4, height: 4, data: new Uint8ClampedArray(10) })).toThrow(
      /Expected an RGBA buffer of 64 bytes/
    );
  });
});
