import { describe, expect, test } from "bun:test";
import {
  builtinPalette,
  createPalette,
  formatHex,
  lightnessRamp,
  nearestIndex,
  oklabDistance,
  oklabToRgb,
  parseHex,
  quantize,
  rgbToOklab,
  TRANSPARENT,
} from "../src/index";
import { createRandom, randomInt } from "./random";

describe("Oklab conversion", () => {
  test("round-trips every sRGB colour it is given", () => {
    const random = createRandom(0x51ded);
    for (let i = 0; i < 2000; i += 1) {
      const rgb = { r: randomInt(random, 0, 255), g: randomInt(random, 0, 255), b: randomInt(random, 0, 255) };
      expect(oklabToRgb(rgbToOklab(rgb))).toEqual(rgb);
    }
  });

  test("places black and white at the ends of the lightness axis", () => {
    expect(rgbToOklab({ r: 0, g: 0, b: 0 }).L).toBeCloseTo(0, 6);
    expect(rgbToOklab({ r: 255, g: 255, b: 255 }).L).toBeCloseTo(1, 3);
  });

  test("greys sit on the neutral axis", () => {
    const grey = rgbToOklab({ r: 128, g: 128, b: 128 });
    expect(Math.abs(grey.a)).toBeLessThan(1e-6);
    expect(Math.abs(grey.b)).toBeLessThan(1e-6);
  });

  test("parses every accepted hex form to the same colour", () => {
    expect(parseHex("#f0a")).toEqual(parseHex("#ff00aa"));
    expect(parseHex("FF00AA")).toEqual(parseHex("#ff00aa"));
    expect(formatHex(parseHex("#FF00AA"))).toBe("#ff00aa");
  });

  test("rejects text that is not a colour", () => {
    expect(() => parseHex("#12345")).toThrow(/not a hex colour/);
    expect(() => parseHex("rebeccapurple")).toThrow(/not a hex colour/);
  });
});

describe("palette matching", () => {
  test("matches a colour to its nearest entry perceptually", () => {
    const palette = builtinPalette("pico-8");
    expect(palette.colors[nearestIndex(palette, "#000000")]?.hex).toBe("#000000");
    expect(palette.colors[nearestIndex(palette, "#fffcf5")]?.hex).toBe("#fff1e8");
    expect(palette.colors[nearestIndex(palette, "#fe0142")]?.hex).toBe("#ff004d");
    expect(palette.colors[nearestIndex(palette, "#01dd33")]?.hex).toBe("#00e436");
  });

  test("exposes a dark-to-light ramp, which is what shading walks", () => {
    const palette = builtinPalette("gb-dmg");
    expect(lightnessRamp(palette)).toEqual([0, 1, 2, 3]);
  });

  test("normalises and caps palette input", () => {
    expect(createPalette({ colors: ["#ABC"] }).colors[0]?.hex).toBe("#aabbcc");
    expect(() => createPalette({ colors: [] })).toThrow(/at least one colour/);
    expect(() => createPalette({ colors: Array.from({ length: 17 }, () => "#000000") })).toThrow(
      /cap is 16/,
    );
  });
});

/**
 * Exit criterion: the quantiser reduces a 4,096-colour test image to 16 colours
 * with visibly sensible results — the failure mode this project exists to
 * prevent is a generated image arriving with hundreds of near-identical colours.
 */
describe("Oklab k-means quantiser", () => {
  /** A 64x64 image holding every colour of a 16x16x16 RGB cube: 4,096 distinct colours. */
  function colorCubeImage(): Uint8ClampedArray {
    const pixels = new Uint8ClampedArray(64 * 64 * 4);
    let offset = 0;
    for (let r = 0; r < 16; r += 1) {
      for (let g = 0; g < 16; g += 1) {
        for (let b = 0; b < 16; b += 1) {
          pixels[offset] = r * 17;
          pixels[offset + 1] = g * 17;
          pixels[offset + 2] = b * 17;
          pixels[offset + 3] = 255;
          offset += 4;
        }
      }
    }
    return pixels;
  }

  test("reduces 4096 colours to exactly 16", () => {
    const result = quantize(colorCubeImage(), { maxColors: 16 });
    expect(result.sourceColorCount).toBe(4096);
    expect(result.colors).toHaveLength(16);
    expect(new Set(result.colors).size).toBe(16);
    expect(result.indices).toHaveLength(64 * 64);
    for (const index of result.indices) {
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(16);
    }
  });

  test("stays perceptually close to the source", () => {
    const result = quantize(colorCubeImage(), { maxColors: 16 });
    // Oklab lightness spans 0..1, so a mean error of 0.15 is a visible but small
    // step — roughly the gap between adjacent entries on a 16-step ramp.
    expect(result.meanError).toBeLessThan(0.15);
  });

  test("keeps the palette spread across the lightness range", () => {
    const result = quantize(colorCubeImage(), { maxColors: 16 });
    const lightness = result.colors.map((hex) => rgbToOklab(parseHex(hex)).L);
    expect(lightness).toEqual([...lightness].sort((a, b) => a - b));
    expect((lightness[15] as number) - (lightness[0] as number)).toBeGreaterThan(0.6);
  });

  test("keeps saturated hues apart rather than collapsing them to grey", () => {
    const result = quantize(colorCubeImage(), { maxColors: 16 });
    const labs = result.colors.map((hex) => rgbToOklab(parseHex(hex)));
    const chroma = labs.map((lab) => Math.hypot(lab.a, lab.b));
    expect(chroma.filter((c) => c > 0.1)).not.toHaveLength(0);

    let closest = Number.POSITIVE_INFINITY;
    for (let i = 0; i < labs.length; i += 1) {
      for (let j = i + 1; j < labs.length; j += 1) {
        closest = Math.min(closest, oklabDistance(labs[i] as never, labs[j] as never));
      }
    }
    // No two entries collapse onto each other — every slot earns its place.
    expect(closest).toBeGreaterThan(0.05);
  });

  test("is deterministic for a given seed", () => {
    const image = colorCubeImage();
    expect(quantize(image, { maxColors: 16, seed: 7 }).colors).toEqual(
      quantize(image, { maxColors: 16, seed: 7 }).colors,
    );
  });

  test("preserves a ramp's ordering when reducing a gradient", () => {
    const pixels = new Uint8ClampedArray(256 * 4);
    for (let i = 0; i < 256; i += 1) {
      pixels[i * 4] = i;
      pixels[i * 4 + 1] = i;
      pixels[i * 4 + 2] = i;
      pixels[i * 4 + 3] = 255;
    }
    const result = quantize(pixels, { maxColors: 8 });
    expect(result.colors).toHaveLength(8);
    for (let i = 1; i < 256; i += 1) {
      expect(result.indices[i] as number).toBeGreaterThanOrEqual(result.indices[i - 1] as number);
    }
  });

  test("returns source colours unchanged when the image already fits", () => {
    const source = ["#0f380f", "#306230", "#8bac0f"];
    const pixels = new Uint8ClampedArray(source.length * 4);
    source.forEach((hex, i) => {
      const rgb = parseHex(hex);
      pixels[i * 4] = rgb.r;
      pixels[i * 4 + 1] = rgb.g;
      pixels[i * 4 + 2] = rgb.b;
      pixels[i * 4 + 3] = 255;
    });
    const result = quantize(pixels, { maxColors: 16 });
    expect([...result.colors].sort()).toEqual([...source].sort());
    expect(result.meanError).toBe(0);
  });

  test("thresholds alpha to transparent, never to a blended colour", () => {
    const pixels = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 40, 0, 255, 0, 200]);
    const result = quantize(pixels, { maxColors: 16 });
    expect(result.indices[1]).toBe(TRANSPARENT);
    expect(result.indices[0]).toBeGreaterThanOrEqual(0);
    expect(result.indices[2]).toBeGreaterThanOrEqual(0);
    expect(result.colors).toHaveLength(2);
  });

  test("refuses to exceed the 16-colour cap", () => {
    expect(() => quantize(colorCubeImage(), { maxColors: 32 })).toThrow(/cap is 16/);
  });

  test("refuses a buffer that is not RGBA", () => {
    expect(() => quantize(new Uint8ClampedArray([1, 2, 3]))).toThrow(/multiple of 4/);
  });
});
