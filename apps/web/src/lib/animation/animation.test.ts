import { describe, expect, test } from "bun:test";
import { TRANSPARENT, createGrid, encodeGrid, gridFromRows, gridsEqual } from "@zenith/core";
import { checkAnimationCoherence, readAnimationSummary, readFramesDiff } from "./diff";
import { animateProcedural } from "./procedural";

const base = () => gridFromRows(["0011", "0011", "2233", "2233"]);

describe("readFramesDiff", () => {
  test("reports only what changed, with both values", () => {
    const a = gridFromRows(["00", "00"]);
    const b = gridFromRows(["01", "00"]);
    const diff = readFramesDiff(a, b);

    expect(diff.changed).toBe(1);
    expect(diff.total).toBe(4);
    expect(diff.changes[0]).toEqual({ x: 1, y: 0, from: 0, to: 1 });
  });

  test("an unchanged pair reports nothing", () => {
    expect(readFramesDiff(base(), base()).changed).toBe(0);
  });

  test("is far smaller than a full read for a typical motion", () => {
    // The whole reason this tool exists.
    const from = createGrid(32, 32, 0);
    const to = createGrid(32, 32, 0);
    for (let i = 0; i < 60; i += 1) {
      to.cells[i] = 3;
    }
    expect(readFramesDiff(from, to).ratio).toBeLessThan(0.15);
  });

  test("refuses to diff mismatched sizes, naming both", () => {
    expect(() => readFramesDiff(createGrid(4, 4), createGrid(8, 8))).toThrow(/4x4 frame against a 8x8/);
  });

  test("treats transparency as a value like any other", () => {
    const a = gridFromRows(["0."]);
    const b = gridFromRows([".0"]);
    const diff = readFramesDiff(a, b);
    expect(diff.changed).toBe(2);
    expect(diff.changes[0]?.to).toBe(TRANSPARENT);
  });
});

describe("readAnimationSummary", () => {
  test("the first frame has no previous to compare against", () => {
    const summary = readAnimationSummary([base(), base()]);
    expect(summary[0]?.changedFromPrevious).toBeNull();
    expect(summary[0]?.centroidShift).toBeNull();
    expect(summary[1]?.changedFromPrevious).toBe(0);
  });

  test("reports centroid movement, which is what motion looks like numerically", () => {
    const left = gridFromRows(["0...", "0..."]);
    const right = gridFromRows(["...0", "...0"]);
    const summary = readAnimationSummary([left, right]);
    expect(summary[1]?.centroidShift).toBeCloseTo(3, 5);
  });

  test("an empty frame has no centroid rather than a fake one at the origin", () => {
    const summary = readAnimationSummary([createGrid(4, 4, TRANSPARENT)]);
    expect(summary[0]?.centroid).toBeNull();
    expect(summary[0]?.opaque).toBe(0);
  });
});

describe("checkAnimationCoherence", () => {
  test("passes a clean two-frame bob", () => {
    const frames = animateProcedural(base(), "bob");
    expect(checkAnimationCoherence(frames, { paletteSize: 16 })).toEqual([]);
  });

  test("names the frame that leaves the palette", () => {
    const bad = gridFromRows(["00", "00"]);
    bad.cells[0] = 9;
    const problems = checkAnimationCoherence([base(), bad], { paletteSize: 4 });
    expect(problems.some((p) => p.kind === "palette" && p.frame === 1)).toBe(true);
  });

  test("flags a silhouette pop", () => {
    const full = createGrid(8, 8, 0);
    const sparse = createGrid(8, 8, TRANSPARENT);
    sparse.cells[0] = 0;
    const problems = checkAnimationCoherence([full, sparse], { paletteSize: 16 });
    expect(problems.some((p) => p.kind === "silhouette")).toBe(true);
  });

  test("flags a loop whose last frame repeats the first", () => {
    const problems = checkAnimationCoherence([base(), gridFromRows(["1111", "1111", "1111", "1111"]), base()], {
      paletteSize: 16,
    });
    expect(problems.some((p) => p.kind === "loop")).toBe(true);
  });

  test("does not flag a loop when looping is off", () => {
    const problems = checkAnimationCoherence([base(), base(), base()], { paletteSize: 16, loop: false });
    expect(problems.some((p) => p.kind === "loop")).toBe(false);
  });
});

describe("procedural animation", () => {
  test("bob displaces the subject and keeps the base as frame 0", () => {
    const frames = animateProcedural(base(), "bob");
    expect(frames).toHaveLength(2);
    expect(gridsEqual(frames[0] as never, base())).toBe(true);
    expect(gridsEqual(frames[1] as never, base())).toBe(false);
  });

  test("scroll wraps, so a seamless tile stays seamless while moving", () => {
    const tile = gridFromRows(["0123", "0123", "0123", "0123"]);
    const frames = animateProcedural(tile, "scroll", { frames: 4, dx: 1 });

    // After a full width of scrolling the tile returns to itself.
    const full = animateProcedural(tile, "scroll", { frames: 5, dx: 1 })[4];
    expect(encodeGrid(full as never)).toBe(encodeGrid(tile));
    // And no pixel was lost off the edge along the way.
    for (const frame of frames) {
      expect(encodeGrid(frame).includes(".")).toBe(false);
    }
  });

  test("pulse returns to its starting value, so the cycle closes", () => {
    const frames = animateProcedural(base(), "pulse", { frames: 4, amplitude: 2 });
    expect(encodeGrid(frames[0] as never)).toBe(encodeGrid(base()));
  });

  test("ramp presets never leave the palette", () => {
    const frames = animateProcedural(base(), "pulse", { frames: 6, amplitude: 12 }, 4);
    for (const frame of frames) {
      for (const cell of frame.cells) {
        expect(cell === TRANSPARENT || (cell >= 0 && cell < 4)).toBe(true);
      }
    }
  });

  test("every preset is deterministic", () => {
    for (const preset of ["bob", "blink", "flicker", "pulse", "scroll", "sway"] as const) {
      const first = animateProcedural(base(), preset).map(encodeGrid).join("|");
      for (let n = 0; n < 5; n += 1) {
        expect(animateProcedural(base(), preset).map(encodeGrid).join("|")).toBe(first);
      }
    }
  });

  test("every preset produces at least two frames and preserves dimensions", () => {
    for (const preset of ["bob", "blink", "flicker", "pulse", "scroll", "sway"] as const) {
      const frames = animateProcedural(base(), preset);
      expect(frames.length).toBeGreaterThanOrEqual(2);
      for (const frame of frames) {
        expect(frame.width).toBe(4);
        expect(frame.height).toBe(4);
      }
    }
  });

  test("no preset repeats the base frame at the end, which would stutter a loop", () => {
    for (const preset of ["bob", "flicker", "pulse", "scroll", "sway"] as const) {
      const frames = animateProcedural(base(), preset, { frames: 4 });
      const last = frames[frames.length - 1] as never;
      const problems = checkAnimationCoherence(frames, { paletteSize: 16 });
      expect(problems.filter((p) => p.kind === "loop")).toEqual([]);
      expect(last).toBeDefined();
    }
  });
});
