import { TRANSPARENT, type Cell, type PixelWrite, type Region } from "@zenith/core";
import { session } from "@/lib/editor";
import { contentBounds } from "@/lib/skeleton";
import { resizeCanvas, rotateGrid, type Anchor, type QuarterTurn } from "@/lib/transform";
import { readBoolean, readEnum, readInteger } from "../args";
import { ToolError, type ToolArgs, type ToolDefinition } from "../types";
import { asOneEdit, requireActiveAsset } from "./active";

const AXES = ["horizontal", "vertical"] as const;
const ANCHORS = ["top-left", "top", "top-right", "left", "center", "right", "bottom-left", "bottom", "bottom-right"] as const;

function region(args: ToolArgs, optional = false): Region | undefined {
  if (optional && args["x"] === undefined) return undefined;
  const { store } = requireActiveAsset();
  const x = readInteger(args, "x", 0, store.width - 1);
  const y = readInteger(args, "y", 0, store.height - 1);
  return { x, y, width: readInteger(args, "width", 1, store.width - x), height: readInteger(args, "height", 1, store.height - y) };
}

function index(args: ToolArgs, key = "index"): Cell {
  const { store } = requireActiveAsset();
  return readInteger(args, key, TRANSPARENT, store.palette.colors.length - 1) as Cell;
}

function pointSchema(): Record<string, unknown> {
  return { x: { type: "integer", minimum: 0 }, y: { type: "integer", minimum: 0 }, width: { type: "integer", minimum: 1 }, height: { type: "integer", minimum: 1 } };
}

export const clearRegion: ToolDefinition = {
  name: "clear_region", description:
    "Erase a rectangular region of the currently open asset to transparency, in the selected frame. Coordinates are asset-local: (0,0) is the top-left pixel, x increases right, y increases down. The rectangle is clipped to the canvas rather than rejected. Equivalent to fill_region with index -1, and named separately because erasing is what you usually mean.",
  inputSchema: { type: "object", properties: pointSchema(), required: ["x", "y", "width", "height"] }, example: { x: 0, y: 0, width: 8, height: 8 },
  execute: (args) => { const { store } = requireActiveAsset(); const target = region(args) as Region; const changed = asOneEdit(store, "clear_region", () => store.clearRegion(target)); return `Cleared ${String(changed)} pixel(s).`; },
};

export const shiftTool: ToolDefinition = {
  name: "shift", description: "Shift the current frame by whole pixels. Vacated cells become transparent unless wrap is true.",
  inputSchema: { type: "object", properties: { dx: { type: "integer" }, dy: { type: "integer" }, wrap: { type: "boolean" } }, required: ["dx", "dy"] }, example: { dx: 1, dy: 0, wrap: true },
  execute: (args) => { const { store } = requireActiveAsset(); const dx = readInteger(args, "dx"); const dy = readInteger(args, "dy"); const wrap = readBoolean(args, "wrap", false); const changed = asOneEdit(store, "shift", () => store.shift(dx, dy, { wrap })); return `Shifted by (${String(dx)}, ${String(dy)}); ${String(changed)} pixel(s) changed.`; },
};

export const mirrorTool: ToolDefinition = {
  name: "mirror", description:
    "Mirror the currently open asset's selected frame horizontally or vertically, either whole or inside a region. Coordinates are asset-local: (0,0) is the top-left pixel, x increases right, y increases down. Pixels are moved, never resampled. Mirroring twice returns the original exactly, and this is the same operation that derives a facing direction from its opposite.",
  inputSchema: { type: "object", properties: { axis: { type: "string", enum: [...AXES] }, ...pointSchema() }, required: ["axis"] }, example: { axis: "horizontal" },
  execute: (args) => { const { store } = requireActiveAsset(); const axis = readEnum(args, "axis", AXES); const target = region(args, true); const changed = asOneEdit(store, "mirror", () => store.mirror(axis, target)); return `Mirrored ${axis}; ${String(changed)} pixel(s) changed.`; },
};

function linePoints(x0: number, y0: number, x1: number, y1: number, color: Cell): PixelWrite[] {
  const points: PixelWrite[] = []; let x = x0; let y = y0;
  const dx = Math.abs(x1 - x0); const sx = x0 < x1 ? 1 : -1; const dy = -Math.abs(y1 - y0); const sy = y0 < y1 ? 1 : -1; let error = dx + dy;
  while (true) { points.push({ x, y, index: color }); if (x === x1 && y === y1) break; const e2 = 2 * error; if (e2 >= dy) { error += dy; x += sx; } if (e2 <= dx) { error += dx; y += sy; } }
  return points;
}

export const drawLine: ToolDefinition = {
  name: "draw_line", description:
    "Draw a one-pixel-wide line between two points in the currently open asset's selected frame, using Bresenham so the result is exact rather than anti-aliased. Coordinates are asset-local: (0,0) is the top-left pixel, x increases right, y increases down. Both endpoints are drawn. Use set_pixels instead when you know the exact pixels you want.",
  inputSchema: { type: "object", properties: { x1: { type: "integer", minimum: 0 }, y1: { type: "integer", minimum: 0 }, x2: { type: "integer", minimum: 0 }, y2: { type: "integer", minimum: 0 }, index: { type: "integer", minimum: -1, maximum: 15 } }, required: ["x1", "y1", "x2", "y2", "index"] }, example: { x1: 0, y1: 0, x2: 7, y2: 7, index: 1 },
  execute: (args) => { const { store } = requireActiveAsset(); const x1 = readInteger(args, "x1", 0, store.width - 1); const y1 = readInteger(args, "y1", 0, store.height - 1); const x2 = readInteger(args, "x2", 0, store.width - 1); const y2 = readInteger(args, "y2", 0, store.height - 1); const color = index(args); const changed = asOneEdit(store, "draw_line", () => store.setPixels(linePoints(x1, y1, x2, y2, color))); return `Drew line; ${String(changed)} pixel(s) changed.`; },
};

export const drawRect: ToolDefinition = {
  name: "draw_rect", description:
    "Draw a rectangle in the currently open asset's selected frame, either filled or as a one-pixel outline. Coordinates are asset-local: (0,0) is the top-left pixel, x increases right, y increases down. The rectangle is clipped to the canvas. For a filled rectangle fill_region is equivalent and cheaper; this exists for the outline.",
  inputSchema: { type: "object", properties: { ...pointSchema(), index: { type: "integer", minimum: -1, maximum: 15 }, filled: { type: "boolean" } }, required: ["x", "y", "width", "height", "index"] }, example: { x: 2, y: 2, width: 8, height: 8, index: 1, filled: false },
  execute: (args) => { const { store } = requireActiveAsset(); const box = region(args) as Region; const color = index(args); const filled = readBoolean(args, "filled", false); const writes: PixelWrite[] = []; for (let y = box.y; y < box.y + box.height; y += 1) for (let x = box.x; x < box.x + box.width; x += 1) if (filled || x === box.x || y === box.y || x === box.x + box.width - 1 || y === box.y + box.height - 1) writes.push({ x, y, index: color }); const changed = asOneEdit(store, "draw_rect", () => store.setPixels(writes)); return `Drew rectangle; ${String(changed)} pixel(s) changed.`; },
};

export const ditherRegion: ToolDefinition = {
  name: "dither_region", description:
    "Fill a rectangular region of the currently open asset's selected frame with a two-colour dither — checker, Bayer 2x2 or Bayer 4x4. Coordinates are asset-local: (0,0) is the top-left pixel, x increases right, y increases down. Dithering is how pixel art makes a gradient out of a fixed palette; pick two indices that are adjacent on the palette's lightness ramp or the result reads as noise.",
  inputSchema: { type: "object", properties: { ...pointSchema(), index_a: { type: "integer", minimum: -1, maximum: 15 }, index_b: { type: "integer", minimum: -1, maximum: 15 }, pattern: { type: "string", enum: ["checker", "bayer2", "bayer4"] } }, required: ["x", "y", "width", "height", "index_a", "index_b", "pattern"] }, example: { x: 0, y: 0, width: 8, height: 8, index_a: 1, index_b: 2, pattern: "checker" },
  execute: (args) => { const { store } = requireActiveAsset(); const box = region(args) as Region; const a = index(args, "index_a"); const b = index(args, "index_b"); const pattern = readEnum(args, "pattern", ["checker", "bayer2", "bayer4"] as const); const bayer4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]; const writes: PixelWrite[] = []; for (let y = box.y; y < box.y + box.height; y += 1) for (let x = box.x; x < box.x + box.width; x += 1) { const chooseB = pattern === "checker" ? (x + y) % 2 === 1 : pattern === "bayer2" ? [0, 2, 3, 1][(y % 2) * 2 + (x % 2)]! >= 2 : bayer4[(y % 4) * 4 + (x % 4)]! >= 8; writes.push({ x, y, index: chooseB ? b : a }); } const changed = asOneEdit(store, "dither_region", () => store.setPixels(writes)); return `Dithered ${String(changed)} pixel(s) with ${pattern}.`; },
};

export const rotateGridTool: ToolDefinition = {
  name: "rotate_grid", description:
    "Rotate every frame of the currently open asset by exactly 90, 180 or 270 degrees. This is a grid rotation — pixels are moved, never resampled, so nothing blurs and no colour is invented. A 90 or 270 degree turn of a non-square canvas is rejected, because dimensions are immutable. This is not character rotation: it will not turn a side-on sprite to face the camera.",
  inputSchema: { type: "object", properties: { degrees: { type: "integer", enum: [90, 180, 270] } }, required: ["degrees"] }, example: { degrees: 90 },
  execute: (args) => { const { id } = requireActiveAsset(); const degrees = readInteger(args, "degrees") as QuarterTurn; if (![90, 180, 270].includes(degrees)) throw new ToolError("degrees must be 90, 180, or 270."); session.reshape(id, (frames) => { const output = frames.map((frame) => rotateGrid(frame, degrees)); return { width: output[0]!.width, height: output[0]!.height, frames: output }; }); return `Rotated every frame ${String(degrees)}° exactly.`; },
};

export const resizeCanvasTool: ToolDefinition = {
  name: "resize_canvas", description: "Resize every frame without scaling pixels. Growing pads with transparency; shrinking clips from the selected anchor.",
  inputSchema: { type: "object", properties: { width: { type: "integer", minimum: 1, maximum: 256 }, height: { type: "integer", minimum: 1, maximum: 256 }, anchor: { type: "string", enum: [...ANCHORS] } }, required: ["width", "height"] }, example: { width: 32, height: 32, anchor: "center" },
  execute: (args) => { const { id } = requireActiveAsset(); const width = readInteger(args, "width", 1, 256); const height = readInteger(args, "height", 1, 256); const anchor = readEnum<Anchor>(args, "anchor", ANCHORS, "center"); session.reshape(id, (frames) => ({ width, height, frames: frames.map((frame) => resizeCanvas(frame, width, height, anchor)) })); return `Resized every frame to ${String(width)}x${String(height)} without resampling.`; },
};

export const cropToContent: ToolDefinition = {
  name: "crop_to_content", description:
    "Trim transparent margins from the currently open asset, around the union of opaque pixels across every frame — so an animation stays aligned rather than each frame cropping to its own bounds. Changes the asset's dimensions, which invalidates any coordinates you were holding, so call read_canvas afterwards. Refused when the asset is entirely transparent.",
  inputSchema: { type: "object", properties: {} }, example: {},
  execute: () => { const { id, store } = requireActiveAsset(); if (contentBounds(store.readComposite()) === null && Array.from({ length: store.frameCount }, (_, index) => contentBounds(store.readComposite(index))).every((value) => value === null)) return "Nothing changed: every frame is transparent."; session.reshape(id, (frames) => { const bounds = frames.map(contentBounds).filter((item) => item !== null); const left = Math.min(...bounds.map((b) => b.x)); const top = Math.min(...bounds.map((b) => b.y)); const right = Math.max(...bounds.map((b) => b.x + b.width)); const bottom = Math.max(...bounds.map((b) => b.y + b.height)); const width = right - left; const height = bottom - top; return { width, height, frames: frames.map((frame) => { const out = resizeCanvas(frame, width, height, "top-left"); for (let y = 0; y < height; y += 1) out.cells.set(frame.cells.subarray((top + y) * frame.width + left, (top + y) * frame.width + right), y * width); return out; }) }; }); return "Cropped every frame to the shared opaque bounds."; },
};
