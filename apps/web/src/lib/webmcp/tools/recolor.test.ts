import { beforeEach, expect, test } from "bun:test";
import { paletteHexes } from "@zenith/core";
import { session } from "@/lib/editor";
import { findTool, runTool } from "../index";
import { CHAT_TOOL_NAMES } from "../chat-tools";

const palette = ["#000000", "#030100", "#080604", "#302e2f", "#5f300d", "#7b0100", "#3a4613", "#505054", "#924e16", "#61666f", "#69782e", "#f71d1a", "#9b9da5", "#a5b445", "#e2e87c", "#e5e5e7"];
const args = { x: 86, y: 70, width: 28, height: 17, colors: [
  { from_index: 9, to_color: "#8745c5" },
  { from_index: 7, to_color: "#48206e" },
  { from_index: 15, to_color: "#dec8f5" },
] };

beforeEach(() => { for (const asset of session.list()) session.close(asset.id); });

function fixture() {
  const id = session.create({ name: "Moss Knight", type: "character", width: 128, height: 128, palette });
  const store = session.get(id)!;
  // Every original colour remains in use outside the blade, as in the real sprite.
  store.setPixels(palette.map((_, index) => ({ x: index, y: 0, index })));
  store.setPixels([0, 7, 9, 15, 4].map((index, x) => ({ x: 86 + x, y: 70, index })));
  store.addFrame({ copyFrom: 0 });
  store.selectFrame(0);
  store.clearHistory();
  return store;
}

test("blade-only recolour grows a full palette and preserves all other RGBA, with one undo/redo", async () => {
  const store = fixture();
  const before = store.readLayer();
  const otherFrame = store.encode(1);
  const tool = findTool("recolor_region");
  expect(tool).toBeDefined();
  expect(CHAT_TOOL_NAMES).toContain("recolor_region");
  const result = await runTool(tool!, args, "agent");
  expect(result.ok).toBe(true);
  expect(result.text).toContain("3 pixel(s)");
  expect(store.palette.colors).toHaveLength(19);
  const after = store.readLayer();
  for (let offset = 0; offset < before.cells.length; offset++) {
    const old = before.cells[offset]!;
    const expected = offset >= 70 * 128 + 86 && offset < 70 * 128 + 91
      ? args.colors.find(c => c.from_index === old)?.to_color
      : undefined;
    const newIndex = after.cells[offset]!;
    expect(newIndex === -1 ? null : store.palette.colors[newIndex]!.hex).toBe(expected ?? (old === -1 ? null : palette[old]!));
  }
  expect(store.encode(1)).toBe(otherFrame);
  expect(store.history()).toEqual(["recolor_region"]);
  const edited = store.encode();
  store.undo();
  expect(store.readLayer().cells).toEqual(before.cells);
  expect(paletteHexes(store.palette)).toEqual(palette);
  store.redo();
  expect(store.encode()).toBe(edited);
  expect(store.palette.colors).toHaveLength(19);
});

test("invalid recolour requests and no-op mappings leave palette, pixels and history alone", async () => {
  const store = fixture();
  const before = store.encode();
  const tool = findTool("recolor_region");
  expect(tool).toBeDefined();
  for (const input of [
    { ...args, x: 127 },
    { ...args, colors: [{ from_index: 9, to_color: "purple" }] },
    { ...args, colors: [{ from_index: -1, to_color: "#8745c5" }] },
    { ...args, colors: [{ from_index: 16, to_color: "#8745c5" }] },
    { ...args, colors: [args.colors[0], args.colors[0]] },
  ]) expect((await runTool(tool!, input, "agent")).ok).toBe(false);
  expect((await runTool(tool!, { ...args, colors: [{ from_index: 9, to_color: palette[9] }] }, "agent")).ok).toBe(true);
  expect(store.encode()).toBe(before);
  expect(paletteHexes(store.palette)).toEqual(palette);
  expect(store.canUndo).toBe(false);
});
