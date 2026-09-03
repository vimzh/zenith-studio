import { describe, expect, test } from "bun:test";
import { clearBackground, fitSubject, frameSubject, frameToCanvas, subjectBounds } from "./subject";
import { pixelize } from "./index";
import { animateProcedural } from "@/lib/animation/procedural";
import type { RasterImage } from "./types";

/**
 * Framing a generated image before pixelisation.
 *
 * The numbers here come from a real 1024x1024 generation of "a small knight in
 * blue armour holding a sword": opaque background, no alpha channel, subject
 * covering 484x702 of the frame. That image pixelised to a muddy sprite because
 * more than half the grid went to background.
 */

function image(
  width: number,
  height: number,
  paint: (x: number, y: number) => [number, number, number, number]
): RasterImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a] = paint(x, y);
      const offset = (y * width + x) * 4;
      data[offset] = r;
      data[offset + 1] = g;
      data[offset + 2] = b;
      data[offset + 3] = a;
    }
  }
  return { width, height, data };
}

/** A subject on an opaque background, positioned like a generated sprite. */
function sprite(): RasterImage {
  return image(100, 100, (x, y) =>
    x >= 30 && x < 60 && y >= 20 && y < 80 ? [200, 40, 40, 255] : [63, 104, 251, 255]
  );
}

test("128px generated characters retain room for a two-pixel idle bob", () => {
  const framed = frameToCanvas(sprite(), 128, 128, { padding: 4 });
  const result = pixelize(framed!.image, { targetWidth: 128, targetHeight: 128, maxColors: 16 });
  const count = (cells: Iterable<number>) => [...cells].filter(c => c >= 0).length;
  const frames = animateProcedural(result.grid, "bob", { frames: 4, amplitude: 2 });
  expect(count(result.grid.cells)).toBeGreaterThan(0);
  for (const frame of frames) expect(count(frame.cells)).toBe(count(result.grid.cells));
  expect(frames[2]!.cells).not.toEqual(frames[0]!.cells);
});

test("padding also applies to tightly framed sprites and rejects invalid margins", () => {
  const tight = image(100, 100, (x, y) => x === 0 && y === 0 ? [0, 0, 0, 0] : [200, 40, 40, 255]);
  expect(frameToCanvas(tight, 128, 128)).toBeNull();
  const framed = frameToCanvas(tight, 128, 128, { padding: 4 })!;
  expect(framed).not.toBeNull();
  expect(subjectBounds(framed.image)).toEqual({ x: 4, y: 4, width: 120, height: 120 });
  for (const padding of [-1, 0.5, 64, NaN]) {
    expect(() => frameToCanvas(tight, 128, 128, { padding })).toThrow("Sprite padding");
  }
});

describe("clearBackground", () => {
  test("makes a flat opaque background transparent", () => {
    const cleared = clearBackground(sprite());
    expect(cleared.data[3]).toBe(0); // corner
    expect(cleared.data[(50 * 100 + 40) * 4 + 3]).toBe(255); // subject
  });

  /**
   * The knight's armour was within ~40 RGB of its blue background. A global
   * "near the background colour" test punched holes through the subject;
   * connectivity from the border is what distinguishes the background from
   * pixels that merely resemble it.
   */
  test("keeps subject pixels that resemble the background", () => {
    const near = image(60, 60, (x, y) => {
      if (x >= 20 && x < 40 && y >= 20 && y < 40) return [70, 110, 250, 255]; // ~ background
      return [63, 104, 251, 255];
    });
    const cleared = clearBackground(near, 4);
    expect(cleared.data[(30 * 60 + 30) * 4 + 3]).toBe(255);
  });

  test("leaves an image that already has alpha alone", () => {
    const withAlpha = image(20, 20, (x, y) => (x > 10 && y > 10 ? [10, 10, 10, 255] : [0, 0, 0, 0]));
    const cleared = clearBackground(withAlpha);
    expect(cleared.data[(15 * 20 + 15) * 4 + 3]).toBe(255);
    expect(cleared.data[3]).toBe(0);
  });
});

describe("subjectBounds", () => {
  test("finds the opaque box", () => {
    expect(subjectBounds(clearBackground(sprite()))).toEqual({ x: 30, y: 20, width: 30, height: 60 });
  });

  test("returns null when nothing is opaque", () => {
    expect(subjectBounds(image(8, 8, () => [0, 0, 0, 0]))).toBeNull();
  });
});

describe("fitSubject", () => {
  test("preserves aspect ratio rather than stretching", () => {
    const cleared = clearBackground(sprite());
    const bounds = subjectBounds(cleared);
    if (bounds === null) throw new Error("no subject");

    const fitted = fitSubject(cleared, 32, 32, bounds);
    // 30x60 into 32x32 fits by height: 16x32, not a stretched 32x32.
    const columns = new Set<number>();
    for (let y = 0; y < 32; y += 1) {
      for (let x = 0; x < 32; x += 1) {
        if ((fitted.data[(y * 32 + x) * 4 + 3] ?? 0) > 8) columns.add(x);
      }
    }
    expect(columns.size).toBe(16);
  });

  test("sits the subject on the bottom edge", () => {
    const cleared = clearBackground(sprite());
    const bounds = subjectBounds(cleared);
    if (bounds === null) throw new Error("no subject");

    const fitted = fitSubject(cleared, 40, 40, bounds);
    const opaqueAt = (y: number): boolean => {
      for (let x = 0; x < 40; x += 1) if ((fitted.data[(y * 40 + x) * 4 + 3] ?? 0) > 8) return true;
      return false;
    };
    expect(opaqueAt(39)).toBe(true);
  });
});

describe("frameSubject", () => {
  /** The measured failure: 47% width coverage meant ~15 of 32 columns used. */
  test("recovers the resolution a floating subject wastes", () => {
    const framed = frameSubject(sprite(), { size: 32 });

    expect(framed.coverage).toBeLessThan(0.25);
    expect(framed.notes[0]).toContain("cropped to");

    // Every column of the framed image is subject, where before it was 30%.
    const filled = new Set<number>();
    for (let y = 0; y < framed.image.height; y += 1) {
      for (let x = 0; x < framed.image.width; x += 1) {
        if ((framed.image.data[(y * framed.image.width + x) * 4 + 3] ?? 0) > 8) filled.add(x);
      }
    }
    expect(filled.size).toBe(framed.image.width);
  });

  /**
   * A tile legitimately fills its frame and has no background, so there is
   * nothing here to find. The fallback returns the *original* image rather than
   * the cleared one — which matters, because on a flat tile the flood fill
   * reaches every pixel and would otherwise hand back a fully transparent
   * image. This is also why `generate_asset` only frames sprite-like types:
   * on a textured tile whose mortar runs to the edge, the fill would eat the
   * mortar and the coverage check would happily accept the holed result.
   */
  test("a flat tile survives untouched rather than being erased", () => {
    const tile = image(32, 32, () => [90, 140, 60, 255]);
    const framed = frameSubject(tile, { size: 32 });

    expect(framed.image.width).toBe(32);
    expect(framed.image.height).toBe(32);
    expect(framed.image.data[3]).toBe(255);
    expect(framed.notes[0]).toContain("No subject");
  });

  test("an already-tight subject is not re-cropped", () => {
    // 96x96 of 100x100 is 92.2% by area, just over the threshold, so this is
    // left alone rather than scaled up for a two-pixel gain.
    const tight = image(100, 100, (x, y) =>
      x < 2 || y < 2 || x > 97 || y > 97 ? [0, 0, 0, 255] : [200, 40, 40, 255]
    );
    const framed = frameSubject(tight, { size: 100 });

    expect(framed.coverage).toBeGreaterThan(0.92);
    expect(framed.image.width).toBe(100);
    expect(framed.notes).toEqual([]);
  });

  test("keeps the full frame when there is no subject to find", () => {
    const flat = image(16, 16, () => [5, 5, 5, 255]);
    const framed = frameSubject(flat);
    expect(framed.image.width).toBe(16);
    expect(framed.notes[0]).toContain("No subject");
  });
});
