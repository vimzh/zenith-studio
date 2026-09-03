// Palette controls preserve the document object, selected target, and complete undo history.
import { expect, test } from "bun:test";
import { createDocument, createFrame, createLayer, gridFromRows } from "@zenith/core";
import { EditorSession } from "./session";

function fixture(colors: readonly string[]) {
  const session = new EditorSession();
  const grid = gridFromRows([colors.length === 4 ? "0123" : "0101", "1.00"]);
  const id = session.adopt(createDocument({
    width: 4, height: 2, palette: colors,
    frames: [0, 1].map(frame => createFrame(4, 2, {
      durationMs: 100 + frame * 20,
      layers: [true, false].map(visible => createLayer(4, 2, { grid, visible })),
    })),
  }));
  const store = session.get(id)!;
  store.selectFrame(1);
  store.selectLayer(1);
  const original = store.snapshot();
  store.setPixels([{ x: 0, y: 1, index: 0 }]);
  return { session, id, store, original };
}

test("editing one palette color keeps every index, selection, and earlier undo entry", () => {
  const { session, id, store, original } = fixture(["#000000", "#ffffff"]);
  const before = store.snapshot();
  expect(session.setPaletteColor(id, 1, "#aa44cc")).toBe(true);
  expect(session.get(id)).toBe(store);
  expect(session.generationOf(id)).toBe(0);
  expect(store.snapshot().frames).toEqual(before.frames);
  expect(store.palette.colors[1]?.hex).toBe("#aa44cc");
  expect([store.activeFrame, store.activeLayer]).toEqual([1, 1]);
  expect(store.history()).toEqual(["Set pixels", "Set palette"]);
  const after = store.snapshot();
  store.undo();
  expect(store.snapshot()).toEqual(before);
  store.redo();
  expect(store.snapshot()).toEqual(after);
  store.undo();
  store.undo();
  expect(store.snapshot()).toEqual(original);
});

for (const { name, source, target, mapping } of [
  { name: "shrinks", source: ["#000000", "#111111", "#eeeeee", "#ffffff"], target: ["#ffffff", "#000000"], mapping: [1, 1, 0, 0] },
  { name: "grows", source: ["#000000", "#ffffff"], target: ["#ff0000", "#00ff00", "#000000", "#ffffff"], mapping: [2, 3] },
]) {
  test(`recolor ${name} across all frames and hidden layers as one undoable operation`, () => {
    const { session, id, store, original } = fixture(source);
    const before = store.snapshot();
    expect(session.recolor(id, target)).toBe(true);
    expect(session.get(id)).toBe(store);
    expect(session.generationOf(id)).toBe(0);
    expect(store.palette.colors.map(color => color.hex)).toEqual(target);
    expect([store.activeFrame, store.activeLayer]).toEqual([1, 1]);
    for (const [frame, entry] of before.frames.entries()) for (const [layer, sourceLayer] of entry.layers.entries()) {
      expect(Array.from(store.readLayer({ frame, layer }).cells)).toEqual(
        Array.from(sourceLayer.grid.cells, cell => cell === -1 ? -1 : mapping[cell]!),
      );
    }
    expect(store.history()).toHaveLength(2);
    const after = store.snapshot();
    store.undo();
    expect(store.snapshot()).toEqual(before);
    store.redo();
    expect(store.snapshot()).toEqual(after);
    store.undo();
    store.undo();
    expect(store.snapshot()).toEqual(original);
  });
}

test("invalid palette controls fail without changing artwork or history", () => {
  const { session, id, store } = fixture(["#000000", "#ffffff"]);
  const before = store.snapshot();
  const history = store.history();
  expect(() => session.setPaletteColor(id, 2, "#ff0000")).toThrow("outside");
  expect(() => session.setPaletteColor(id, 0, "invalid")).toThrow();
  expect(() => session.recolor(id, [])).toThrow();
  expect(store.snapshot()).toEqual(before);
  expect(store.history()).toEqual(history);
  expect(session.recolor("missing", ["#000000"])).toBe(false);
  expect(session.setPaletteColor("missing", 0, "#000000")).toBe(false);
});

test("recolour preserves high indices across hidden layers and all frames", () => {
  const colors = Array.from({ length: 255 }, (_, index) => `#${index.toString(16).padStart(6, "0")}`);
  const { session, id, store } = fixture([colors[128]!, colors[254]!]);
  const before = store.snapshot();
  session.recolor(id, colors);
  for (const [frame, entry] of before.frames.entries()) for (const [layer, original] of entry.layers.entries()) {
    expect(Array.from(store.readLayer({ frame, layer }).cells)).toEqual(Array.from(original.grid.cells, cell => cell === -1 ? -1 : cell === 0 ? 128 : 254));
  }
  store.undo();
  expect(store.snapshot()).toEqual(before);
});
