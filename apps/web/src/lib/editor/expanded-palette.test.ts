// Extended indices survive editor transforms, agent text, and persisted session hydration.
import { afterEach, expect, spyOn, test } from "bun:test";
import { createGrid, serializeDocument } from "@zenith/core";
import { animateProcedural } from "../animation/procedural";
import { packSpritesheet } from "../spritesheet/atlas";
import { setPixels, writeRegion } from "../webmcp/tools/editing";
import { readCanvas, readRegion } from "../webmcp/tools/perception";
import { readFrame } from "../webmcp/tools/frames";
import { selectionContext } from "./selection-context";
import { EditorSession, session } from "./session";
import { assetStorage } from "./storage";

afterEach(() => { for (const asset of session.list()) session.close(asset.id); });
const palette = Array.from({ length: 255 }, (_, index) => `#${index.toString(16).padStart(6, "0")}`);

test("agent read/edit/write and selection context retain multi-digit hex indices", async () => {
  const id = session.create({ width: 4, height: 2, palette });
  expect(await writeRegion.execute({ x: 0, y: 0, grid: "@hex\n00 12 80 fe\n. 01 7f c8" })).toContain("4x2");
  const store = session.get(id)!;
  expect(Array.from(store.readComposite().cells)).toEqual([0, 18, 128, 254, -1, 1, 127, 200]);
  expect(await readCanvas.execute({})).toContain(store.encode());
  expect(await readFrame.execute({ frame_index: 0 })).toContain(store.encode());
  expect(await readRegion.execute({ x: 2, y: 0, width: 2, height: 1 })).toContain("@hex\n80 fe");
  const context = selectionContext(id, { x: 2, y: 0, width: 2, height: 1 });
  expect(context?.summary).toContain("80=#000080, FE=#0000fe");
  expect(context?.summary).not.toContain("NaN");
  await setPixels.execute({ pixels: [{ x: 0, y: 0, index: 254 }] });
  expect(store.colorAt(0, 0)).toBe(254);
  store.undo();
  expect(store.colorAt(0, 0)).toBe(0);
});

test("animation and spritesheet preserve large indices and transparent gutters", () => {
  const grid = createGrid(4, 4, -1);
  grid.cells[5] = 128;
  grid.cells[6] = 254;
  const frames = animateProcedural(grid, "bob", { frames: 2 }, palette.length);
  expect(frames[1]?.cells[9]).toBe(128);
  expect(frames[1]?.cells[10]).toBe(254);
  const { sheet, atlas } = packSpritesheet(frames.map((frame, index) => ({ name: String(index), grid: frame, durationMs: index === 0 ? 80 : 350 })), { columns: 2, padding: 1 });
  expect(sheet.cells[1 * 9 + 1]).toBe(128);
  expect(sheet.cells[2 * 9 + 7]).toBe(254);
  expect(sheet.cells[4]).toBe(-1);
  expect(atlas.frames.map(frame => frame.duration)).toEqual([80, 350]);
});

test("session hydration accepts old and extended persisted documents without narrowing indices", async () => {
  const source = new EditorSession();
  const small = source.create({ width: 2, height: 2, palette: ["#000000", "#ffffff"] });
  const large = source.create({ width: 2, height: 2, palette });
  source.get(large)!.setPixels([{ x: 0, y: 0, index: 128 }, { x: 1, y: 0, index: 254 }]);
  const records = [small, large].map((id, order) => ({ id, name: id, type: "tile" as const, order, document: serializeDocument(source.get(id)!.snapshot()) }));
  expect(records.map(record => record.document.version)).toEqual([1, 2]);
  const open = spyOn(assetStorage, "open").mockResolvedValue(true);
  const load = spyOn(assetStorage, "loadAll").mockResolvedValue(JSON.parse(JSON.stringify(records)));
  try {
    const restored = new EditorSession();
    await restored.hydrate();
    expect(restored.list()).toHaveLength(2);
    expect(Array.from(restored.get(large)!.readComposite().cells)).toEqual([128, 254, -1, -1]);
    expect(restored.get(small)!.palette.colors).toHaveLength(2);
  } finally {
    open.mockRestore();
    load.mockRestore();
  }
});
