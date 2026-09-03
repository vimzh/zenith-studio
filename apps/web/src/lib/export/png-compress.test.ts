import { describe, expect, test } from "bun:test";
import { TRANSPARENT, createGrid } from "@zenith/core";
import { compressIndexedPng, encodeIndexedPng } from "./png";

function chunksOf(png: Uint8Array): { type: string; data: Uint8Array }[] {
  const chunks: { type: string; data: Uint8Array }[] = [];
  let offset = 8;
  while (offset + 12 <= png.length) {
    const length = ((png[offset]! << 24) | (png[offset + 1]! << 16) | (png[offset + 2]! << 8) | png[offset + 3]!) >>> 0;
    const type = String.fromCharCode(png[offset + 4]!, png[offset + 5]!, png[offset + 6]!, png[offset + 7]!);
    chunks.push({ type, data: png.subarray(offset + 8, offset + 8 + length) });
    offset += 12 + length;
  }
  return chunks;
}

async function inflate(zlib: Uint8Array): Promise<Uint8Array> {
  const copy = new Uint8Array(new ArrayBuffer(zlib.length));
  copy.set(zlib);
  const stream = new Blob([copy]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

describe("compressIndexedPng", () => {
  const palette = ["#000000", "#ff0000", "#00ff00", "#0000ff"];
  const grid = createGrid(64, 64, TRANSPARENT);
  for (let y = 16; y < 48; y += 1) for (let x = 8; x < 56; x += 1) grid.cells[y * 64 + x] = (x + y) % 3;

  test("shrinks the sheet-sized PNG the model receives by an order of magnitude and keeps every chunk", async () => {
    const stored = encodeIndexedPng(grid, palette, { scale: 16 });
    expect(stored.length).toBeGreaterThan(1_000_000);
    const compressed = await compressIndexedPng(stored);
    expect(compressed.length).toBeLessThan(stored.length / 10);

    const before = chunksOf(stored);
    const after = chunksOf(compressed);
    expect(after.map((chunk) => chunk.type)).toEqual(["IHDR", "PLTE", "tRNS", "IDAT", "IEND"]);
    for (const type of ["IHDR", "PLTE", "tRNS"]) {
      expect(after.find((chunk) => chunk.type === type)?.data).toEqual(before.find((chunk) => chunk.type === type)?.data);
    }
    // The scanlines are byte-identical once inflated — compression, not resampling.
    const raw = await inflate(after.find((chunk) => chunk.type === "IDAT")!.data);
    expect(raw.length).toBe((64 * 16 + 1) * 64 * 16);
    const storedRaw = await inflate(before.find((chunk) => chunk.type === "IDAT")!.data);
    expect(raw).toEqual(storedRaw);
  });

  test("hands back anything that is not one of its own stored-block PNGs unchanged", async () => {
    const notPng = new Uint8Array([1, 2, 3, 4]);
    expect(await compressIndexedPng(notPng)).toBe(notPng);
    const compressedTwice = await compressIndexedPng(await compressIndexedPng(encodeIndexedPng(grid, palette, { scale: 4 })));
    expect(chunksOf(compressedTwice).map((chunk) => chunk.type)).toContain("IDAT");
  });
});
