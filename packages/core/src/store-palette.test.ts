import { describe, expect, test } from "bun:test";
import { builtinPalette, createDocument, createStore } from "./index";

function store() {
  return createStore(createDocument({ width: 4, height: 4, palette: builtinPalette("gb-dmg") }));
}

describe("DocumentStore.setPalette", () => {
  test("changes colours without reindexing cells, and undo/redo restore both", () => {
    const document = store();
    document.setPixels([{ x: 1, y: 1, index: 3 }]);
    document.clearHistory();
    document.setPalette(["#000000", "#111111", "#222222", "#ffffff"]);

    expect(document.colorAt(1, 1)).toBe(3);
    expect(document.palette.colors.map((color) => color.hex)).toEqual(["#000000", "#111111", "#222222", "#ffffff"]);
    expect(document.history()).toEqual(["Set palette"]);
    document.undo();
    expect(document.palette.colors.map((color) => color.hex)).toEqual(builtinPalette("gb-dmg").colors.map((color) => color.hex));
    document.redo();
    expect(document.colorAt(1, 1)).toBe(3);
  });

  test("keeps palette and pixels atomic in either transaction order", () => {
    const paletteThenPixels = store();
    paletteThenPixels.transaction("inpaint", () => {
      paletteThenPixels.setPalette(["#000000", "#111111", "#222222", "#333333", "#ff0000"]);
      paletteThenPixels.setPixels([{ x: 0, y: 0, index: 4 }]);
    });
    expect(paletteThenPixels.history()).toEqual(["inpaint"]);
    paletteThenPixels.undo();
    expect(paletteThenPixels.colorAt(0, 0)).toBe(-1);
    expect(paletteThenPixels.palette.colors).toHaveLength(4);
    paletteThenPixels.redo();
    expect(paletteThenPixels.colorAt(0, 0)).toBe(4);

    const pixelsThenPalette = store();
    pixelsThenPalette.transaction("inpaint", () => {
      pixelsThenPalette.setPixels([{ x: 0, y: 0, index: 3 }]);
      pixelsThenPalette.setPalette(["#000000", "#111111", "#222222", "#ffffff"]);
    });
    pixelsThenPalette.undo();
    expect(pixelsThenPalette.colorAt(0, 0)).toBe(-1);
    expect(pixelsThenPalette.palette.colors[3]?.hex).toBe("#9bbc0f");
    pixelsThenPalette.redo();
    expect(pixelsThenPalette.colorAt(0, 0)).toBe(3);
  });

  test("rejects a palette that would invalidate cells without changing state", () => {
    const document = store();
    document.setPixels([{ x: 0, y: 0, index: 3 }]);
    document.clearHistory();
    const before = document.snapshot();
    const revision = document.revision;

    expect(() => document.setPalette(["#000000", "#ffffff"])).toThrow(/existing cell index 3/);
    expect(document.snapshot()).toEqual(before);
    expect(document.revision).toBe(revision);
    expect(document.history()).toEqual([]);
  });

  test("aborts a mixed palette and pixel transaction atomically", () => {
    const document = store();
    const before = document.snapshot();
    expect(() => document.transaction("failed inpaint", () => {
      document.setPalette(["#000000", "#111111", "#222222", "#333333", "#ff0000"]);
      document.setPixels([{ x: 0, y: 0, index: 4 }]);
      throw new Error("model result rejected");
    })).toThrow("model result rejected");
    expect(document.snapshot()).toEqual(before);
    expect(document.history()).toEqual([]);
  });

  test("keeps public palette reads detached from store state", () => {
    const document = store();
    const palette = document.palette;
    ((palette as unknown as { colors: { hex: string }[] }).colors[0]!).hex = "#ffffff";
    expect(document.palette.colors[0]?.hex).toBe("#0f380f");
  });
});
