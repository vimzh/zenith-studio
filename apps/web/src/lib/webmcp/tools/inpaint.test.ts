import { describe, expect, test } from "bun:test";
import {
  TRANSPARENT,
  createDocument,
  createGrid,
  createStore,
  type Region,
} from "@zenith/core";
import {
  applyInpaintRegion,
  createInpaintMask,
  encodeInpaintInputs,
  inpaintInstruction,
  regionColors,
} from "./inpaint";
import { mergePalette } from "./generation";

const REGION: Region = { x: 1, y: 1, width: 2, height: 2 };
const PALETTE = ["#000000", "#ffffff"];

describe("inpainting boundaries", () => {
  test("encodes source and mask at the same integer-scaled dimensions", () => {
    const grid = createGrid(4, 3, 0);
    const inputs = encodeInpaintInputs(grid, PALETTE, REGION);
    const dimensions = (png: Uint8Array) => [
      new DataView(png.buffer, png.byteOffset + 16, 8).getUint32(0),
      new DataView(png.buffer, png.byteOffset + 16, 8).getUint32(4),
    ];

    expect(dimensions(inputs.source)).toEqual([1024, 768]);
    expect(dimensions(inputs.mask)).toEqual(dimensions(inputs.source));

    const mask = createInpaintMask(grid, REGION);
    expect(Array.from(mask.cells)).toEqual([
      0, 0, 0, 0,
      0, TRANSPARENT, TRANSPARENT, 0,
      0, TRANSPARENT, TRANSPARENT, 0,
    ]);
  });

  test("merges only the selected cells and one undo restores the frame", () => {
    const store = createStore(
      createDocument({ width: 4, height: 3, palette: PALETTE }),
    );
    store.fillRegion({ x: 0, y: 0, width: 4, height: 3 }, 0);
    store.clearHistory();
    const before = store.encode();
    const generated = createGrid(4, 3, 1);

    expect(applyInpaintRegion(store, generated, REGION)).toBe(4);
    expect(store.encode()).toBe("0000\n0110\n0110");
    expect(store.history()).toEqual(["inpaint_region"]);
    expect(store.undo()).toBe("inpaint_region");
    expect(store.encode()).toBe(before);
  });

  test("gives the model the document palette before palette conformance", () => {
    expect(inpaintInstruction("add a hood", PALETTE)).toBe(
      "add a hood. Use only this exact existing palette in the finished edit: #000000, #ffffff.",
    );
  });
});

/**
 * The bug this file is named after, in the numbers that produced it.
 *
 * A bush generated into the general 16-colour preset used seven entries. Asked
 * for red cherries, the model was told to use only the existing palette, and
 * the conformance step remapped anything red anyway — so `#c0392b` became
 * `#96513c`, a brown, and the cherries came out orange. Nine palette slots were
 * unused at the time.
 */
describe("colours an edit needs but the palette does not have", () => {
  const BUSH = [
    "#14121c", "#2e2b3f", "#4d4a63", "#7b7893", "#b8b5c9", "#f2f0f5",
    "#5a2f2a", "#96513c", "#d98f5c", "#243f5c", "#3c6e99", "#74b4d4",
    "#254a2c", "#43854a", "#8cc464", "#d4b44a",
  ];
  // What a bush actually refers to: the dark outline and the greens.
  const used = new Set([0, 1, 12, 13, 14]);

  test("spends unused slots on the red rather than matching it to a brown", () => {
    const merge = mergePalette(BUSH, ["#c0392b", "#7d1f2b"], used);

    expect(merge.added).toEqual(["#c0392b", "#7d1f2b"]);
    expect(merge.unmatched).toEqual([]);
    // Sixteen colours in, sixteen out — and every colour the art uses is still
    // at the index its pixels point to.
    expect(merge.colors).toHaveLength(16);
    for (const index of used) expect(merge.colors[index]).toBe(BUSH[index] as string);
    expect(merge.colors).toContain("#c0392b");
    // Whatever it overwrote, nothing on the canvas was pointing at it.
    const replaced = merge.colors
      .map((colour, index) => (colour === BUSH[index] ? null : index))
      .filter((index): index is number => index !== null);
    expect(replaced.every((index) => !used.has(index))).toBe(true);
  });

  test("ignores a colour the palette can already express", () => {
    // 0.0011 away from #8cc464 — the same green, one byte off.
    expect(mergePalette(BUSH, ["#8cc465"], used).added).toEqual([]);
  });

  test("reports what it could not fit instead of silently remapping", () => {
    const full = new Set(BUSH.map((_, index) => index));
    const merge = mergePalette(BUSH, ["#c0392b"], full);

    expect(merge.added).toEqual([]);
    expect(merge.unmatched).toEqual(["#c0392b"]);
    expect(merge.colors).toEqual(BUSH);
  });

  test("the instruction stops forbidding new colours once there is room", () => {
    const locked = inpaintInstruction("add red cherries", PALETTE, 0);
    expect(locked).toContain("Use only this exact existing palette");

    const open = inpaintInstruction("add red cherries", PALETTE, 9);
    expect(open).not.toContain("Use only this exact existing palette");
    expect(open).toContain("at most 9");
    expect(open).toContain("rather than the nearest listed one");
  });

  /** Merging the whole result would spend every spare slot re-adding the source. */
  test("only the colours inside the mask count as new", () => {
    const grid = createGrid(4, 3, 0);
    grid.cells[1 * 4 + 1] = 1;
    expect(regionColors(grid, PALETTE, REGION)).toEqual(["#ffffff", "#000000"]);
    expect(regionColors(grid, PALETTE, { x: 3, y: 0, width: 1, height: 1 })).toEqual(["#000000"]);
  });
});
