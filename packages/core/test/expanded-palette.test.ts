import { expect, test } from "bun:test";
import {
  checkSeamlessTiling, cloneGrid, conformToStyle, createDocument, createGrid, createPalette, createStore, createStyleProfile, cropGrid,
  decodeCell, decodeGrid, deserializeDocument, encodeCell, encodeGrid, encodeRows,
  gridFromRows, quantize, scaleGrid, serializeDocument, validateDocument,
} from "../src/index";

const colors = (size: number) => Array.from({ length: size }, (_, i) => `#${i.toString(16).padStart(2, "0").repeat(3)}`);

test("extended palettes preserve high indices across storage, codec, crop and scale", () => {
  for (const size of [19, 255]) {
    const grid = createGrid(3, 2);
    grid.cells.set([0, 15, 16, size - 1, 128, -1]);
    expect(Array.from(grid.cells)).toEqual([0, 15, 16, size - 1, 128, -1]);
    const encoded = encodeGrid(grid);
    expect(encoded).toBe(`@hex\n00 0f 10\n${(size - 1).toString(16)} 80 .`);
    expect(decodeGrid(encoded)).toEqual(grid);
    expect(gridFromRows(encodeRows(grid))).toEqual(grid);
    expect(cloneGrid(grid)).toEqual(grid);
    expect(cropGrid(grid, { x: 0, y: 1, width: 2, height: 1 }).cells).toEqual(new Int16Array([size - 1, 128]));
    expect(scaleGrid(createGrid(1, 1, size - 1), 2).cells).toEqual(new Int16Array(4).fill(size - 1));
  }
});

test("compact grids remain unchanged and one-column extended grids are unambiguous", () => {
  expect(encodeGrid(decodeGrid("0af.\n1234"))).toBe("0AF.\n1234");
  const column = decodeGrid("@hex\r\n10\r\n80\r\n.\r\n");
  expect(column.width).toBe(1);
  expect(column.height).toBe(3);
  expect(Array.from(column.cells)).toEqual([16, 128, -1]);
  expect(encodeGrid(column)).toBe("@hex\n10\n80\n.");
  for (let i = 0; i < 255; i += 1) expect(decodeCell(encodeCell(i))).toBe(i);
  expect(decodeCell("fe")).toBe(254);
  for (const token of ["", "ff", "100", "-1", "1g", " 1", "1 ", "0x1", ".."]) {
    expect(() => decodeCell(token)).toThrow();
    expect(() => decodeGrid(`@hex\n${token}`)).toThrow();
  }
  expect(() => decodeGrid("@hex")).toThrow();
  expect(() => decodeGrid("@hex\n00 10\n80")).toThrow(/same width/);
  expect(() => createGrid(1, 1, 255)).toThrow();
  expect(() => encodeCell(255)).toThrow();
});

test("extended documents use v2 while legacy documents keep v1", () => {
  for (const size of [16, 19, 255]) {
    const store = createStore(createDocument({ width: 2, height: 1, palette: colors(size) }));
    store.setPixels([{ x: 0, y: 0, index: size - 1 }]);
    const raw = serializeDocument(store.snapshot());
    expect(raw.version).toBe(size <= 16 ? 1 : 2);
    expect(deserializeDocument(raw)).toEqual(store.snapshot());
    if (size > 16) expect(() => deserializeDocument({ ...raw, version: 1 })).toThrow(/version 1/i);
    expect(() => deserializeDocument({ ...raw, version: 3 })).toThrow(/version 3/);
  }
  expect(() => createPalette({ colors: colors(256) })).toThrow(/255/);
  const doc = createDocument({ width: 1, height: 1, palette: colors(16) });
  expect(() => validateDocument({ ...doc, palette: { ...doc.palette, colors: Array(256).fill(doc.palette.colors[0]) } })).toThrow(/255/);
});

test("palette expansion and recoloring stay atomic through undo, redo and failure", () => {
  const store = createStore(createDocument({ width: 2, height: 1, palette: colors(16), frameCount: 2 }));
  store.setPixels([{ x: 0, y: 0, index: 15 }]);
  store.clearHistory();
  const before = store.snapshot();
  store.transaction("Recolor", () => {
    store.setPalette(colors(255));
    store.setPixels([{ x: 0, y: 0, index: 18 }]);
    store.setPixels([{ x: 1, y: 0, index: 254 }], { frame: 1 });
  });
  const after = store.snapshot();
  expect(store.history()).toEqual(["Recolor"]);
  expect(store.colorAt(1, 0, 1)).toBe(254);
  store.undo();
  expect(store.snapshot()).toEqual(before);
  store.redo();
  expect(store.snapshot()).toEqual(after);
  expect(() => store.transaction("Failed recolor", () => {
    store.setPixels([{ x: 0, y: 0, index: 200 }]);
    store.setPalette(colors(19));
  })).toThrow();
  expect(store.snapshot()).toEqual(after);
  expect(store.history()).toEqual(["Recolor"]);
});

test("quantization supports 255 colors without changing its 16-color default", () => {
  const pixels = new Uint8ClampedArray(256 * 4);
  for (let i = 0; i < 255; i += 1) pixels.set([i, i, i, 255], i * 4);
  expect(quantize(pixels).colors).toHaveLength(16);
  const result = quantize(pixels, { maxColors: 255 });
  expect(result.colors).toHaveLength(255);
  expect(new Set(result.indices)).toEqual(new Set(Array.from({ length: 256 }, (_, i) => i - 1)));
  expect(() => quantize(pixels, { maxColors: 256 })).toThrow(/255/);
});

test("seam checks do not alias expanded index pairs", () => {
  const grid = createGrid(2, 2);
  grid.cells.set([33, 0, 1, 1]);
  expect(checkSeamlessTiling(grid).leftRight.mismatches).toEqual([
    { position: 0, from: 0, to: 33, fromXY: [1, 0], toXY: [0, 0] },
  ]);
});

test("style conformance preserves high palette indices", () => {
  const profile = createStyleProfile(createPalette({ colors: colors(255) }));
  const grid = createGrid(1, 1, 254);
  expect(conformToStyle(grid, profile, "unknown").grid).toEqual(grid);
});
