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
  commitInpaintResult,
  protectedInpaintColors,
} from "./inpaint";
import { mergePalette } from "./generation";
import { session } from "@/lib/editor";

const REGION: Region = { x: 1, y: 1, width: 2, height: 2 };
const PALETTE = ["#000000", "#ffffff"];

describe("inpainting boundaries", () => {
  test("rejects a model result that erases the body instead of recolouring it", () => {
    const store = createStore(createDocument({ width: 128, height: 128, palette: PALETTE }));
    store.fillRegion({ x: 40, y: 10, width: 40, height: 110 }, 1);
    store.clearHistory();
    const before = store.encode();
    const broken = store.readComposite();
    for (let y = 12; y < 70; y++) broken.cells.fill(TRANSPARENT, y * 128 + 40, y * 128 + 80);

    expect(() => applyInpaintRegion(store, broken, { x: 32, y: 12, width: 90, height: 100 }))
      .toThrow("removed");
    expect(store.encode()).toBe(before);
    expect(store.canUndo).toBe(false);
  });

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

describe("inpaint commit safety", () => {
  function fixture() {
    const id = session.create({ name: "inpaint commit QA", type: "character", width: 4, height: 4, palette: PALETTE });
    const store = session.get(id)!;
    store.fillRegion({ x: 0, y: 0, width: 4, height: 4 }, 0);
    store.fillRegion(REGION, 1);
    store.clearHistory();
    return { id, store, revision: store.revision, frame: store.activeFrame, layer: store.activeLayer };
  }

  test("only colours outside the mask stay reserved; palette plus edit undo together", () => {
    const target = fixture();
    expect([...protectedInpaintColors(target.store, REGION)]).toEqual([0]);
    const before = target.store.encode();
    const edited = target.store.readComposite();
    edited.cells[5] = 0;
    commitInpaintResult(target, edited, ["#000000", "#aa44cc"], REGION);
    expect(target.store.palette.colors[1]?.hex).toBe("#aa44cc");
    expect(session.get(target.id)).toBe(target.store);
    expect(target.store.history()).toEqual(["inpaint_region"]);
    target.store.undo();
    expect(target.store.encode()).toBe(before);
    expect(target.store.palette.colors.map(c => c.hex)).toEqual(PALETTE);
    target.store.redo();
    expect(target.store.palette.colors[1]?.hex).toBe("#aa44cc");
  });

  test("reports an unchanged result without promising undo of the preceding edit", () => {
    const target = fixture();
    target.store.setPixels([{ x: 0, y: 0, index: 1 }]);
    const revision = target.store.revision;
    const before = target.store.encode();
    const history = target.store.history();

    expect(() => commitInpaintResult({ ...target, revision }, target.store.readComposite(), PALETTE, REGION))
      .toThrow("No undo entry was created");
    expect(target.store.revision).toBe(revision);
    expect(target.store.encode()).toBe(before);
    expect(target.store.history()).toEqual(history);
  });

  test("a palette-only recolour is a real undoable edit even with zero index changes", () => {
    const target = fixture();
    expect(commitInpaintResult(target, target.store.readComposite(), ["#000000", "#aa44cc"], REGION)).toBe(0);
    expect(target.store.revision).toBeGreaterThan(target.revision);
    expect(target.store.history()).toEqual(["inpaint_region"]);
    expect(target.store.palette.colors[1]?.hex).toBe("#aa44cc");
    target.store.undo();
    expect(target.store.palette.colors.map(color => color.hex)).toEqual(PALETTE);
  });

  test("refuses stale pixel, palette, frame or asset targets without applying anything", () => {
    for (const change of ["pixels", "palette", "frame", "asset"] as const) {
      const target = fixture();
      const edited = target.store.readComposite();
      if (change === "pixels") target.store.setPixels([{ x: 0, y: 0, index: 1 }]);
      if (change === "palette") session.setPaletteColor(target.id, 0, "#112233");
      if (change === "frame") { target.store.addFrame({ copyFrom: 0 }); target.store.selectFrame(1); }
      if (change === "asset") session.create({ name: "other QA" });
      const current = session.get(target.id)!;
      const before = current.encode();
      expect(() => commitInpaintResult(target, edited, ["#000000", "#aa44cc"], REGION)).toThrow("changed while generating");
      expect(current.encode()).toBe(before);
      expect(current.palette.colors.some(c => c.hex === "#aa44cc")).toBe(false);
    }
  });

  test("intentional erasure is explicit and undoable", () => {
    const target = fixture();
    const generated = createGrid(4, 4, TRANSPARENT);
    expect(() => applyInpaintRegion(target.store, generated, REGION)).toThrow("removed");
    expect(applyInpaintRegion(target.store, generated, REGION, true)).toBe(4);
    target.store.undo();
    expect(target.store.readComposite().cells[5]).toBe(1);
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

  test("never overwrites a reclaimed colour that the edit still uses", () => {
    const protectedSlots = new Set(BUSH.map((_, index) => index).filter(index => index !== 5));
    for (const incoming of [[BUSH[5]!, "#b43ef8"], ["#b43ef8", BUSH[5]!]]) {
      const merge = mergePalette(BUSH, incoming, protectedSlots);
      expect(merge.colors[5]).toBe(BUSH[5]);
      expect(merge.unmatched).toContain("#b43ef8");
    }
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
