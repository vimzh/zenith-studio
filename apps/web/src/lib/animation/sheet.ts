import { TRANSPARENT, createGrid, type Grid } from "@zenith/core";
import type { RasterImage } from "@/lib/pixelize";

/**
 * Drawn animation as one sprite sheet, not N separate renders.
 *
 * The first text-driven pipeline bought one image per frame, each conditioned
 * on the source sprite. Every frame came back as the same character, and every
 * frame came back at its own scale, its own ground line and its own framing —
 * because nothing in N independent calls can share a camera. Measured on a
 * five-frame sword swing: the body changed size between frames, the feet moved
 * up and down the canvas, and one pose ran off the edge. Each frame passed every
 * mechanical check and the cycle was unusable, which is exactly the failure
 * `docs/idea.md` §3 predicts for "four independent renders".
 *
 * A sheet fixes that structurally rather than by adding adjectives. The source
 * sprite is placed in the first cell of a grid at a known scale and the model
 * fills the remaining cells with the frames, so every frame is drawn *next to*
 * the reference at the reference's scale, in one pass, by one call. Identity,
 * proportion and ground line stop being requests and become the path of least
 * resistance. It is also one paid call instead of N.
 *
 * Everything here is pure TypeScript over byte arrays: layout, composition,
 * splitting and registration all run in a script or a test without a browser.
 */

export interface SheetLayout {
  readonly columns: number;
  readonly rows: number;
  /** Source pixels per grid cell. Never below 4, so the pixeliser has a core to sample. */
  readonly scale: number;
  /** The asset's dimensions in grid cells — every sheet cell is this size. */
  readonly cellWidth: number;
  readonly cellHeight: number;
  /** Sheet dimensions in source pixels; always one of the sizes the model returns. */
  readonly width: number;
  readonly height: number;
  /** Transparent spacing around and between cells, in grid cells. Zero when cells divide the sheet exactly. */
  readonly gutterX: number;
  readonly gutterY: number;
  /** Frames one sheet carries beyond the reference cell. */
  readonly capacity: number;
}

export type Contact = "grounded" | "airborne";

/** The output sizes the image model accepts; a sheet is composed to exactly one of them. */
const CANVASES = [
  { width: 1024, height: 1024 },
  { width: 1536, height: 1024 },
  { width: 1024, height: 1536 },
] as const;
/**
 * Best first. Below 4 pixels per cell the pixeliser's core sample is one pixel
 * wide and thin features are lost; above 16 the cells get so large that a
 * 32-pixel sprite yields a 2x2 sheet for no gain in frames.
 */
const SCALES = [16, 8, 4] as const;
/** More cells than this and each one is a thumbnail the model draws carelessly. */
const MAX_COLUMNS = 4;
const MAX_ROWS = 4;

/** Every layout a sheet can take for an asset of this size, unordered. */
export function sheetLayouts(cellWidth: number, cellHeight: number): SheetLayout[] {
  const layouts: SheetLayout[] = [];
  for (const scale of SCALES) {
    for (const canvas of CANVASES) {
      const gridWidth = canvas.width / scale;
      const gridHeight = canvas.height / scale;
      const columns = Math.min(MAX_COLUMNS, Math.floor(gridWidth / cellWidth));
      const rows = Math.min(MAX_ROWS, Math.floor(gridHeight / cellHeight));
      const capacity = columns * rows - 1;
      if (capacity < 1) continue;
      layouts.push({
        columns,
        rows,
        scale,
        cellWidth,
        cellHeight,
        width: canvas.width,
        height: canvas.height,
        gutterX: Math.floor((gridWidth - columns * cellWidth) / (columns + 1)),
        gutterY: Math.floor((gridHeight - rows * cellHeight) / (rows + 1)),
        capacity,
      });
    }
  }
  return layouts;
}

/**
 * Chooses the sheets that carry `frames` frames.
 *
 * Fewest paid calls first, then the largest scale, then the fewest empty cells.
 * A sheet is a slow paid call, so one 4x4 sheet at 4 pixels per cell beats two
 * 3x2 sheets at 8 — the difference in fidelity is real but the difference in
 * minutes and money is larger. Anyone who wants the fidelity asks for fewer
 * frames and gets the larger cells automatically.
 */
export function planSheets(cellWidth: number, cellHeight: number, frames: number): SheetLayout[] {
  if (!Number.isInteger(frames) || frames < 1) {
    throw new Error(`frames must be a positive integer, received ${String(frames)}.`);
  }
  const layouts = sheetLayouts(cellWidth, cellHeight);
  if (layouts.length === 0) {
    throw new Error(
      `No sprite-sheet layout fits a ${String(cellWidth)}x${String(cellHeight)} asset beside at least one frame at 4 pixels per cell. Animate a smaller asset.`,
    );
  }

  const plan: SheetLayout[] = [];
  let remaining = frames;
  while (remaining > 0) {
    const need = remaining;
    const [best] = [...layouts].sort((a, b) => {
      const sheets = Math.ceil(need / a.capacity) - Math.ceil(need / b.capacity);
      if (sheets !== 0) return sheets;
      if (a.scale !== b.scale) return b.scale - a.scale;
      const unused = (Math.ceil(need / a.capacity) * a.capacity - need) - (Math.ceil(need / b.capacity) * b.capacity - need);
      if (unused !== 0) return unused;
      return a.width * a.height - b.width * b.height;
    });
    plan.push(best as SheetLayout);
    remaining -= (best as SheetLayout).capacity;
  }
  return plan;
}

/** Top-left of a cell in grid cells, by reading-order index; 0 is the reference. */
export function cellOrigin(layout: SheetLayout, index: number): { x: number; y: number } {
  if (!Number.isInteger(index) || index < 0 || index >= layout.columns * layout.rows) {
    throw new Error(`Cell ${String(index)} is outside a ${String(layout.columns)}x${String(layout.rows)} sheet.`);
  }
  const column = index % layout.columns;
  const row = Math.floor(index / layout.columns);
  return {
    x: layout.gutterX + column * (layout.cellWidth + layout.gutterX),
    y: layout.gutterY + row * (layout.cellHeight + layout.gutterY),
  };
}

/**
 * The sheet the model receives: the source in cell 0, every other cell empty.
 *
 * Returned as an indexed grid rather than a raster so the caller encodes it with
 * the asset's own palette at `layout.scale` — the model then sees the real
 * colours at the real pixel cadence, and the encoded PNG is exactly
 * `layout.width` x `layout.height`.
 */
export function composeSheet(source: Grid, layout: SheetLayout): Grid {
  if (source.width !== layout.cellWidth || source.height !== layout.cellHeight) {
    throw new Error(
      `The source is ${String(source.width)}x${String(source.height)} but the layout's cells are ${String(layout.cellWidth)}x${String(layout.cellHeight)}.`,
    );
  }
  const sheet = createGrid(layout.width / layout.scale, layout.height / layout.scale, TRANSPARENT);
  const origin = cellOrigin(layout, 0);
  for (let y = 0; y < source.height; y += 1) {
    const from = y * source.width;
    sheet.cells.set(source.cells.subarray(from, from + source.width), (origin.y + y) * sheet.width + origin.x);
  }
  return sheet;
}

function resampleNearest(image: RasterImage, width: number, height: number): RasterImage {
  if (image.width === width && image.height === height) return image;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const sourceY = Math.min(image.height - 1, Math.floor((y * image.height) / height));
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.min(image.width - 1, Math.floor((x * image.width) / width));
      const from = (sourceY * image.width + sourceX) * 4;
      data.set(image.data.subarray(from, from + 4), (y * width + x) * 4);
    }
  }
  return { width, height, data };
}

/**
 * Cuts the returned sheet into its cells, in reading order, reference first.
 *
 * Fixed windows at the layout's positions, deliberately. Searching for the
 * emptiest column near each boundary sounds more robust and is not: a sprite
 * with a generous margin has an empty column *inside* its cell, and snapping to
 * it drags the subject sideways by the width of the margin. The model keeps the
 * grid; what drifts is the ground line within a cell, and that is registered
 * separately by `registerToBaseline`.
 */
export function splitSheet(sheet: RasterImage, layout: SheetLayout): RasterImage[] {
  const image = resampleNearest(sheet, layout.width, layout.height);
  const cellWidth = layout.cellWidth * layout.scale;
  const cellHeight = layout.cellHeight * layout.scale;
  const cells: RasterImage[] = [];
  for (let index = 0; index < layout.columns * layout.rows; index += 1) {
    const origin = cellOrigin(layout, index);
    const left = origin.x * layout.scale;
    const top = origin.y * layout.scale;
    const data = new Uint8ClampedArray(cellWidth * cellHeight * 4);
    for (let y = 0; y < cellHeight; y += 1) {
      const from = ((top + y) * image.width + left) * 4;
      data.set(image.data.subarray(from, from + cellWidth * 4), y * cellWidth * 4);
    }
    cells.push({ width: cellWidth, height: cellHeight, data });
  }
  return cells;
}

/** One past the last row holding an opaque pixel, or null for an empty cell. */
export function contentBottom(image: RasterImage, threshold = 8): number | null {
  for (let y = image.height - 1; y >= 0; y -= 1) {
    for (let x = 0; x < image.width; x += 1) {
      if ((image.data[(y * image.width + x) * 4 + 3] ?? 0) > threshold) return y + 1;
    }
  }
  return null;
}

/** Moves the image by whole pixels, filling with transparency. */
export function shiftRaster(image: RasterImage, dx: number, dy: number): RasterImage {
  if (dx === 0 && dy === 0) return image;
  const data = new Uint8ClampedArray(image.data.length);
  for (let y = 0; y < image.height; y += 1) {
    const sourceY = y - dy;
    if (sourceY < 0 || sourceY >= image.height) continue;
    for (let x = 0; x < image.width; x += 1) {
      const sourceX = x - dx;
      if (sourceX < 0 || sourceX >= image.width) continue;
      const from = (sourceY * image.width + sourceX) * 4;
      data.set(image.data.subarray(from, from + 4), (y * image.width + x) * 4);
    }
  }
  return { width: image.width, height: image.height, data };
}

export interface Registration {
  readonly cells: RasterImage[];
  /** Vertical correction applied to each cell, in source pixels; positive moves content down. */
  readonly shifts: number[];
}

export interface BaselineTolerance {
  /** Furthest a grounded frame floating *above* the ground line is brought down. */
  readonly down: number;
  /** Furthest a grounded frame hanging *below* the ground line is lifted. */
  readonly up: number;
}

/**
 * Puts every grounded frame's feet back on the reference's ground line.
 *
 * The one drift a sheet still shows is vertical, and it comes by the row: the
 * model draws a whole row of cells a little high. Measured twice on 512px
 * cells — 5% on a boxer, 14% on a warrior — and both times the frames were
 * otherwise right. So the tolerance is asymmetric. A grounded frame whose
 * lowest pixel floats above the ground line is never correct, so it is brought
 * down generously. One whose lowest pixel hangs below it may be correct — a low
 * follow-through can trail a blade beneath the feet — so it is lifted only a
 * little, and airborne frames are never touched: a jump lifting the feet is
 * the motion, not a defect.
 */
export function registerToBaseline(
  cells: readonly RasterImage[],
  baseline: number,
  contacts: readonly Contact[],
  tolerance: BaselineTolerance,
): Registration {
  const out: RasterImage[] = [];
  const shifts: number[] = [];
  cells.forEach((cell, index) => {
    const bottom = contentBottom(cell);
    const shift = bottom === null || contacts[index] !== "grounded" ? 0 : baseline - bottom;
    const apply = shift > 0 ? shift <= tolerance.down : shift < 0 && -shift <= tolerance.up;
    out.push(apply ? shiftRaster(cell, 0, shift) : cell);
    shifts.push(apply ? shift : 0);
  });
  return { cells: out, shifts };
}

/** The reference's ground line in a cell's pixels, from the exact source grid. */
export function sourceBaseline(source: Grid, scale: number): number | null {
  for (let y = source.height - 1; y >= 0; y -= 1) {
    for (let x = 0; x < source.width; x += 1) {
      if (source.cells[y * source.width + x] !== TRANSPARENT) return (y + 1) * scale;
    }
  }
  return null;
}
