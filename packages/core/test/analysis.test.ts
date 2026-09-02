import { describe, expect, test } from "bun:test";
import {
  SEAM_FAILURE,
  SEAM_TOLERANCE,
  checkSeamlessTiling,
  createGrid,
  decodeGrid,
  describeSeamMismatch,
  type Grid,
} from "../src/index";

describe("checkSeamlessTiling", () => {
  test("passes a tile whose seam pairings occur inside it", () => {
    // Mortar (0) runs to both edges, so the wrap puts stone beside mortar —
    // a pairing that occurs all over the interior.
    const grid = decodeGrid(["0000", "0110", "0110", "0000"].join("\n"));
    const report = checkSeamlessTiling(grid);
    expect(report.seamless).toBe(true);
    expect(report.leftRight.mismatches).toEqual([]);
    expect(report.topBottom.mismatches).toEqual([]);
    expect(report.leftRight.checked).toBe(4);
  });

  test("passes a uniform fill", () => {
    expect(checkSeamlessTiling(decodeGrid("2222\n2222\n2222\n2222")).seamless).toBe(true);
  });

  test("fails a left-to-right gradient and names both pixels", () => {
    const grid = decodeGrid(["0123", "0123", "0123", "0123"].join("\n"));
    const report = checkSeamlessTiling(grid);

    expect(report.seamless).toBe(false);
    expect(report.leftRight.pass).toBe(false);
    expect(report.leftRight.mismatches).toHaveLength(4);
    // Every row wraps 3 onto 0, a pairing that appears nowhere inside.
    expect(report.leftRight.mismatches[0]).toMatchObject({
      position: 0,
      from: 3,
      to: 0,
      fromXY: [3, 0],
      toXY: [0, 0],
    });
    // The vertical direction is uniform, so that seam is fine.
    expect(report.topBottom.pass).toBe(true);
  });

  test("fails a top-to-bottom gradient on the other axis only", () => {
    const report = checkSeamlessTiling(decodeGrid(["0000", "1111", "2222", "3333"].join("\n")));
    expect(report.leftRight.pass).toBe(true);
    expect(report.topBottom.pass).toBe(false);
    expect(report.topBottom.mismatches).toHaveLength(4);
    expect(report.topBottom.mismatches[0]).toMatchObject({ position: 0, from: 3, to: 0 });
  });

  test("reports only the rows that actually break", () => {
    // Row 1 is the only one whose wrap creates an unseen pairing.
    const grid = decodeGrid(["0110", "2003", "0110", "0110"].join("\n"));
    const report = checkSeamlessTiling(grid);
    expect(report.leftRight.mismatches.map((mismatch) => mismatch.position)).toEqual([1]);
  });

  test("a fix turns a failing seam into a passing one", () => {
    const broken = decodeGrid(["0123", "0123", "0123", "0123"].join("\n"));
    expect(checkSeamlessTiling(broken).seamless).toBe(false);

    // Bridging the seam means more than making the edges equal: the wrap
    // produces a 0-beside-0 pairing, so the tile has to contain one too.
    expect(checkSeamlessTiling(decodeGrid(["0120", "0120", "0120", "0120"].join("\n"))).seamless).toBe(false);

    const fixed = decodeGrid(["0010", "0010", "0010", "0010"].join("\n"));
    expect(checkSeamlessTiling(fixed).seamless).toBe(true);
  });

  test("transparency is a value like any other", () => {
    const report = checkSeamlessTiling(decodeGrid(["..11", "..11", "..11", "..11"].join("\n")));
    // 1 wrapping onto '.' never occurs inside, where the only pairings are .., .1 and 11.
    expect(report.leftRight.pass).toBe(false);
  });

  test("describes a mismatch with both coordinates and both characters", () => {
    const report = checkSeamlessTiling(decodeGrid(["0123", "0123", "0123", "0123"].join("\n")));
    expect(describeSeamMismatch(report.leftRight.mismatches[0]!, "leftRight")).toBe(
      "row 0: (3, 0)='3' wraps onto (0, 0)='0'",
    );
  });

  test("rejects a grid too small to have an interior", () => {
    expect(() => checkSeamlessTiling(decodeGrid("01"))).toThrow(/at least 2x2/);
  });
});

/**
 * How sensitive the check is, measured rather than assumed.
 *
 * Its strictness scales with palette size, which nothing in the name suggests.
 * A seam pairing is accepted when it occurs in the interior; with 4 colours all
 * 16 possible ordered pairs appear in any 32x32 tile, so it is permissive, and
 * with 16 colours there are 256 possible pairs against ~992 skewed interior
 * samples, so an ordinary pairing can be absent by chance and flip the verdict.
 *
 * The consequence: `seamless` is unreliable on 16-colour art and the mismatch
 * COUNT is the usable signal. These tests pin the gap between the two so a
 * change that narrows or widens it is visible.
 */
describe("sensitivity to palette size", () => {
  function random(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** Seamless by construction: every cell is a function of (x mod w, y mod h). */
  function wrapped(size: number, colours: number, seed: number): Grid {
    const grid = createGrid(size, size);
    const next = random(seed);
    const jitter = Array.from({ length: size * size }, () => Math.floor(next() * colours));
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const wave = Math.sin((x / size) * Math.PI * 2) + Math.cos((y / size) * Math.PI * 2);
        const base = Math.floor(((wave + 2) / 4) * (colours - 1));
        const value = base + ((jitter[y * size + x] as number) % 3) - 1;
        grid.cells[y * size + x] = Math.max(0, Math.min(colours - 1, value));
      }
    }
    return grid;
  }

  function meanMismatches(colours: number): number {
    let total = 0;
    for (let seed = 1; seed <= 25; seed += 1) {
      const report = checkSeamlessTiling(wrapped(32, colours, seed));
      total += report.leftRight.mismatches.length + report.topBottom.mismatches.length;
    }
    return total / 25;
  }

  test("reports few mismatches on textures that tile by construction", () => {
    // Never zero at 16 colours — but always small, which is the usable property.
    expect(meanMismatches(4)).toBeLessThan(1);
    expect(meanMismatches(8)).toBeLessThan(1.5);
    expect(meanMismatches(16)).toBeLessThan(3);
  });

  test("a real seam is an order of magnitude worse than the false-positive floor", () => {
    const gradient = createGrid(32, 32);
    for (let y = 0; y < 32; y += 1) {
      for (let x = 0; x < 32; x += 1) {
        gradient.cells[y * 32 + x] = Math.min(15, Math.floor((x / 32) * 16));
      }
    }
    const report = checkSeamlessTiling(gradient);

    // Every row fails, against a mean under 1 for genuinely seamless art.
    expect(report.leftRight.mismatches).toHaveLength(32);
    expect(report.leftRight.mismatches.length).toBeGreaterThan(meanMismatches(16) * 10);
  });
});

/**
 * Thresholds pinned against real measurements, not taste.
 *
 * From a batch of 20 model-generated textures, all of which tile acceptably:
 * mismatch counts were 0,1,1,1,1,1,2,2,3,3,3,3,3,4,5,5,5,5,5,6 of 64 seam
 * positions — a maximum of 9%. A deliberately chunkier re-generation reached
 * 11-18 (17-28%) and tiles visibly worse without being broken. A left-dark to
 * right-light gradient fails 100% of an edge.
 *
 * 12% and 40% sit in the empty gaps between those three populations. If a future
 * change moves a real case across a boundary, these fail.
 */
describe("graded verdict", () => {
  test("the tolerances leave room either side of the measured populations", () => {
    const positions = 64;
    // The worst texture in a batch that all tiled acceptably.
    expect(6 / positions).toBeLessThan(SEAM_TOLERANCE);
    // The chunky re-generations, which tile worse but are usable.
    expect(11 / positions).toBeGreaterThan(SEAM_TOLERANCE);
    expect(18 / positions).toBeLessThan(SEAM_FAILURE);
    // A genuine seam.
    expect(32 / positions).toBeGreaterThan(SEAM_FAILURE);
  });

  /** The 56% false-positive rate this replaced. */
  test("calls every construction-seamless texture seamless at 16 colours", () => {
    function random(seed: number): () => number {
      let state = seed >>> 0;
      return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }
    function wrapped(seed: number): Grid {
      const grid = createGrid(32, 32);
      const next = random(seed);
      const jitter = Array.from({ length: 1024 }, () => Math.floor(next() * 16));
      for (let y = 0; y < 32; y += 1) {
        for (let x = 0; x < 32; x += 1) {
          const wave = Math.sin((x / 32) * Math.PI * 2) + Math.cos((y / 32) * Math.PI * 2);
          const base = Math.floor(((wave + 2) / 4) * 15);
          grid.cells[y * 32 + x] = Math.max(0, Math.min(15, base + ((jitter[y * 32 + x] as number) % 3) - 1));
        }
      }
      return grid;
    }

    const notSeamless: number[] = [];
    for (let seed = 1; seed <= 25; seed += 1) {
      if (checkSeamlessTiling(wrapped(seed)).verdict !== "seamless") notSeamless.push(seed);
    }
    expect(notSeamless).toEqual([]);
  });

  test("still calls a real seam a seam", () => {
    const gradient = createGrid(32, 32);
    for (let y = 0; y < 32; y += 1) {
      for (let x = 0; x < 32; x += 1) gradient.cells[y * 32 + x] = Math.min(15, Math.floor((x / 32) * 16));
    }
    const report = checkSeamlessTiling(gradient);
    expect(report.verdict).toBe("seam");
    expect(report.seamless).toBe(false);
    // The coordinates are still every one of them — grading changed the verdict,
    // not what gets reported.
    expect(report.leftRight.mismatches).toHaveLength(32);
  });
});
