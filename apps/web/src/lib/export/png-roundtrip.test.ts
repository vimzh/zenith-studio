import { describe, expect, test } from "bun:test";
import { TRANSPARENT, createGrid, gridFromRows, type Grid } from "@zenith/core";
import { encodeIndexedPng } from "./png";

/**
 * Round-trip verification for the PNG encoder.
 *
 * The structural tests check chunk names and header fields, none of which would
 * catch a wrong CRC, a malformed stored-deflate block, a bad Adler-32, or
 * scanlines written without their filter byte. Every one of those produces a
 * file that looks correct in a hex dump and fails to open. So this parses the
 * chunks, verifies the CRCs, inflates the stored blocks, and compares the
 * scanlines against the source grid.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) === 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = (CRC_TABLE[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

interface Chunk {
  readonly type: string;
  readonly data: Uint8Array;
  readonly crcValid: boolean;
}

function readChunks(png: Uint8Array): Chunk[] {
  const chunks: Chunk[] = [];
  let at = 8; // past the signature

  while (at < png.length) {
    const length =
      ((png[at] as number) << 24) |
      ((png[at + 1] as number) << 16) |
      ((png[at + 2] as number) << 8) |
      (png[at + 3] as number);
    const type = String.fromCharCode(...png.slice(at + 4, at + 8));
    const data = png.slice(at + 8, at + 8 + length);
    const stated =
      (((png[at + 8 + length] as number) << 24) |
        ((png[at + 9 + length] as number) << 16) |
        ((png[at + 10 + length] as number) << 8) |
        (png[at + 11 + length] as number)) >>>
      0;

    chunks.push({ type, data, crcValid: crc32(png.slice(at + 4, at + 8 + length)) === stated });
    at += 12 + length;
    if (type === "IEND") {
      break;
    }
  }

  return chunks;
}

/** Inflates a zlib stream made only of stored (uncompressed) blocks. */
function inflateStored(stream: Uint8Array): { data: number[]; adlerValid: boolean } {
  // Two-byte zlib header, then blocks, then a 4-byte Adler-32.
  let at = 2;
  const out: number[] = [];

  for (;;) {
    const header = stream[at] as number;
    const isLast = (header & 1) === 1;
    const blockType = (header >> 1) & 3;
    if (blockType !== 0) {
      throw new Error(`Expected a stored block, found type ${String(blockType)}.`);
    }
    at += 1;

    const length = (stream[at] as number) | ((stream[at + 1] as number) << 8);
    const complement = (stream[at + 2] as number) | ((stream[at + 3] as number) << 8);
    if ((length ^ 0xffff) !== complement) {
      throw new Error("Stored block length and its complement disagree.");
    }
    at += 4;

    for (let i = 0; i < length; i += 1) {
      out.push(stream[at + i] as number);
    }
    at += length;

    if (isLast) {
      break;
    }
  }

  let a = 1;
  let b = 0;
  for (const byte of out) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  const computed = ((b << 16) | a) >>> 0;
  const stated =
    (((stream[at] as number) << 24) |
      ((stream[at + 1] as number) << 16) |
      ((stream[at + 2] as number) << 8) |
      (stream[at + 3] as number)) >>>
    0;

  return { data: out, adlerValid: computed === stated };
}

interface DecodedPng {
  readonly width: number;
  readonly height: number;
  readonly rows: number[][];
  readonly transparentIndex: number;
  readonly allCrcsValid: boolean;
  readonly adlerValid: boolean;
}

function decodePng(png: Uint8Array): DecodedPng {
  const chunks = readChunks(png);
  const ihdr = chunks.find((chunk) => chunk.type === "IHDR") as Chunk;
  const trns = chunks.find((chunk) => chunk.type === "tRNS") as Chunk;
  const idat = chunks.find((chunk) => chunk.type === "IDAT") as Chunk;

  const width =
    ((ihdr.data[0] as number) << 24) |
    ((ihdr.data[1] as number) << 16) |
    ((ihdr.data[2] as number) << 8) |
    (ihdr.data[3] as number);
  const height =
    ((ihdr.data[4] as number) << 24) |
    ((ihdr.data[5] as number) << 16) |
    ((ihdr.data[6] as number) << 8) |
    (ihdr.data[7] as number);

  const { data, adlerValid } = inflateStored(idat.data);

  const rows: number[][] = [];
  let at = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = data[at] as number;
    if (filter !== 0) {
      throw new Error(`Scanline ${String(y)} uses filter ${String(filter)}; indices must stay literal.`);
    }
    at += 1;
    rows.push(data.slice(at, at + width));
    at += width;
  }

  return {
    width,
    height,
    rows,
    transparentIndex: trns.data.findIndex((alpha) => alpha === 0),
    allCrcsValid: chunks.every((chunk) => chunk.crcValid),
    adlerValid,
  };
}

function expectedRows(grid: Grid, transparentIndex: number, scale = 1): number[][] {
  const rows: number[][] = [];
  for (let y = 0; y < grid.height * scale; y += 1) {
    const row: number[] = [];
    for (let x = 0; x < grid.width * scale; x += 1) {
      const cell = grid.cells[Math.floor(y / scale) * grid.width + Math.floor(x / scale)] as number;
      row.push(cell === TRANSPARENT ? transparentIndex : cell);
    }
    rows.push(row);
  }
  return rows;
}

const PALETTE = ["#0f380f", "#306230", "#8bac0f", "#9bbc0f"];

describe("indexed PNG round-trip", () => {
  for (const count of [19, 255]) test(`${String(count)} colours round-trip with transparency at the UI's 8x scale`, () => {
    const palette = Array.from({ length: count }, (_, index) => `#${index.toString(16).padStart(6, "0")}`);
    const grid = createGrid(32, 32, TRANSPARENT);
    for (let i = 0; i < grid.cells.length; i += 1) grid.cells[i] = i % (count + 1) - 1;
    const png = encodeIndexedPng(grid, palette, { scale: 8 });
    const decoded = decodePng(png);
    expect(decoded.rows).toEqual(expectedRows(grid, count, 8));
    expect(decoded.transparentIndex).toBe(count);
    expect(decoded.allCrcsValid && decoded.adlerValid).toBe(true);
    expect(readChunks(png).find((chunk) => chunk.type === "PLTE")?.data.length).toBe((count + 1) * 3);
  });

  test("every chunk CRC is valid", () => {
    // A wrong CRC makes the file unopenable while looking fine in a hex dump.
    const decoded = decodePng(encodeIndexedPng(gridFromRows(["0123", "3210"]), PALETTE));
    expect(decoded.allCrcsValid).toBe(true);
  });

  test("the zlib Adler-32 checks out", () => {
    const decoded = decodePng(encodeIndexedPng(gridFromRows(["0123", "3210"]), PALETTE));
    expect(decoded.adlerValid).toBe(true);
  });

  test("scanlines decode back to the source indices", () => {
    const grid = gridFromRows(["0123", "3210", "0011", "2233"]);
    const decoded = decodePng(encodeIndexedPng(grid, PALETTE));
    expect(decoded.rows).toEqual(expectedRows(grid, decoded.transparentIndex));
  });

  test("transparency decodes to the reserved index", () => {
    const grid = gridFromRows(["0.1.", ".2.3"]);
    const decoded = decodePng(encodeIndexedPng(grid, PALETTE));
    expect(decoded.transparentIndex).toBe(PALETTE.length);
    expect(decoded.rows).toEqual(expectedRows(grid, decoded.transparentIndex));
  });

  test("a scaled image decodes to the upscaled indices", () => {
    const grid = gridFromRows(["01", "23"]);
    const decoded = decodePng(encodeIndexedPng(grid, PALETTE, { scale: 3 }));
    expect(decoded.width).toBe(6);
    expect(decoded.rows).toEqual(expectedRows(grid, decoded.transparentIndex, 3));
  });

  test("a large image round-trips, crossing the 65535-byte stored-block limit", () => {
    // 300x300 is 90k index bytes plus filter bytes, so the deflate stream must
    // split into multiple stored blocks with only the last marked final.
    const grid = createGrid(300, 300, 0);
    for (let i = 0; i < grid.cells.length; i += 1) {
      grid.cells[i] = (i % 4) as never;
    }
    const decoded = decodePng(encodeIndexedPng(grid, PALETTE));
    expect(decoded.width).toBe(300);
    expect(decoded.adlerValid).toBe(true);
    expect(decoded.rows[0]).toEqual(expectedRows(grid, decoded.transparentIndex)[0] as number[]);
    expect(decoded.rows[299]).toEqual(expectedRows(grid, decoded.transparentIndex)[299] as number[]);
  });

  test("a fully transparent image round-trips", () => {
    const grid = createGrid(8, 8, TRANSPARENT);
    const decoded = decodePng(encodeIndexedPng(grid, PALETTE));
    expect(decoded.rows).toEqual(expectedRows(grid, decoded.transparentIndex));
  });

  test("a single pixel round-trips", () => {
    const grid = gridFromRows(["2"]);
    const decoded = decodePng(encodeIndexedPng(grid, PALETTE));
    expect(decoded.rows).toEqual([[2]]);
  });
});
