import { TRANSPARENT } from "@zenith/core";
import { readArray, readBoolean, readInteger, readRecordAt, readString } from "../args";
import { ToolError, type ToolDefinition } from "../types";
import { asOneEdit, requireActiveAsset } from "./active";

/**
 * Raster editing.
 *
 * `write_region` is the workhorse — an agent that reads a grid and writes a grid
 * can do everything else here. The rest exist because they say what was meant in
 * far fewer tokens, and because an intent like "flood this region" survives a
 * later re-read better than a wall of characters.
 *
 * Every handler is one store call, so every tool call is exactly one undo entry
 * labelled with the tool name.
 */

const INDEX_NOTE =
  "Palette index; call get_palette for valid indices. Use -1 for transparent.";

function indexProperty(description: string): Record<string, unknown> {
  return { type: "integer", minimum: -1, maximum: 15, description: `${description} ${INDEX_NOTE}` };
}

export const writeRegion: ToolDefinition = {
  name: "write_region",
  description:
    "Stamp an indexed block on the open asset: 0–9/A–F = indices 0–15, '.' = transparent; equal-length newline-separated rows. (x,y) places its top-left; canvas (0,0) is top-left, +x right, +y down. Overflow rejected with valid offsets. Use read_canvas to read/edit/write.",
  inputSchema: {
    type: "object",
    properties: {
      x: { type: "integer", minimum: 0, description: "Column of the block's top-left corner, 0-indexed from the left." },
      y: { type: "integer", minimum: 0, description: "Row of the block's top-left corner, 0-indexed from the top." },
      grid: {
        type: "string",
        description: "Newline-separated rows of cell characters. Every row must be the same length.",
      },
    },
    required: ["x", "y", "grid"],
  },
  example: { x: 0, y: 0, grid: "0110\n1221\n1221\n0110" },
  execute: (args) => {
    const { store } = requireActiveAsset();
    const x = readInteger(args, "x", 0, store.width - 1);
    const y = readInteger(args, "y", 0, store.height - 1);
    const grid = readString(args, "grid");

    const changed = asOneEdit(store, "write_region", () => store.writeRegion(x, y, grid));
    const rows = grid.split("\n");
    return `Wrote a ${String(rows[0]?.length ?? 0)}x${String(rows.length)} block at (${String(x)}, ${String(y)}); ${String(changed)} pixel(s) changed.`;
  },
};

export const setPixels: ToolDefinition = {
  name: "set_pixels",
  description:
    "Correct individual pixels on the open asset. Asset-local (0,0) is top-left; +x right, +y down. Duplicate coordinates use the last value. Returns the number actually changed. Use write_region for blocks.",
  inputSchema: {
    type: "object",
    properties: {
      pixels: {
        type: "array",
        minItems: 1,
        description: "The pixels to set.",
        items: {
          type: "object",
          properties: {
            x: { type: "integer", minimum: 0, description: "Column, 0-indexed from the left." },
            y: { type: "integer", minimum: 0, description: "Row, 0-indexed from the top." },
            index: indexProperty("Colour to set."),
          },
          required: ["x", "y", "index"],
        },
      },
    },
    required: ["pixels"],
  },
  example: { pixels: [{ x: 4, y: 4, index: 2 }, { x: 5, y: 4, index: 2 }] },
  execute: (args) => {
    const { store } = requireActiveAsset();
    const items = readArray(args, "pixels");
    const pixels = items.map((_, index) => {
      const entry = readRecordAt(items, index, "pixels");
      return {
        x: readInteger(entry, "x", 0, store.width - 1),
        y: readInteger(entry, "y", 0, store.height - 1),
        index: readInteger(entry, "index", TRANSPARENT, 15),
      };
    });

    const changed = asOneEdit(store, "set_pixels", () => store.setPixels(pixels));
    return `Set ${String(pixels.length)} pixel(s); ${String(changed)} changed.`;
  },
};

export const fillRegion: ToolDefinition = {
  name: "fill_region",
  description:
    "Fill an open-asset rectangle with one palette index; -1 clears transparency. Asset-local (0,0) is top-left; +x right, +y down. Rectangles are clipped to the canvas.",
  inputSchema: {
    type: "object",
    properties: {
      x: { type: "integer", minimum: 0, description: "Left edge, 0-indexed from the left." },
      y: { type: "integer", minimum: 0, description: "Top edge, 0-indexed from the top." },
      width: { type: "integer", minimum: 1, description: "Width in pixels." },
      height: { type: "integer", minimum: 1, description: "Height in pixels." },
      index: indexProperty("Colour to fill with."),
    },
    required: ["x", "y", "width", "height", "index"],
  },
  example: { x: 0, y: 0, width: 8, height: 8, index: 1 },
  execute: (args) => {
    const { store } = requireActiveAsset();
    const region = {
      x: readInteger(args, "x", 0, store.width - 1),
      y: readInteger(args, "y", 0, store.height - 1),
      width: readInteger(args, "width", 1),
      height: readInteger(args, "height", 1),
    };
    const index = readInteger(args, "index", TRANSPARENT, 15);

    const changed = asOneEdit(store, "fill_region", () => store.fillRegion(region, index));
    const name = index === TRANSPARENT ? "transparent" : `index ${String(index)}`;
    return `Filled ${String(region.width)}x${String(region.height)} at (${String(region.x)}, ${String(region.y)}) with ${name}; ${String(changed)} pixel(s) changed.`;
  },
};

export const bucketFill: ToolDefinition = {
  name: "bucket_fill",
  description:
    "Flood-fill the open asset from (x,y), using 4-way same-colour connectivity, not diagonals. Asset-local (0,0) is top-left; +x right, +y down. contiguous:false replaces that colour everywhere. Read_canvas first.",
  inputSchema: {
    type: "object",
    properties: {
      x: { type: "integer", minimum: 0, description: "Column to start from, 0-indexed from the left." },
      y: { type: "integer", minimum: 0, description: "Row to start from, 0-indexed from the top." },
      index: indexProperty("Colour to fill with."),
      contiguous: {
        type: "boolean",
        description: "True (default) fills only the connected run. False recolours every matching pixel on the canvas.",
      },
    },
    required: ["x", "y", "index"],
  },
  example: { x: 0, y: 0, index: 3 },
  execute: (args) => {
    const { store } = requireActiveAsset();
    const x = readInteger(args, "x", 0, store.width - 1);
    const y = readInteger(args, "y", 0, store.height - 1);
    const index = readInteger(args, "index", TRANSPARENT, 15);
    const contiguous = readBoolean(args, "contiguous", true);

    const before = store.colorAt(x, y);
    const changed = asOneEdit(store, "bucket_fill", () => store.bucketFill(x, y, index, { contiguous }));
    if (changed === 0) {
      return `Nothing changed: (${String(x)}, ${String(y)}) already holds index ${String(before)}.`;
    }
    const scope = contiguous ? "connected run" : "every matching pixel";
    return `Filled the ${scope} from (${String(x)}, ${String(y)}), replacing index ${String(before)} with ${String(index)}; ${String(changed)} pixel(s) changed.`;
  },
};

export const replaceColor: ToolDefinition = {
  name: "replace_color",
  description:
    "Replace one palette index everywhere on the open asset, preserving shapes. Use -1 as the target to erase, or as the source to fill all transparent pixels.",
  inputSchema: {
    type: "object",
    properties: {
      from_index: indexProperty("Colour to replace."),
      to_index: indexProperty("Colour to replace it with."),
    },
    required: ["from_index", "to_index"],
  },
  example: { from_index: 1, to_index: 2 },
  execute: (args) => {
    const { store } = requireActiveAsset();
    const from = readInteger(args, "from_index", TRANSPARENT, 15);
    const to = readInteger(args, "to_index", TRANSPARENT, 15);
    if (from === to) {
      throw new ToolError(`from_index and to_index are both ${String(from)}; that would change nothing.`);
    }

    const changed = asOneEdit(store, "replace_color", () => store.replaceColor(from, to));
    if (changed === 0) {
      return `No pixels use index ${String(from)}, so nothing changed. Call get_palette to see which indices are in use.`;
    }
    return `Replaced index ${String(from)} with ${String(to)} across the canvas; ${String(changed)} pixel(s) changed.`;
  },
};
