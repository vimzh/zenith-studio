/**
 * The eight raster mutations, as pure functions.
 *
 * Each one reads a grid and returns the cells that would change — it never
 * writes. The store applies the changes, which is what makes undo exact and what
 * keeps invariant enforcement at one boundary instead of in eight places.
 *
 * Coordinates are asset-local pixels: origin top-left, `x` right, `y` down.
 */

import { fail, requireInteger } from "./errors";
import { containsPoint, isCell, normalizeRegion, offsetOf, wholeGrid } from "./grid";
import { TRANSPARENT, type Cell, type Grid, type MirrorAxis, type Region } from "./types";

/** A pending single-cell change, before the store attributes it to a frame and layer. */
export interface CellChange {
  readonly offset: number;
  readonly from: Cell;
  readonly to: Cell;
}

export interface PixelWrite {
  readonly x: number;
  readonly y: number;
  readonly index: Cell;
}

function change(grid: Grid, offset: number, to: Cell, into: CellChange[]): void {
  const from = grid.cells[offset] as Cell;
  if (from !== to) into.push({ offset, from, to });
}

function assertCell(value: Cell, label: string): Cell {
  if (!isCell(value)) {
    fail(
      "invalid_index",
      `${label} is ${String(value)}, which is not a palette index 0-15 or -1 (transparent).`,
    );
  }
  return value;
}

/** Surgical few-pixel edits. Later writes to the same cell win. */
export function setPixels(grid: Grid, pixels: readonly PixelWrite[]): CellChange[] {
  const pending = new Map<number, Cell>();
  for (const pixel of pixels) {
    assertCell(pixel.index, `Pixel (${String(pixel.x)}, ${String(pixel.y)}) index`);
    pending.set(offsetOf(grid, pixel.x, pixel.y), pixel.index);
  }
  const changes: CellChange[] = [];
  for (const [offset, to] of pending) change(grid, offset, to, changes);
  return changes;
}

/**
 * Stamps a sub-grid at `(x, y)`.
 *
 * The workhorse: an agent that can read a grid and write one can do anything
 * else in this file. Overflow is rejected rather than clipped, because silently
 * dropping half a sprite is worse than a message saying it did not fit.
 */
export function writeRegion(grid: Grid, x: number, y: number, source: Grid): CellChange[] {
  requireInteger(x, "x");
  requireInteger(y, "y");
  if (x < 0 || y < 0 || x + source.width > grid.width || y + source.height > grid.height) {
    fail(
      "out_of_bounds",
      `A ${String(source.width)}x${String(source.height)} grid written at (${String(x)}, ${String(y)}) extends past the ${String(grid.width)}x${String(grid.height)} canvas. Reduce the grid, or move the offset to at most (${String(grid.width - source.width)}, ${String(grid.height - source.height)}).`,
    );
  }
  const changes: CellChange[] = [];
  for (let row = 0; row < source.height; row += 1) {
    for (let column = 0; column < source.width; column += 1) {
      const to = assertCell(
        source.cells[row * source.width + column] as Cell,
        `Source cell (${String(column)}, ${String(row)})`,
      );
      change(grid, (y + row) * grid.width + (x + column), to, changes);
    }
  }
  return changes;
}

export function fillRegion(grid: Grid, region: Region, index: Cell): CellChange[] {
  assertCell(index, "Fill index");
  const bounds = normalizeRegion(grid, region);
  const changes: CellChange[] = [];
  for (let row = 0; row < bounds.height; row += 1) {
    const base = (bounds.y + row) * grid.width + bounds.x;
    for (let column = 0; column < bounds.width; column += 1) {
      change(grid, base + column, index, changes);
    }
  }
  return changes;
}

export function clearRegion(grid: Grid, region: Region): CellChange[] {
  return fillRegion(grid, region, TRANSPARENT);
}

export interface BucketFillOptions {
  /** `false` replaces every matching cell in the grid, not only the connected run. */
  readonly contiguous?: boolean;
}

/** 4-connected flood fill from `(x, y)`. */
export function bucketFill(
  grid: Grid,
  x: number,
  y: number,
  index: Cell,
  options: BucketFillOptions = {},
): CellChange[] {
  assertCell(index, "Fill index");
  const start = offsetOf(grid, x, y);
  const target = grid.cells[start] as Cell;
  if (target === index) return [];
  if (options.contiguous === false) return replaceColor(grid, target, index);

  const changes: CellChange[] = [];
  const seen = new Uint8Array(grid.cells.length);
  const stack: number[] = [start];
  seen[start] = 1;

  while (stack.length > 0) {
    const offset = stack.pop() as number;
    changes.push({ offset, from: target, to: index });
    const column = offset % grid.width;
    const row = (offset / grid.width) | 0;

    const neighbours = [
      column > 0 ? offset - 1 : -1,
      column < grid.width - 1 ? offset + 1 : -1,
      row > 0 ? offset - grid.width : -1,
      row < grid.height - 1 ? offset + grid.width : -1,
    ];
    for (const neighbour of neighbours) {
      if (neighbour < 0 || seen[neighbour] === 1) continue;
      if (grid.cells[neighbour] !== target) continue;
      seen[neighbour] = 1;
      stack.push(neighbour);
    }
  }
  return changes;
}

export function replaceColor(grid: Grid, from: Cell, to: Cell): CellChange[] {
  assertCell(from, "Source index");
  assertCell(to, "Target index");
  const changes: CellChange[] = [];
  if (from === to) return changes;
  for (let offset = 0; offset < grid.cells.length; offset += 1) {
    if (grid.cells[offset] === from) changes.push({ offset, from, to });
  }
  return changes;
}

export interface ShiftOptions {
  /** Wrap pixels around the edges. `true` is how tile seams get tested in phase 10. */
  readonly wrap?: boolean;
}

export function shift(grid: Grid, dx: number, dy: number, options: ShiftOptions = {}): CellChange[] {
  requireInteger(dx, "dx");
  requireInteger(dy, "dy");
  const wrap = options.wrap ?? false;
  const changes: CellChange[] = [];

  for (let y = 0; y < grid.height; y += 1) {
    for (let x = 0; x < grid.width; x += 1) {
      let sourceX = x - dx;
      let sourceY = y - dy;
      let to: Cell;
      if (wrap) {
        sourceX = ((sourceX % grid.width) + grid.width) % grid.width;
        sourceY = ((sourceY % grid.height) + grid.height) % grid.height;
        to = grid.cells[sourceY * grid.width + sourceX] as Cell;
      } else {
        to = containsPoint(grid, sourceX, sourceY)
          ? (grid.cells[sourceY * grid.width + sourceX] as Cell)
          : TRANSPARENT;
      }
      change(grid, y * grid.width + x, to, changes);
    }
  }
  return changes;
}

/** Flips a region in place. Also the engine behind mirror-derived directions in phase 11. */
export function mirror(grid: Grid, axis: MirrorAxis, region?: Region): CellChange[] {
  const bounds = normalizeRegion(grid, region ?? wholeGrid(grid));
  const changes: CellChange[] = [];

  for (let row = 0; row < bounds.height; row += 1) {
    for (let column = 0; column < bounds.width; column += 1) {
      const sourceColumn = axis === "horizontal" ? bounds.width - 1 - column : column;
      const sourceRow = axis === "vertical" ? bounds.height - 1 - row : row;
      const to = grid.cells[(bounds.y + sourceRow) * grid.width + bounds.x + sourceColumn] as Cell;
      change(grid, (bounds.y + row) * grid.width + bounds.x + column, to, changes);
    }
  }
  return changes;
}
