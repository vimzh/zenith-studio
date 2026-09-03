import { expect, test } from "bun:test";
import { resampleToGrid } from "./resolve";
import { createRaster, pixelAt } from "./types";

for (const targetSize of [96, 128]) {
  test(`upsampling 64px to ${targetSize}px samples the nearest source pixel, including edges`, () => {
    const image = createRaster(64, 64);
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
      image.data.set([x * 4, y * 4, 128, x < 4 && y < 4 ? 0 : 255], (y * 64 + x) * 4);
    }
    const cell = 64 / targetSize;
    const output = resampleToGrid(image, {
      x: { cell, phase: 0, count: targetSize },
      y: { cell, phase: 0, count: targetSize },
      confidence: 1,
    });
    for (let y = 0; y < targetSize; y++) for (let x = 0; x < targetSize; x++) {
      const expected = pixelAt(image, Math.floor(((2 * x + 1) * 64) / (2 * targetSize)), Math.floor(((2 * y + 1) * 64) / (2 * targetSize)));
      expect(pixelAt(output, x, y)).toEqual(expected[3] === 0 ? [0, 0, 0, 0] : expected);
    }
  });
}
