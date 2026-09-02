import { expect, test } from "bun:test";
import { createGrid, TRANSPARENT } from "@zenith/core";
import { encodeIndexedPng } from "@/lib/export/png";

/** A sprite on transparency: a filled square with a transparent border. */
function sprite() {
  const grid = createGrid(16, 16);
  for (let y = 0; y < 16; y += 1)
    for (let x = 0; x < 16; x += 1)
      grid.cells[y * 16 + x] = x >= 4 && x < 12 && y >= 4 && y < 12 ? 1 : TRANSPARENT;
  return grid;
}

function chunks(png: Uint8Array) {
  const out: { type: string; start: number; length: number }[] = [];
  let i = 8;
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  while (i < png.length) {
    const length = view.getUint32(i);
    const type = String.fromCharCode(...png.slice(i + 4, i + 8));
    out.push({ type, start: i + 8, length });
    if (type === "IEND") break;
    i += 12 + length;
  }
  return out;
}

test("an indexed PNG of a sprite on transparency is genuinely transparent", () => {
  const png = encodeIndexedPng(sprite(), ["#000000", "#3a6ea5"]);
  const found = chunks(png);
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);

  const ihdr = found.find((c) => c.type === "IHDR");
  expect(ihdr).toBeDefined();
  // Colour type 3 = indexed. Byte order: width, height, depth, colourType.
  expect(png[ihdr!.start + 9]).toBe(3);

  // tRNS is what makes an indexed PNG transparent at all.
  const trns = found.find((c) => c.type === "tRNS");
  expect(trns).toBeDefined();

  // At least one palette entry must be fully transparent.
  const alphas = [...png.slice(trns!.start, trns!.start + trns!.length)];
  expect(alphas).toContain(0);

  // And exactly one, so opaque art is not accidentally see-through.
  expect(alphas.filter((a) => a === 0).length).toBe(1);

  expect(view.getUint32(0)).toBe(0x89504e47);
});

test("scaling preserves transparency rather than filling it", () => {
  const png = encodeIndexedPng(sprite(), ["#000000", "#3a6ea5"], { scale: 8 });
  const found = chunks(png);
  const ihdr = found.find((c) => c.type === "IHDR")!;
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  expect(view.getUint32(ihdr.start)).toBe(128);
  expect(view.getUint32(ihdr.start + 4)).toBe(128);
  expect(found.some((c) => c.type === "tRNS")).toBe(true);
});
