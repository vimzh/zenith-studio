/** Exact selected-region colour remapping; palette growth never changes existing colours. */
import { MAX_PALETTE_SIZE, paletteHexes } from "@zenith/core";
import { readArray, readInteger, readRecordAt, readString } from "../args";
import { ToolError, type ToolDefinition } from "../types";
import { asOneEdit, requireActiveAsset } from "./active";

export const recolorRegion: ToolDefinition = {
  name: "recolor_region",
  description: "Recolour open layer/frame indices inside a rectangle to exact hex colours; adds palette entries. Free, one undo. (0,0) top-left; +x right, +y down. Unmapped pixels and outside colours stay exact. Read_region/get_palette first; omit outline indices.",
  inputSchema: {
    type: "object",
    properties: {
      x: { type: "integer", minimum: 0 },
      y: { type: "integer", minimum: 0 },
      width: { type: "integer", minimum: 1 },
      height: { type: "integer", minimum: 1 },
      colors: { type: "array", minItems: 1, maxItems: MAX_PALETTE_SIZE, items: {
        type: "object", properties: {
          from_index: { type: "integer", minimum: 0, maximum: MAX_PALETTE_SIZE - 1 },
          to_color: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" },
        }, required: ["from_index", "to_color"],
      } },
    },
    required: ["x", "y", "width", "height", "colors"],
  },
  example: { x: 0, y: 0, width: 4, height: 4, colors: [{ from_index: 1, to_color: "#8745c5" }] },
  execute: (args) => {
    const { store } = requireActiveAsset();
    const x = readInteger(args, "x", 0);
    const y = readInteger(args, "y", 0);
    const width = readInteger(args, "width", 1);
    const height = readInteger(args, "height", 1);
    if (x + width > store.width || y + height > store.height) {
      throw new ToolError(`The rectangle must fit the ${String(store.width)}x${String(store.height)} canvas. No pixels changed.`);
    }
    const colors = [...paletteHexes(store.palette)];
    const mapping = new Map<number, string>();
    const raw = readArray(args, "colors");
    if (raw.length > MAX_PALETTE_SIZE) throw new ToolError(`Provide at most ${String(MAX_PALETTE_SIZE)} colour mappings.`);
    for (let i = 0; i < raw.length; i++) {
      const entry = readRecordAt(raw, i, "colors");
      const from = readInteger(entry, "from_index", 0, colors.length - 1);
      const hex = readString(entry, "to_color").toLowerCase();
      if (!/^#[0-9a-f]{6}$/.test(hex)) throw new ToolError(`colors[${String(i)}].to_color must be a six-digit hex colour.`);
      if (mapping.has(from)) throw new ToolError(`Duplicate from_index ${String(from)}. Provide one target per source colour.`);
      mapping.set(from, hex);
    }
    const grid = store.readLayer();
    const pixels: { x: number; y: number; index: number }[] = [];
    for (let row = y; row < y + height; row++) for (let col = x; col < x + width; col++) {
      const from = grid.cells[row * grid.width + col]!;
      const hex = mapping.get(from);
      if (hex === undefined || hex === colors[from]) continue;
      let index = colors.indexOf(hex);
      if (index === -1) {
        if (colors.length === MAX_PALETTE_SIZE) {
          throw new ToolError(`This edit exceeds ${String(MAX_PALETTE_SIZE)} colours plus transparency, the indexed PNG/GIF capacity. No pixels or palette entries changed. Reuse existing colours or explicitly simplify the palette.`);
        }
        index = colors.length;
        colors.push(hex);
      }
      pixels.push({ x: col, y: row, index });
    }
    if (pixels.length === 0) return "No matching pixels need recolouring. Artwork, palette and undo history are unchanged.";
    const added = colors.length - store.palette.colors.length;
    const changed = asOneEdit(store, "recolor_region", () => {
      store.setPalette(colors);
      return store.setPixels(pixels);
    });
    return `Recoloured ${String(changed)} pixel(s); added ${String(added)} palette colour(s). Unmapped pixels, transparency and artwork outside the rectangle are unchanged. One undo restores the pixels and palette.`;
  },
};
