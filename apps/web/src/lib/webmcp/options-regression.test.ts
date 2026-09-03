import { beforeEach, describe, expect, test } from "bun:test";
import { BUILTIN_PALETTES, decodeGrid, type DocumentStore } from "@zenith/core";
import { session } from "@/lib/editor";
import { TEMPLATE_NAMES } from "@/lib/skeleton";
import { encodeGif } from "@/lib/animation";
import { encodeIndexedPng, exportForEngine, toAse, toGpl, toHexList, toPaintNetTxt, toPal, toStripIndices } from "@/lib/export";
import { applyOpacity, CANVAS_PRESETS } from "@/lib/pixel";
import { packSpritesheet } from "@/lib/spritesheet";
import { findTool, runTool, transcript, assetNavigation } from "./index";
import type { ToolArgs, ToolDefinition } from "./types";
import merchant from "./fixtures/qa-merchant.json";

/* Deterministic option regression coverage for the controls exposed by the editor.
 * Network/image/browser-download tools deliberately live in their integration tests. */

function reset(): void {
  for (const asset of session.list()) session.close(asset.id);
  transcript.clear();
  assetNavigation.clear();
}

function fixture(type: "character" | "tile" | "texture" = "character"): DocumentStore {
  const grid = decodeGrid(merchant.grid);
  const id = session.create({ name: merchant.name, type, width: grid.width, height: grid.height, palette: merchant.palette, grid });
  session.open(id);
  const store = session.get(id);
  if (store === undefined) throw new Error("fixture missing");
  store.clearHistory();
  return store;
}

function active(): DocumentStore {
  // `session.active` is `DocumentStore | null`, not `| undefined` — the
  // undefined check narrowed nothing and left the null in the return type.
  const store = session.active;
  if (store === null) throw new Error("active fixture missing");
  return store;
}

async function call(name: string, args: ToolArgs = {}): Promise<string> {
  const tool = findTool(name);
  if (tool === undefined) throw new Error(`Missing deterministic tool '${name}'.`);
  const result = await runTool(tool as ToolDefinition, args, "console");
  expect(result.ok, `${name}: ${result.text}`).toBe(true);
  return result.text;
}

beforeEach(reset);

describe("deterministic editor options", () => {
  test("covers common raster, history, frame, and perception tools against a realistic 128px character", async () => {
    const store = fixture();
    for (const [name, args] of [
      ["read_canvas", {}], ["read_region", { x: 40, y: 16, width: 64, height: 96 }], ["get_palette", {}],
      ["get_color_at", { x: 52, y: 16 }], ["find_color_regions", { index: 2 }], ["check_readability", {}],
      ["write_region", { x: 0, y: 0, grid: "01\n10" }], ["set_pixels", { pixels: [{ x: 2, y: 2, index: 3 }] }],
      ["fill_region", { x: 4, y: 4, width: 3, height: 3, index: 4 }], ["bucket_fill", { x: 4, y: 4, index: 5 }],
      ["replace_color", { from_index: 5, to_index: 4 }], ["clear_region", { x: 4, y: 4, width: 3, height: 3 }],
      ["draw_line", { x1: 4, y1: 4, x2: 16, y2: 16, index: 1 }], ["draw_rect", { x: 18, y: 4, width: 8, height: 8, index: 2, filled: false }],
      ["list_frames", {}], ["add_frame", { copy_from: 0 }], ["select_frame", { frame_index: 1 }],
      ["set_frame_duration", { frame_index: 1, ms: 125 }], ["read_frame", { frame_index: 1 }], ["get_silhouette", {}],
      ["read_frames_diff", { from_index: 0, to_index: 1 }], ["read_animation_summary", {}], ["check_animation_coherence", { loop: false, max_area_jump: 1 }],
      ["reorder_frames", { order: [1, 0] }], ["delete_frame", { frame_index: 1 }], ["undo", {}], ["redo", {}],
    ] as const) await call(name, args);
    expect(store.width).toBe(128);
  });

  test("covers every transform enum and preserves indexed dimensions", async () => {
    const store = fixture();
    let original = store.encode();
    for (const axis of ["horizontal", "vertical"] as const) {
      await call("mirror", { axis });
      await call("mirror", { axis });
      expect(active().encode()).toBe(original);
    }
    for (const pattern of ["checker", "bayer2", "bayer4"] as const) await call("dither_region", { x: 4, y: 4, width: 8, height: 8, index_a: 1, index_b: 2, pattern });
    for (const wrap of [false, true]) await call("shift", { dx: 1, dy: -1, wrap });
    original = active().encode();
    for (const degrees of [90, 180, 270] as const) {
      await call("rotate_grid", { degrees });
      expect(active().encode()).not.toBe(original);
      await call("rotate_grid", { degrees: 360 - degrees });
      expect(active().encode()).toBe(original);
    }
    for (const anchor of ["top-left", "top", "top-right", "left", "center", "right", "bottom-left", "bottom", "bottom-right"] as const) {
      await call("resize_canvas", { width: 132, height: 136, anchor });
      expect([active().width, active().height]).toEqual([132, 136]);
      await call("resize_canvas", { width: 128, height: 128, anchor });
    }
    await call("crop_to_content");
    expect(store.palette.colors.length).toBeLessThanOrEqual(16);
  });

  test("covers every procedural and skeleton animation option", async () => {
    for (const preset of ["bob", "blink", "flicker", "pulse", "scroll", "sway"] as const) {
      const store = fixture();
      await call("animate_procedural", { preset, frames: 2, amplitude: 1, dx: 1, dy: 1 });
      expect(store.frameCount).toBe(2);
    }
    for (const template of TEMPLATE_NAMES) {
      const store = fixture();
      await call("estimate_skeleton");
      await call("animate_with_skeleton", { template, frames: template === TEMPLATE_NAMES[0] ? 6 : 2 });
      expect(store.frameCount).toBe(template === TEMPLATE_NAMES[0] ? 6 : 2);
    }
  });

  test("encodes the generated merchant at every supported PNG scale and as GIF frames", () => {
    const store = fixture();
    const grid = store.readComposite();
    for (const scale of [1, 2, 4, 8, 16]) {
      const png = encodeIndexedPng(grid, merchant.palette, { scale });
      const view = new DataView(png.buffer, png.byteOffset);
      expect([view.getUint32(16), view.getUint32(20)]).toEqual([128 * scale, 128 * scale]);
    }
    store.addFrame({ copyFrom: 0 });
    const gif = encodeGif([store.readComposite(0), store.readComposite(1)], merchant.palette);
    expect(new TextDecoder().decode(gif.slice(0, 6))).toBe("GIF89a");
    expect([(gif[6] as number) | ((gif[7] as number) << 8), (gif[8] as number) | ((gif[9] as number) << 8)]).toEqual([128, 128]);
  });

  test("encodes every palette and engine export option plus binary opacity stops", () => {
    const store = fixture();
    const colors = merchant.palette;
    expect(toGpl(colors, merchant.name)).toContain("GIMP Palette");
    expect(toPal(colors)).toContain("JASC-PAL");
    expect(toHexList(colors).split("\n")).toHaveLength(colors.length + 1);
    expect(toPaintNetTxt(colors)).toContain("FF0F0309");
    expect(new TextDecoder().decode(toAse(colors).slice(0, 4))).toBe("ASEF");
    expect(toStripIndices(colors)).toHaveLength(colors.length);
    const atlas = packSpritesheet([{ name: "merchant", grid: store.readComposite(), tag: "idle", durationMs: 100 }]).atlas;
    for (const engine of ["godot", "unity", "phaser", "love"] as const) expect(exportForEngine(engine, { name: "merchant", atlas }).files.length).toBeGreaterThan(0);
    const points = Array.from({ length: 16 }, (_, x) => ({ x, y: 0 }));
    expect(applyOpacity(points, 0)).toHaveLength(0);
    expect(applyOpacity(points, 100)).toHaveLength(16);
    for (const opacity of [6.25, 25, 50, 75, 93.75]) expect(applyOpacity(points, opacity).length).toBeGreaterThan(0);
  });

  test("covers tile/texture-only deterministic options and character mirroring", async () => {
    for (const type of ["tile", "texture"] as const) {
      fixture(type);
      await call("check_seamless_tiling");
      await call("generate_tileset", { edge_index: 1 });
    }
    const character = fixture();
    session.rename(character.id, "QA merchant east");
    for (const palette of [...Object.keys(BUILTIN_PALETTES), ...CANVAS_PRESETS.map((preset) => preset.id)]) {
      const before = active().encode();
      const beforePalette = active().palette;
      await call("set_palette", { palette });
      expect(active().palette.colors.length).toBeGreaterThan(0);
      await call("undo");
      expect(active().encode()).toBe(before);
      expect(active().palette).toEqual(beforePalette);
    }
    await call("set_palette", { colors: ["#000000", "#ffffff"] });
    await call("derive_direction_by_mirror", { from_direction: "east", to_direction: "west" });
    await call("get_directions", { set: "side2" });
    await call("select_direction", { direction: "west" });
  });

  test("sets every asset type accepted by the context tool", async () => {
    fixture();
    for (const type of ["character", "tile", "texture", "tileset", "item", "ui"] as const) {
      await call("set_asset_type", { type });
      expect(session.list().find((asset) => asset.id === session.activeId)?.type).toBe(type);
    }
  });

  test("covers deterministic palette reduction, transparent-border removal, and interpolation", async () => {
    fixture();
    const before = active().encode();
    await call("reduce_colors", { target_count: 8 });
    expect(active().palette.colors).toHaveLength(8);
    await call("undo");
    expect(active().encode()).toBe(before);
    expect(await call("remove_background")).toContain("already transparent");
    expect(active().encode()).toBe(before);
    expect(active().history()).toEqual([]);
    const enclosed = fixture();
    enclosed.fillRegion({ x: 0, y: 0, width: 128, height: 128 }, 0);
    enclosed.fillRegion({ x: 16, y: 16, width: 96, height: 96 }, 1);
    enclosed.fillRegion({ x: 32, y: 32, width: 64, height: 64 }, 0);
    enclosed.clearHistory();
    await call("remove_background");
    expect(active().colorAt(0, 0)).toBe(-1);
    expect(active().colorAt(64, 64)).toBe(0);
    await call("undo");
    expect(active().colorAt(0, 0)).toBe(0);
    await call("add_frame", { copy_from: 0 });
    await call("set_pixels", { pixels: [{ x: 64, y: 64, index: 1 }] });
    await call("interpolate_frames", { from_index: 0, to_index: 1, steps: 2 });
    expect(active().frameCount).toBe(4);
  });
});
