import { describe, expect, test } from "bun:test";
import { TRANSPARENT, createGrid, gridFromRows, type Grid } from "@zenith/core";
import { encodeGif } from "./gif";

/**
 * Round-trip verification.
 *
 * The existing GIF tests check headers, chunk counts and structure — none of
 * which would catch a wrong LZW code width, a missed table reset, or a
 * misordered bit pack. Those produce a file that looks perfectly well-formed
 * and decodes to garbage. So this decodes the stream back to pixels and
 * compares against the source grid.
 */

interface Decoded {
  readonly width: number;
  readonly height: number;
  readonly frames: number[][];
  readonly transparentIndex: number;
  readonly delays: number[];
}

/** Minimal GIF89a reader — enough to verify what the encoder wrote. */
function decodeGif(bytes: Uint8Array): Decoded {
  let at = 6; // past "GIF89a"

  const u16 = (): number => {
    const value = (bytes[at] as number) | ((bytes[at + 1] as number) << 8);
    at += 2;
    return value;
  };

  const width = u16();
  const height = u16();
  const packed = bytes[at] as number;
  at += 1;
  const transparentIndex = bytes[at] as number;
  at += 2; // background index + aspect ratio

  const tableSize = 1 << ((packed & 0x07) + 1);
  at += tableSize * 3; // skip the global colour table

  const frames: number[][] = [];
  const delays: number[] = [];

  while (at < bytes.length) {
    const marker = bytes[at] as number;

    if (marker === 0x21) {
      if (bytes[at + 1] === 0xf9) delays.push(((bytes[at + 4] as number) | ((bytes[at + 5] as number) << 8)) * 10);
      // Extension: skip its blocks.
      at += 2;
      while ((bytes[at] as number) !== 0) {
        at += (bytes[at] as number) + 1;
      }
      at += 1;
      continue;
    }

    if (marker === 0x3b) {
      break; // trailer
    }

    if (marker !== 0x2c) {
      throw new Error(`Unexpected block marker 0x${marker.toString(16)} at ${String(at)}.`);
    }

    at += 1 + 8; // descriptor: separator, x, y, w, h
    at += 1; // packed field (no local colour table)

    const minimumCodeSize = bytes[at] as number;
    at += 1;

    // Gather the sub-blocks into one buffer.
    const data: number[] = [];
    while ((bytes[at] as number) !== 0) {
      const length = bytes[at] as number;
      at += 1;
      for (let i = 0; i < length; i += 1) {
        data.push(bytes[at + i] as number);
      }
      at += length;
    }
    at += 1;

    frames.push(lzwDecode(data, minimumCodeSize, width * height));
  }

  return { width, height, frames, transparentIndex, delays };
}

function lzwDecode(data: readonly number[], minimumCodeSize: number, expected: number): number[] {
  const clearCode = 1 << minimumCodeSize;
  const endCode = clearCode + 1;

  let codeSize = minimumCodeSize + 1;
  let dictionary: number[][] = [];
  const resetDictionary = () => {
    dictionary = [];
    for (let i = 0; i < clearCode; i += 1) {
      dictionary[i] = [i];
    }
    dictionary[clearCode] = [];
    dictionary[endCode] = [];
    codeSize = minimumCodeSize + 1;
  };
  resetDictionary();

  const out: number[] = [];
  let bitBuffer = 0;
  let bitCount = 0;
  let position = 0;
  let previous: number[] | null = null;

  const nextCode = (): number | null => {
    while (bitCount < codeSize) {
      if (position >= data.length) {
        return null;
      }
      bitBuffer |= (data[position] as number) << bitCount;
      position += 1;
      bitCount += 8;
    }
    const code = bitBuffer & ((1 << codeSize) - 1);
    bitBuffer >>= codeSize;
    bitCount -= codeSize;
    return code;
  };

  for (;;) {
    const code = nextCode();
    if (code === null || code === endCode) {
      break;
    }

    if (code === clearCode) {
      resetDictionary();
      previous = null;
      continue;
    }

    let entry: number[];
    if (dictionary[code] !== undefined) {
      entry = dictionary[code] as number[];
    } else if (previous !== null) {
      // The KwKwK case: a code referring to the entry being built.
      entry = [...previous, previous[0] as number];
    } else {
      throw new Error(`Undefined code ${String(code)} with no previous entry.`);
    }

    out.push(...entry);

    if (previous !== null) {
      dictionary.push([...previous, entry[0] as number]);
      if (dictionary.length >= 1 << codeSize && codeSize < 12) {
        codeSize += 1;
      }
    }

    previous = entry;
    if (out.length >= expected) {
      break;
    }
  }

  return out;
}

function indicesOf(grid: Grid, transparentIndex: number): number[] {
  return Array.from(grid.cells, (cell) => (cell === TRANSPARENT ? transparentIndex : cell));
}

const PALETTE = ["#000000", "#ff0000", "#00ff00", "#0000ff"];

describe("GIF round-trip", () => {
  test("defaults to 4 fps and preserves explicit uniform or mixed frame timings", () => {
    const frames = [createGrid(2, 2, 0), createGrid(2, 2, 1)];
    expect(decodeGif(encodeGif(frames, PALETTE)).delays).toEqual([250, 250]);
    expect(decodeGif(encodeGif(frames, PALETTE, { delayMs: 80 })).delays).toEqual([80, 80]);
    expect(decodeGif(encodeGif(frames, PALETTE, { delayMs: [80, 350] })).delays).toEqual([80, 350]);
  });
  test("a single frame decodes back to its exact pixels", () => {
    const grid = gridFromRows(["0123", "3210", "0011", "2233"]);
    const decoded = decodeGif(encodeGif([grid], PALETTE));

    expect(decoded.width).toBe(4);
    expect(decoded.height).toBe(4);
    expect(decoded.frames).toHaveLength(1);
    expect(decoded.frames[0]).toEqual(indicesOf(grid, decoded.transparentIndex));
  });

  test("transparency survives the round trip", () => {
    const grid = gridFromRows(["0.1.", ".2.3"]);
    const decoded = decodeGif(encodeGif([grid], PALETTE));
    expect(decoded.frames[0]).toEqual(indicesOf(grid, decoded.transparentIndex));
  });

  test("every frame of a multi-frame animation decodes correctly", () => {
    const frames = [
      gridFromRows(["0011", "0011"]),
      gridFromRows(["1100", "1100"]),
      gridFromRows(["2323", "3232"]),
    ];
    const decoded = decodeGif(encodeGif(frames, PALETTE));

    expect(decoded.frames).toHaveLength(3);
    frames.forEach((grid, index) => {
      expect(decoded.frames[index]).toEqual(indicesOf(grid, decoded.transparentIndex));
    });
  });

  test("a scaled frame decodes to the upscaled pixels", () => {
    const grid = gridFromRows(["01", "23"]);
    const decoded = decodeGif(encodeGif([grid], PALETTE, { scale: 3 }));

    expect(decoded.width).toBe(6);
    expect(decoded.height).toBe(6);
    // Each source pixel becomes a 3x3 block.
    expect(decoded.frames[0]?.slice(0, 6)).toEqual([0, 0, 0, 1, 1, 1]);
    expect(decoded.frames[0]?.slice(18, 24)).toEqual([2, 2, 2, 3, 3, 3]);
  });

  test("a full 16-colour palette round-trips, exercising a wider code size", () => {
    const full = Array.from({ length: 16 }, (_, i) => `#${i.toString(16).repeat(6)}`);
    const grid = createGrid(8, 8, 0);
    for (let i = 0; i < grid.cells.length; i += 1) {
      grid.cells[i] = (i % 16) as never;
    }
    const decoded = decodeGif(encodeGif([grid], full));
    expect(decoded.frames[0]).toEqual(indicesOf(grid, decoded.transparentIndex));
  });

  test("a large frame round-trips, exercising sub-block splitting and code growth", () => {
    // Over 255 bytes of compressed data forces multiple sub-blocks, and enough
    // distinct sequences to grow the code width past its initial size.
    const grid = createGrid(64, 64, 0);
    for (let y = 0; y < 64; y += 1) {
      for (let x = 0; x < 64; x += 1) {
        grid.cells[y * 64 + x] = ((x * 7 + y * 13) % 4) as never;
      }
    }
    const decoded = decodeGif(encodeGif([grid], PALETTE));
    expect(decoded.frames[0]).toEqual(indicesOf(grid, decoded.transparentIndex));
  });

  test("a uniform frame round-trips, the case that compresses hardest", () => {
    const grid = createGrid(32, 32, 2);
    const decoded = decodeGif(encodeGif([grid], PALETTE));
    expect(decoded.frames[0]).toEqual(indicesOf(grid, decoded.transparentIndex));
  });

  test("a fully transparent frame round-trips", () => {
    const grid = createGrid(16, 16, TRANSPARENT);
    const decoded = decodeGif(encodeGif([grid], PALETTE));
    expect(decoded.frames[0]).toEqual(indicesOf(grid, decoded.transparentIndex));
  });
});
