import { describe, expect, test } from "bun:test";
import { createGrid } from "@zenith/core";
import { encodeIndexedPng } from "./png";

/**
 * The size that used to throw.
 *
 * `push(...array)` passes every element as an argument, so the encoder overflowed
 * the call stack once the image reached a few hundred thousand bytes — which a
 * 32x32 asset exported at 32x is. Small exports worked, so the failure only
 * appeared at the scales anyone would actually ship.
 */
describe("large exports", () => {
  test("encodes a 1024x1024 indexed PNG without overflowing the stack", () => {
    const grid = createGrid(32, 32);
    for (let i = 0; i < grid.cells.length; i += 1) grid.cells[i] = i % 16;
    const palette = Array.from({ length: 16 }, (_, i) => `#${i.toString(16).repeat(6)}`);

    const bytes = encodeIndexedPng(grid, palette, { scale: 32 });

    // Signature, then a valid IHDR declaring the scaled dimensions.
    expect([...bytes.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(view.getUint32(16)).toBe(1024);
    expect(view.getUint32(20)).toBe(1024);
    // Colour type 3 — still indexed at scale, not flattened to RGB.
    expect(bytes[25]).toBe(3);
    expect(bytes.length).toBeGreaterThan(1_000_000);
  });
})
