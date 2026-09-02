import { describe, expect, test } from "bun:test";
import { TRANSPARENT, createGrid, encodeGrid, gridFromRows } from "@zenith/core";
import { interpolateFrames } from "./interpolate";
import { encodeGif } from "./gif";
import { animateProcedural } from "./procedural";
import { checkAnimationCoherence } from "./diff";

describe("interpolateFrames", () => {
  test("moves a pixel part of the way, not all or nothing", () => {
    const from = gridFromRows(["0...."]);
    const to = gridFromRows(["....0"]);
    const [middle] = interpolateFrames(from, to, 1);
    expect(encodeGrid(middle as never)).toBe("..0..");
  });

  test("returns exactly the requested count, excluding both endpoints", () => {
    const from = gridFromRows(["0......."]);
    const to = gridFromRows([".......0"]);
    const frames = interpolateFrames(from, to, 3);
    expect(frames).toHaveLength(3);
    expect(encodeGrid(frames[0] as never)).not.toBe(encodeGrid(from));
    expect(encodeGrid(frames[2] as never)).not.toBe(encodeGrid(to));
  });

  test("never invents a colour outside the two frames", () => {
    const from = gridFromRows(["33...", "33..."]);
    const to = gridFromRows(["...99", "...99"]);
    for (const frame of interpolateFrames(from, to, 4)) {
      for (const cell of frame.cells) {
        expect(cell === TRANSPARENT || cell === 3 || cell === 9).toBe(true);
      }
    }
  });

  test("identical frames interpolate to themselves rather than inventing motion", () => {
    const grid = gridFromRows(["012", "345"]);
    for (const frame of interpolateFrames(grid, grid, 3)) {
      expect(encodeGrid(frame)).toBe(encodeGrid(grid));
    }
  });

  test("refuses mismatched sizes, naming both", () => {
    expect(() => interpolateFrames(createGrid(4, 4), createGrid(8, 8), 1)).toThrow(
      /4x4 frame and a 8x8/
    );
  });

  test("rejects a non-positive step count", () => {
    const grid = createGrid(4, 4);
    expect(() => interpolateFrames(grid, grid, 0)).toThrow(/positive integer/);
    expect(() => interpolateFrames(grid, grid, 1.5)).toThrow(/positive integer/);
  });

  test("is deterministic", () => {
    const from = gridFromRows(["0..1", "0..1"]);
    const to = gridFromRows(["1..0", "1..0"]);
    const first = interpolateFrames(from, to, 3).map(encodeGrid).join("|");
    for (let n = 0; n < 5; n += 1) {
      expect(interpolateFrames(from, to, 3).map(encodeGrid).join("|")).toBe(first);
    }
  });
});

describe("encodeGif", () => {
  const palette = ["#000000", "#ff0000", "#00ff00", "#0000ff"];
  const frames = animateProcedural(gridFromRows(["0123", "1230", "2301", "3012"]), "scroll", {
    frames: 4,
  });

  test("writes a GIF89a header and a trailer", () => {
    const bytes = encodeGif(frames, palette);
    expect(String.fromCharCode(...bytes.slice(0, 6))).toBe("GIF89a");
    expect(bytes[bytes.length - 1]).toBe(0x3b);
  });

  test("declares the document's dimensions, scaled", () => {
    const bytes = encodeGif(frames, palette, { scale: 4 });
    const width = (bytes[6] as number) | ((bytes[7] as number) << 8);
    const height = (bytes[8] as number) | ((bytes[9] as number) << 8);
    expect(width).toBe(16);
    expect(height).toBe(16);
  });

  test("includes the Netscape looping extension", () => {
    const bytes = encodeGif(frames, palette);
    const text = String.fromCharCode(...bytes);
    expect(text).toContain("NETSCAPE2.0");
  });

  test("emits one graphic control extension per frame", () => {
    const bytes = encodeGif(frames, palette);
    let count = 0;
    for (let i = 0; i < bytes.length - 1; i += 1) {
      if (bytes[i] === 0x21 && bytes[i + 1] === 0xf9) {
        count += 1;
      }
    }
    expect(count).toBe(frames.length);
  });

  test("reserves a palette slot for transparency beyond the colours given", () => {
    // 4 colours + 1 transparent needs an 8-entry table: 3 bits.
    const bytes = encodeGif(frames, palette);
    expect((bytes[10] as number) & 0x07).toBe(2); // bits - 1
    expect(bytes[11]).toBe(4); // background/transparent index sits past the palette
  });

  test("is deterministic", () => {
    const first = encodeGif(frames, palette);
    for (let n = 0; n < 3; n += 1) {
      expect(Array.from(encodeGif(frames, palette))).toEqual(Array.from(first));
    }
  });

  test("refuses an empty animation", () => {
    expect(() => encodeGif([], palette)).toThrow(/at least one frame/);
  });

  test("refuses frames that disagree on size", () => {
    expect(() => encodeGif([createGrid(4, 4), createGrid(8, 8)], palette)).toThrow(
      /share the document's dimensions/
    );
  });

  test("handles a fully transparent frame without corrupting the stream", () => {
    const blank = createGrid(4, 4, TRANSPARENT);
    const bytes = encodeGif([blank], palette);
    expect(String.fromCharCode(...bytes.slice(0, 6))).toBe("GIF89a");
    expect(bytes[bytes.length - 1]).toBe(0x3b);
  });

  test("handles a full 16-colour palette, the format's own cap for us", () => {
    const full = Array.from({ length: 16 }, (_, i) => `#${i.toString(16).repeat(6)}`);
    const grid = createGrid(8, 8, 0);
    for (let i = 0; i < grid.cells.length; i += 1) {
      grid.cells[i] = (i % 16) as never;
    }
    const bytes = encodeGif([grid], full);
    // 16 colours + transparency needs 32 entries: 5 bits.
    expect((bytes[10] as number) & 0x07).toBe(4);
    expect(bytes[bytes.length - 1]).toBe(0x3b);
  });
});

describe("authoring end to end", () => {
  test("a procedural cycle encodes to a coherent, loopable GIF", () => {
    const base = gridFromRows(["0011", "0011", "2233", "2233"]);
    const frames = animateProcedural(base, "bob", { frames: 4 });

    expect(checkAnimationCoherence(frames, { paletteSize: 4 })).toEqual([]);
    const bytes = encodeGif(frames, ["#000000", "#444444", "#888888", "#ffffff"], { scale: 8 });
    expect(bytes.length).toBeGreaterThan(64);
    expect(bytes[bytes.length - 1]).toBe(0x3b);
  });
});
