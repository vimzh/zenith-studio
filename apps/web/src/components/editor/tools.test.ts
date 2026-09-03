import { expect, test } from "bun:test";
import { TRANSPARENT } from "@zenith/core";
import { clampPaletteIndex } from "./tools";

test("a selected brush stays valid after a sixteen-colour palette shrinks to four", () => {
  expect(clampPaletteIndex(15, 16)).toBe(15);
  expect(clampPaletteIndex(15, 4)).toBe(3);
});

test("palette selection preserves transparent and still-valid colours", () => {
  expect(clampPaletteIndex(TRANSPARENT, 4)).toBe(TRANSPARENT);
  expect(clampPaletteIndex(2, 4)).toBe(2);
});
