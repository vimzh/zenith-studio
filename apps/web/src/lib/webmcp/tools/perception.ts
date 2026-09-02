import { TRANSPARENT, createGrid, encodeCell, encodeGrid, type Cell } from "@zenith/core";
import { checkReadability, findColorRegions } from "@/lib/transform";
import { readInteger } from "../args";
import type { ToolDefinition } from "../types";
import { requireActiveAsset } from "./active";

/**
 * Perception — how the agent sees.
 *
 * Without this the agent draws blindfolded. `read_canvas` returns the artwork as
 * the indexed text grid, which is the entire thesis of the product: at one
 * character per pixel a 32x32 sprite is ~1KB of text a model can read, reason
 * about spatially, and write back exactly.
 */

/**
 * The header re-states page context on every read.
 *
 * Deliberately verbose: an agent that has drifted, or that is picking up a
 * conversation midway, knows exactly what it is holding without another call.
 */
function header(): string {
  const { id, name, type, store } = requireActiveAsset();
  const palette = store.palette;
  const swatches: string[] = [];
  for (let index = 0; index < palette.colors.length; index += 1) {
    swatches.push(`${encodeCell(index)}=${palette.colors[index]?.hex ?? "?"}`);
  }
  swatches.push(".=transparent");

  const rows: string[] = [
    `asset: ${name} (${type})   id: ${id}`,
    `frame: ${String(store.activeFrame + 1)}/${String(store.frameCount)}`,
    `size: ${String(store.width)}x${String(store.height)}   origin: top-left, x right, y down`,
    `palette: ${String(palette.colors.length)} colours`,
  ];
  for (let i = 0; i < swatches.length; i += 4) {
    rows.push(`  ${swatches.slice(i, i + 4).join("  ")}`);
  }
  return rows.join("\n");
}

export const readCanvas: ToolDefinition = {
  name: "read_canvas",
  description:
    "Read the currently open asset's artwork as an indexed character grid: one character per pixel, '0'-'9' and 'A'-'F' for palette indices 0-15, '.' for transparent. Rows run top to bottom, characters left to right, origin (0,0) at the top-left. The header restates the asset, frame, size and palette. Call this before any edit so you are working from what is actually on the canvas, and again afterwards to confirm the result.",
  readOnly: true,
  inputSchema: { type: "object", properties: {} },
  example: {},
  execute: () => {
    const { store } = requireActiveAsset();
    return `${header()}\ngrid:\n${store.encode()}`;
  },
};

export const getPalette: ToolDefinition = {
  name: "get_palette",
  description:
    "List the currently open asset's palette: each index, the character that represents it in the grid, its hex colour, and how many pixels currently use it. Use it to pick an index before drawing, or to find which colours are actually carrying the image. Indices not listed do not exist and will be rejected.",
  readOnly: true,
  inputSchema: { type: "object", properties: {} },
  example: {},
  execute: () => {
    const { name, store } = requireActiveAsset();
    const usage = store.stats().usage;
    const total = store.width * store.height;

    const lines = store.palette.colors.map((color, index) => {
      const count = usage.get(index) ?? 0;
      const share = ((count / total) * 100).toFixed(1);
      return `  ${encodeCell(index)}  index ${String(index).padStart(2)}  ${color.hex}  ${String(count).padStart(5)} px (${share}%)`;
    });
    const transparent = usage.get(TRANSPARENT as Cell) ?? 0;
    lines.push(
      `  .  transparent    ${" ".repeat(7)}${String(transparent).padStart(5)} px (${((transparent / total) * 100).toFixed(1)}%)`,
    );

    return `Palette for '${name}' — ${String(store.palette.colors.length)} colours over ${String(total)} pixels:\n${lines.join("\n")}`;
  },
};

export const readRegion: ToolDefinition = {
  name: "read_region",
  description:
    "Read a rectangular region of the currently open asset's selected frame as an indexed character grid, in the same format read_canvas returns. Coordinates are asset-local: (0,0) is the top-left pixel, x increases right, y increases down. The region must fit inside the canvas. Prefer this to read_canvas when you only care about part of a large asset — it costs a fraction of the tokens.",
  readOnly: true,
  inputSchema: { type: "object", properties: {
    x: { type: "integer", minimum: 0 }, y: { type: "integer", minimum: 0 },
    width: { type: "integer", minimum: 1 }, height: { type: "integer", minimum: 1 },
  }, required: ["x", "y", "width", "height"] },
  example: { x: 0, y: 0, width: 8, height: 8 },
  execute: (args) => {
    const { store } = requireActiveAsset();
    const x = readInteger(args, "x", 0, store.width - 1);
    const y = readInteger(args, "y", 0, store.height - 1);
    const width = readInteger(args, "width", 1, store.width - x);
    const height = readInteger(args, "height", 1, store.height - y);
    const source = store.readComposite();
    const region = createGrid(width, height, TRANSPARENT);
    for (let row = 0; row < height; row += 1) {
      region.cells.set(source.cells.subarray((y + row) * source.width + x, (y + row) * source.width + x + width), row * width);
    }
    return `Region (${String(x)}, ${String(y)}) ${String(width)}x${String(height)}:\n${encodeGrid(region)}`;
  },
};

export const getColorAt: ToolDefinition = {
  name: "get_color_at",
  description:
    "Read the palette index and hex colour of a single pixel in the currently open asset's selected frame. Coordinates are asset-local: (0,0) is the top-left pixel, x increases right, y increases down. Cheaper than read_canvas when you only need to know what one pixel is — for example before deciding which index to bucket_fill with. Returns -1 for a transparent pixel.",
  readOnly: true,
  inputSchema: { type: "object", properties: { x: { type: "integer", minimum: 0 }, y: { type: "integer", minimum: 0 } }, required: ["x", "y"] },
  example: { x: 0, y: 0 },
  execute: (args) => {
    const { store } = requireActiveAsset();
    const x = readInteger(args, "x", 0, store.width - 1);
    const y = readInteger(args, "y", 0, store.height - 1);
    const index = store.colorAt(x, y);
    return index === TRANSPARENT ? `(${String(x)}, ${String(y)}) is transparent.` : `(${String(x)}, ${String(y)}) uses index ${String(index)} (${store.palette.colors[index]?.hex ?? "unknown"}).`;
  },
};

export const findColorRegionsTool: ToolDefinition = {
  name: "find_color_regions",
  description: "Find every 4-connected region using one palette index and return its asset-local bounding box and pixel count.",
  readOnly: true,
  inputSchema: { type: "object", properties: { index: { type: "integer", minimum: -1, maximum: 15 } }, required: ["index"] },
  example: { index: 1 },
  execute: (args) => {
    const { store } = requireActiveAsset();
    const index = readInteger(args, "index", TRANSPARENT, store.palette.colors.length - 1) as Cell;
    const regions = findColorRegions(store.readComposite(), index);
    return regions.length === 0 ? `No pixels use index ${String(index)}.` : regions.map((region, i) => `${String(i + 1)}. (${String(region.x)}, ${String(region.y)}) ${String(region.width)}x${String(region.height)}, ${String(region.count)} px`).join("\n");
  },
};

export const checkReadabilityTool: ToolDefinition = {
  name: "check_readability",
  description: "Check three measurable 1x readability risks: low coverage, excessive colours, and isolated pixels.",
  readOnly: true,
  inputSchema: { type: "object", properties: {} },
  example: {},
  execute: () => {
    const { store } = requireActiveAsset();
    const report = checkReadability(store.readComposite());
    return report.problems.length === 0
      ? `PASS: ${(report.coverage * 100).toFixed(0)}% coverage, ${String(report.colorsUsed)} colours, ${String(report.isolatedPixels)} isolated pixels.`
      : `FAIL:\n${report.problems.map((problem) => `- ${problem}`).join("\n")}`;
  },
};
