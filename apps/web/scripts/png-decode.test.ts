import { deflateSync } from "node:zlib";
import { describe, expect, test } from "bun:test";
import { createGrid, type Cell } from "@zenith/core";
import { frameToCanvas, pixelize } from "../src/lib/pixelize";
import { decodePng } from "./png-decode";

/**
 * The decoder is fed real model output, so it is tested at that shape.
 *
 * A 32x32 fixture at 1x would prove nothing about the case that matters: a
 * 1024x1024 **RGBA** PNG with transparency, which is what `/v1/generate`
 * returns and the only input this ever sees. The product's own
 * `encodeIndexedPng` writes colour type 3 with a PLTE chunk — the format it
 * exists to produce, and not this one — so the fixture is encoded here as
 * true colour with alpha, which is the input the decoder actually meets.
 */

/** A truecolour-with-alpha PNG, the shape an image model returns. */
function encodeRgbaPng(width: number, height: number, pixels: Uint8ClampedArray): Uint8Array {
  const chunk = (type: string, body: Uint8Array): Uint8Array => {
    const out = new Uint8Array(body.length + 12);
    const view = new DataView(out.buffer);
    view.setUint32(0, body.length);
    for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
    out.set(body, 8);
    view.setUint32(body.length + 8, Bun.hash.crc32(out.subarray(4, body.length + 8)));
    return out;
  };

  const header = new Uint8Array(13);
  const headerView = new DataView(header.buffer);
  headerView.setUint32(0, width);
  headerView.setUint32(4, height);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: truecolour with alpha
  // 10-12: deflate, adaptive filtering, no interlace — all zero.

  // Filter byte 0 per scanline: the encoder's job is to be predictable here,
  // not small, since the point is to know every byte going in.
  const raw = new Uint8Array(height * (width * 4 + 1));
  for (let y = 0; y < height; y += 1) {
    raw.set(pixels.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  }

  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", new Uint8Array(deflateSync(Buffer.from(raw)))),
    chunk("IEND", new Uint8Array(0)),
  ];
  const png = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    png.set(part, offset);
    offset += part.length;
  }
  return png;
}

/** The 16x16 sprite blown up to the 1024x1024 a model returns. */
function fixturePng(grid: ReturnType<typeof createGrid>, scale: number): Uint8Array {
  const size = 16 * scale;
  const pixels = new Uint8ClampedArray(size * size * 4);
  const rgb = PALETTE.map((hex) => [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ]);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const cell = grid.cells[Math.floor(y / scale) * 16 + Math.floor(x / scale)] as number;
      const offset = (y * size + x) * 4;
      if (cell < 0) continue;
      const colour = rgb[cell] as number[];
      pixels[offset] = colour[0] as number;
      pixels[offset + 1] = colour[1] as number;
      pixels[offset + 2] = colour[2] as number;
      pixels[offset + 3] = 255;
    }
  }
  return encodeRgbaPng(size, size, pixels);
}

const PALETTE = ["#14121c", "#7b3f2a", "#d98f5c", "#3c6e99"];

function sprite(): ReturnType<typeof createGrid> {
  const grid = createGrid(16, 16, -1);
  for (let y = 2; y < 14; y += 1) {
    for (let x = 4; x < 12; x += 1) {
      const edge = y === 2 || y === 13 || x === 4 || x === 11;
      grid.cells[y * 16 + x] = (edge ? 0 : x < 8 ? 1 : 2) as Cell;
    }
  }
  grid.cells[5 * 16 + 6] = 3 as Cell;
  return grid;
}

describe("decodePng", () => {
  test("round-trips a 1024x1024 RGBA image byte for byte", () => {
    const grid = sprite();
    const raster = decodePng(fixturePng(grid, 64));

    expect([raster.width, raster.height]).toEqual([1024, 1024]);

    // Every source cell, sampled at the centre of its 64x64 block.
    const rgb = PALETTE.map((hex) => [
      Number.parseInt(hex.slice(1, 3), 16),
      Number.parseInt(hex.slice(3, 5), 16),
      Number.parseInt(hex.slice(5, 7), 16),
    ]);
    const mismatches: string[] = [];
    for (let y = 0; y < 16; y += 1) {
      for (let x = 0; x < 16; x += 1) {
        const offset = ((y * 64 + 32) * 1024 + x * 64 + 32) * 4;
        const cell = grid.cells[y * 16 + x] as number;
        const expected = cell < 0 ? [0, 0, 0, 0] : [...(rgb[cell] as number[]), 255];
        const actual = [
          raster.data[offset],
          raster.data[offset + 1],
          raster.data[offset + 2],
          raster.data[offset + 3],
        ];
        if (actual.join() !== expected.join()) mismatches.push(`(${String(x)},${String(y)}) ${actual.join()} != ${expected.join()}`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  /** The whole point: decoded output goes back through the product's pipeline. */
  test("its output pixelises back to the grid it came from", () => {
    const grid = sprite();
    const raster = decodePng(fixturePng(grid, 64));
    const framed = frameToCanvas(raster, 16, 16);
    const result = pixelize(framed?.image ?? raster, { targetWidth: 16, maxColors: 16 });

    expect([result.grid.width, result.grid.height]).toEqual([16, 16]);

    const transparent = (cells: Int8Array) => [...cells].filter((cell) => cell < 0).length;
    // Fewer transparent cells than the source, because framing is doing its
    // job: it crops the margin and scales the subject to fill the canvas, which
    // is most of the difference between a muddy sprite and a readable one.
    expect(transparent(result.grid.cells)).toBeLessThan(transparent(grid.cells));
    expect(transparent(result.grid.cells)).toBeGreaterThan(0);
    // The outline and both body tones survive, and nothing was invented.
    expect(result.palette.length).toBeGreaterThanOrEqual(3);
    expect(result.palette.length).toBeLessThanOrEqual(4);
  });

  test("refuses a shape it cannot decode rather than guessing", () => {
    expect(() => decodePng(new Uint8Array([1, 2, 3, 4]))).toThrow("Not a PNG");
  });
});
