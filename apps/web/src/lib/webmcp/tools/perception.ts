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
    "Read open artwork: compact hex rows (0–F) or @hex then spaced hex tokens (00–fe); '.' transparent. (0,0) top-left, rows down, columns right. Includes asset/frame/size/palette. Read before and after edits.",
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
    "Read the open asset's palette indices, grid characters, hex colours and pixel usage counts. Choose indices before drawing; unlisted indices are invalid.",
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
    "Read part of the open asset's selected frame in read_canvas grid format. Asset-local (0,0) is top-left; +x right, +y down. The rectangle must fit the canvas. Cheaper than reading the full frame.",
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
    "Read a selected-frame pixel's palette index and hex colour; transparent is -1. Asset-local (0,0) is top-left; +x right, +y down. Cheaper than read_canvas.",
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
  inputSchema: { type: "object", properties: { index: { type: "integer", minimum: -1, maximum: 254 } }, required: ["index"] },
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
