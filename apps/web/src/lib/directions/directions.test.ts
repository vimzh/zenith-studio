import { describe, expect, test } from "bun:test";
import { encodeGrid, gridFromRows } from "@zenith/core";
import {
  DIRECTIONS,
  DIRECTION_SETS,
  generationCount,
  mirrorGrid,
  mirrorableFrom,
  mirrorOf,
  planDirectionSet,
  type Direction,
} from "./model";

describe("mirrorOf", () => {
  test("pairs the six directions that have a horizontal partner", () => {
    expect(mirrorOf("east")).toBe("west");
    expect(mirrorOf("west")).toBe("east");
    expect(mirrorOf("north-east")).toBe("north-west");
    expect(mirrorOf("south-west")).toBe("south-east");
  });

  test("north and south have no partner — they face the camera", () => {
    expect(mirrorOf("north")).toBeNull();
    expect(mirrorOf("south")).toBeNull();
  });

  test("is an involution wherever it is defined", () => {
    for (const direction of DIRECTIONS) {
      const partner = mirrorOf(direction);
      if (partner !== null) {
        expect(mirrorOf(partner)).toBe(direction);
      }
    }
  });
});

describe("mirrorGrid", () => {
  test("flips horizontally", () => {
    const grid = gridFromRows(["012", "345"]);
    expect(encodeGrid(mirrorGrid(grid))).toBe("210\n543");
  });

  test("is lossless — mirroring twice returns the original", () => {
    const grid = gridFromRows(["01.3", "4.67", "89AB"]);
    expect(encodeGrid(mirrorGrid(mirrorGrid(grid)))).toBe(encodeGrid(grid));
  });

  test("preserves transparency rather than filling it", () => {
    const grid = gridFromRows(["0..1"]);
    expect(encodeGrid(mirrorGrid(grid))).toBe("1..0");
  });

  test("preserves dimensions", () => {
    const grid = gridFromRows(["012345", "678901"]);
    const flipped = mirrorGrid(grid);
    expect(flipped.width).toBe(6);
    expect(flipped.height).toBe(2);
  });

  test("a symmetric grid is its own mirror", () => {
    const grid = gridFromRows(["0110", "2332"]);
    expect(encodeGrid(mirrorGrid(grid))).toBe(encodeGrid(grid));
  });
});

describe("planDirectionSet", () => {
  test("eight directions cost five generations, not eight", () => {
    // The entire argument for preferring the mirror path.
    const plan = planDirectionSet([], "ordinal8");
    expect(plan).toHaveLength(8);
    expect(generationCount(plan)).toBe(5);
    expect(plan.filter((step) => step.method === "mirror")).toHaveLength(3);
  });

  test("four cardinal directions cost three generations", () => {
    const plan = planDirectionSet([], "cardinal4");
    expect(generationCount(plan)).toBe(3);
    expect(plan.find((step) => step.direction === "west")).toMatchObject({
      method: "mirror",
      from: "east",
    });
  });

  test("a side-on pair costs one generation", () => {
    const plan = planDirectionSet([], "side2");
    expect(generationCount(plan)).toBe(1);
  });

  test("an existing direction is reused rather than regenerated", () => {
    const plan = planDirectionSet(["south"], "cardinal4");
    expect(plan.find((step) => step.direction === "south")?.method).toBe("have");
    expect(generationCount(plan)).toBe(2);
  });

  test("an existing direction unlocks its mirror for free", () => {
    const plan = planDirectionSet(["east"], "side2");
    expect(generationCount(plan)).toBe(0);
    expect(plan.find((step) => step.direction === "west")).toMatchObject({
      method: "mirror",
      from: "east",
    });
  });

  test("a complete set needs nothing", () => {
    const plan = planDirectionSet([...DIRECTIONS], "ordinal8");
    expect(generationCount(plan)).toBe(0);
    expect(plan.every((step) => step.method === "have")).toBe(true);
  });

  test("every planned direction belongs to the requested set", () => {
    for (const set of ["side2", "cardinal4", "ordinal8"] as const) {
      const planned = planDirectionSet([], set).map((step) => step.direction);
      expect(planned).toEqual([...DIRECTION_SETS[set]] as Direction[]);
    }
  });

  test("a mirror source is never itself a direction still awaiting generation later", () => {
    // Ordering matters: a step may only mirror from something already resolved.
    const resolved = new Set<Direction>();
    for (const step of planDirectionSet([], "ordinal8")) {
      if (step.method === "mirror") {
        expect(resolved.has(step.from as Direction)).toBe(true);
      }
      resolved.add(step.direction);
    }
  });
});

describe("mirrorableFrom", () => {
  test("a cardinal set from its base alone can mirror nothing", () => {
    // north has no partner, and west's partner (east) needs a model first — so
    // the optimistic plan's "1 mirror" is unreachable without generation.
    expect(mirrorableFrom(["north"], "cardinal4")).toEqual([]);
  });

  test("but a full plan still counts that mirror, which is the trap", () => {
    const plan = planDirectionSet(["north"], "cardinal4");
    expect(plan.filter((step) => step.method === "mirror")).toHaveLength(1);
    expect(mirrorableFrom(["north"], "cardinal4")).toHaveLength(0);
  });

  test("an east-facing sprite reaches west for free", () => {
    expect(mirrorableFrom(["east"], "side2")).toEqual(["west"]);
  });

  test("resolves transitively, to a fixed point", () => {
    // south-east mirrors to south-west; both are reachable from the pair given.
    const reachable = mirrorableFrom(["north-east", "south-east"], "ordinal8");
    expect(reachable).toContain("north-west");
    expect(reachable).toContain("south-west");
  });

  test("a complete set has nothing left to mirror", () => {
    expect(mirrorableFrom([...DIRECTIONS], "ordinal8")).toEqual([]);
  });
});
