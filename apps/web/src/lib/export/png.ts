import { TRANSPARENT, type Cell, type Grid } from "@zenith/core";

/**
 * Indexed PNG (PNG-8 with a `PLTE` chunk).
 *
 * Every other raster export in this app flattens palette indices to RGB first.
 * This one does not: PNG's colour type 3 *is* an indexed image with a palette,
 * which is exactly what a Zenith document already is. The result is smaller,
 * lossless, and — the part that matters — still indexed, so a shader can read
 * the index and swap palettes at runtime.
 *
 * Deflate is emitted as stored (uncompressed) blocks. That is a valid zlib
 * stream every decoder accepts, and it keeps the encoder small enough to read.
 * These files are a few kilobytes; the compression would buy nothing worth the
 * complexity of a Huffman coder.
 */

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

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

function crc32(bytes: readonly number[]): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = (CRC_TABLE[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Adler-32, which is what zlib uses to check the decompressed stream. */
function adler32(bytes: readonly number[]): number {
  let a = 1;
  let b = 0;
  for (const byte of bytes) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function u32(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

/**
 * Appends without spreading.
 *
 * `target.push(...source)` passes every element as an argument, so it overflows
 * the call stack once `source` reaches a few hundred thousand entries. A
 * 1024x1024 indexed PNG has about a million, which is why exporting at scale
 * threw "Maximum call stack size exceeded" while small exports worked.
 */
function appendAll(target: number[], source: readonly number[]): void {
  for (let index = 0; index < source.length; index += 1) {
    target.push(source[index] as number);
  }
}

function chunk(type: string, data: readonly number[]): number[] {
  const payload: number[] = [];
  for (const character of type) payload.push(character.charCodeAt(0));
  appendAll(payload, data);

  const out: number[] = [];
  appendAll(out, u32(data.length));
  appendAll(out, payload);
  appendAll(out, u32(crc32(payload)));
  return out;
}

/** Wraps raw bytes in a zlib stream using stored deflate blocks. */
function zlibStored(data: readonly number[]): number[] {
  const out: number[] = [0x78, 0x01]; // deflate, 32K window, no preset dictionary

  const MAX_BLOCK = 0xffff;
  for (let offset = 0; offset < data.length; offset += MAX_BLOCK) {
    const slice = data.slice(offset, offset + MAX_BLOCK);
    const isLast = offset + MAX_BLOCK >= data.length;
    out.push(isLast ? 1 : 0);
    // Stored-block length is little-endian, followed by its one's complement.
    out.push(slice.length & 0xff, (slice.length >> 8) & 0xff);
    out.push(~slice.length & 0xff, (~slice.length >> 8) & 0xff);
    appendAll(out, slice);
  }

  if (data.length === 0) {
    out.push(1, 0, 0, 0xff, 0xff);
  }

  appendAll(out, u32(adler32(data)));
  return out;
}

export interface IndexedPngOptions {
  /** Nearest-neighbour upscale. Integer only — anything else resamples the art. */
  readonly scale?: number;
}

export function encodeIndexedPng(
  grid: Grid,
  palette: readonly string[],
  options: IndexedPngOptions = {}
): Uint8Array {
  if (palette.length === 0) {
    throw new Error("An indexed PNG needs at least one palette colour.");
  }
  if (palette.length > 256) {
    throw new Error(
      `An indexed PNG supports at most 256 colours, received ${String(palette.length)}.`
    );
  }

  const scale = Math.trunc(options.scale ?? 1);
  if (scale < 1) {
    throw new Error(`Scale must be a positive integer, received ${String(options.scale)}.`);
  }

  const width = grid.width * scale;
  const height = grid.height * scale;

  // Transparency is a palette entry, appended past the real colours.
  const transparentIndex = palette.length;
  const entries = palette.length + 1;

  const plte: number[] = [];
  for (const hex of palette) {
    const value = Number.parseInt(hex.slice(1), 16);
    plte.push((value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff);
  }
  plte.push(0, 0, 0); // the transparent entry's colour is never shown

  // tRNS gives alpha per palette entry; only the last one is transparent.
  const trns: number[] = new Array<number>(entries).fill(255);
  trns[transparentIndex] = 0;

  // Each scanline is prefixed with its filter type. 0 (None) keeps the indices
  // literal, which matters: a filtered scanline is no longer readable as indices.
  const raw: number[] = [];
  for (let y = 0; y < height; y += 1) {
    raw.push(0);
    const sourceY = Math.floor(y / scale);
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.floor(x / scale);
      const cell = (grid.cells[sourceY * grid.width + sourceX] ?? TRANSPARENT) as Cell;
      raw.push(cell === TRANSPARENT ? transparentIndex : cell);
    }
  }

  const bytes: number[] = [...SIGNATURE];
  appendAll(
    bytes,
    chunk("IHDR", [
      ...u32(width),
      ...u32(height),
      8, // bit depth
      3, // colour type 3: indexed
      0, // compression
      0, // filter
      0, // interlace
    ])
  );
  appendAll(bytes, chunk("PLTE", plte));
  appendAll(bytes, chunk("tRNS", trns));
  appendAll(bytes, chunk("IDAT", zlibStored(raw)));
  appendAll(bytes, chunk("IEND", []));

  return Uint8Array.from(bytes);
}
