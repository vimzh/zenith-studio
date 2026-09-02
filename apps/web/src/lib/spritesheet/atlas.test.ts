import { describe, expect, test } from "bun:test";
import { TRANSPARENT, createGrid, encodeGrid, gridFromRows } from "@zenith/core";
import { packSpritesheet, type SheetFrame } from "./atlas";

const frame = (name: string, rows: string[], tag?: string): SheetFrame => ({
  name,
  grid: gridFromRows(rows),
  tag,
});

describe("packSpritesheet", () => {
  test("lays frames out in a grid and reports each position", () => {
    const packed = packSpritesheet(
      [frame("a", ["00", "00"]), frame("b", ["11", "11"]), frame("c", ["22", "22"]), frame("d", ["33", "33"])],
      { columns: 2 }
    );

    expect(packed.sheet.width).toBe(4);
    expect(packed.sheet.height).toBe(4);
    expect(encodeGrid(packed.sheet)).toBe("0011\n0011\n2233\n2233");
    expect(packed.atlas.frames[3]?.frame).toEqual({ x: 2, y: 2, w: 2, h: 2 });
  });

  test("defaults to a roughly square layout", () => {
    const frames = Array.from({ length: 9 }, (_, i) => frame(`f${String(i)}`, ["0", "0"]));
    const packed = packSpritesheet(frames);
    expect(packed.atlas.meta.size).toEqual({ w: 3, h: 6 });
  });

  test("pads with transparency, not with a colour", () => {
    const packed = packSpritesheet([frame("a", ["00"]), frame("b", ["11"])], {
      columns: 2,
      padding: 1,
    });
    expect(packed.sheet.width).toBe(5);
    expect(encodeGrid(packed.sheet)).toBe("00.11");
  });

  test("leaves unused cells transparent when the last row is short", () => {
    const packed = packSpritesheet([frame("a", ["0"]), frame("b", ["1"]), frame("c", ["2"])], {
      columns: 2,
    });
    // 2x2 layout with 3 frames: the fourth cell must be empty, not colour 0.
    expect(encodeGrid(packed.sheet)).toBe("01\n2.");
  });

  test("groups contiguous tags into animation ranges", () => {
    const packed = packSpritesheet([
      frame("walk0", ["0"], "walk"),
      frame("walk1", ["1"], "walk"),
      frame("idle0", ["2"], "idle"),
    ]);
    expect(packed.atlas.meta.frameTags).toEqual([
      { name: "walk", from: 0, to: 1, direction: "forward" },
      { name: "idle", from: 2, to: 2, direction: "forward" },
    ]);
  });

  test("a tag appearing in two separate runs becomes two ranges, not one spanning range", () => {
    // One range would silently include the frames between the runs.
    const packed = packSpritesheet([
      frame("a", ["0"], "walk"),
      frame("b", ["1"], "idle"),
      frame("c", ["2"], "walk"),
    ]);
    expect(packed.atlas.meta.frameTags).toEqual([
      { name: "walk", from: 0, to: 0, direction: "forward" },
      { name: "idle", from: 1, to: 1, direction: "forward" },
      { name: "walk", from: 2, to: 2, direction: "forward" },
    ]);
  });

  test("untagged frames produce no ranges", () => {
    const packed = packSpritesheet([frame("a", ["0"]), frame("b", ["1"])]);
    expect(packed.atlas.meta.frameTags).toEqual([]);
  });

  test("carries per-frame duration through to the atlas", () => {
    const packed = packSpritesheet([
      { name: "a", grid: gridFromRows(["0"]), durationMs: 250 },
      { name: "b", grid: gridFromRows(["1"]) },
    ]);
    expect(packed.atlas.frames[0]?.duration).toBe(250);
    expect(packed.atlas.frames[1]?.duration).toBe(100);
  });

  test("refuses frames that disagree on size, naming the offender", () => {
    expect(() =>
      packSpritesheet([
        { name: "ok", grid: createGrid(4, 4) },
        { name: "wrong", grid: createGrid(8, 8) },
      ])
    ).toThrow(/Frame 'wrong' is 8x8 but the sheet cell is 4x4/);
  });

  test("refuses an empty sheet", () => {
    expect(() => packSpritesheet([])).toThrow(/at least one frame/);
  });

  test("preserves transparency inside a frame", () => {
    const packed = packSpritesheet([frame("a", ["0.", ".1"])]);
    expect(encodeGrid(packed.sheet)).toBe("0.\n.1");
    expect(packed.sheet.cells[1]).toBe(TRANSPARENT);
  });

  test("is deterministic", () => {
    const frames = [frame("a", ["01"]), frame("b", ["23"])];
    const first = JSON.stringify(packSpritesheet(frames).atlas);
    for (let n = 0; n < 5; n += 1) {
      expect(JSON.stringify(packSpritesheet(frames).atlas)).toBe(first);
    }
  });
});
