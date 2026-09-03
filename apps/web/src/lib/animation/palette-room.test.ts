import { describe, expect, test } from "bun:test";
import { TRANSPARENT, createGrid } from "@zenith/core";
import { MERGE_DISTANCE, paletteUsage, planPaletteRoom, seatEffectColours } from "./palette-room";

describe("planPaletteRoom", () => {
  // Two all-but-identical greys, two close browns, and colours far from everything.
  const palette = ["#808080", "#828282", "#723224", "#7d3d2d", "#ff0000", "#00ff00", "#0000ff", "#ffffff"];

  test("frees the closest near-duplicate pair first, emptying the less-used colour", () => {
    const usage = [500, 20, 40, 300, 1, 1, 1, 1];
    const [fold] = planPaletteRoom(palette, usage, 1);
    expect(fold?.from).toBe(1);
    expect(fold?.to).toBe(0);
    expect(fold?.distance).toBeLessThanOrEqual(MERGE_DISTANCE);
  });

  test("never chains two folds through one colour and stops at the slots wanted", () => {
    const usage = [1, 1, 1, 1, 1, 1, 1, 1];
    const folds = planPaletteRoom(palette, usage, 3);
    expect(folds.length).toBeLessThanOrEqual(3);
    const touched = folds.flatMap((fold) => [fold.from, fold.to]);
    expect(new Set(touched).size).toBe(touched.length);
    expect(folds.every((fold) => fold.distance <= MERGE_DISTANCE)).toBe(true);
    // Red, green, blue and white are far from everything and are never folded.
    expect(touched.some((index) => index >= 4)).toBe(false);
  });

  test("finds nothing to fold in a palette of distinct colours, or when no room is wanted", () => {
    expect(planPaletteRoom(["#ff0000", "#00ff00", "#0000ff"], [1, 1, 1], 2)).toEqual([]);
    expect(planPaletteRoom(palette, [1, 1, 1, 1, 1, 1, 1, 1], 0)).toEqual([]);
    expect(planPaletteRoom(["#ff0000"], [1], 1)).toEqual([]);
  });

  test("usage counts opaque pixels per index across every grid", () => {
    const a = createGrid(4, 4, TRANSPARENT);
    a.cells[0] = 2;
    a.cells[1] = 2;
    const b = createGrid(4, 4, 1);
    expect(paletteUsage([a, b], 3)).toEqual([0, 16, 2]);
  });
});

describe("seatEffectColours", () => {
  const boxer = ["#020101", "#0d0605", "#290e0c", "#151930", "#520e0d", "#5e2d1c", "#8a0b13", "#b50b16", "#616374", "#c16034", "#ec171f", "#9595a3", "#e48446", "#c4c2cf", "#fab373", "#efebec"];
  const even = boxer.map(() => 10);

  test("a drifted shade of a colour the palette has is conformed, never seated", () => {
    const seating = seatEffectColours(boxer, ["#c33b25", "#d9d7e6", "#b0b0c8"], even);
    expect(seating.added).toEqual([]);
    expect(seating.folds).toEqual([]);
    expect(seating.unmatched).toEqual([]);
    expect(seating.colors).toEqual(boxer);
  });

  test("a foreign colour takes a growth slot before any fold", () => {
    const seating = seatEffectColours(["#000000", "#ffffff"], ["#ffffff", "#8a2be2", "#000000"], [5, 5]);
    expect(seating.colors).toEqual(["#000000", "#ffffff", "#8a2be2"]);
    expect(seating.added).toEqual(["#8a2be2"]);
    expect(seating.folds).toEqual([]);
  });

  test("a full palette folds only as many near-duplicate pairs as the foreign colours need, most-used family first", () => {
    // Purples ranked by use: a deep violet family, then a light magenta one.
    const seating = seatEffectColours(boxer, ["#fdfcfd", "#6f05f3", "#6503e4", "#e248fe", "#9927f4"], even);
    expect(seating.folds).toHaveLength(2);
    expect(seating.added).toEqual(["#6f05f3", "#e248fe"]);
    expect(seating.colors).toHaveLength(16);
    expect(seating.colors[seating.folds[0]!.from]).toBe("#6f05f3");
    expect(seating.colors[seating.folds[1]!.from]).toBe("#e248fe");
    // The near-white conformed to #efebec; the third purple family shares a seated slot by proximity later.
    expect(seating.unmatched).toEqual(["#9927f4"]);
  });

  test("a full palette of distinct colours seats nothing and reports the foreign colour", () => {
    const distinct = ["#000000", "#ff0000", "#00ff00", "#0000ff", "#ffff00", "#00ffff", "#ff00ff", "#800000", "#008000", "#000080", "#808000", "#008080", "#800080", "#ffffff", "#ff8000", "#0080ff"];
    const seating = seatEffectColours(distinct, ["#8a2be2"], distinct.map(() => 1));
    expect(seating.added).toEqual([]);
    expect(seating.folds).toEqual([]);
    expect(seating.unmatched).toEqual(["#8a2be2"]);
    expect(seating.colors).toEqual(distinct);
  });
});
