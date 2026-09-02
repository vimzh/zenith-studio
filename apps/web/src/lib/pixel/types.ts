/**
 * View-layer types.
 *
 * The document model lives in `@zenith/core`. This module re-exports what the
 * render and geometry code needs, and adds the one thing that is purely a view
 * concern.
 */

export {
  MAX_PALETTE_SIZE,
  TRANSPARENT,
  containsPoint,
  getCell,
  peekCell,
  type Cell,
  type Grid,
  type Palette,
  type Region,
} from "@zenith/core";

/**
 * A point in asset-local pixel coordinates. Origin top-left, y increases down.
 *
 * Deliberately not in `@zenith/core`: the document model addresses cells by
 * `(x, y)` arguments or a row-major offset and never needs a point object.
 */
export interface Point {
  readonly x: number;
  readonly y: number;
}


/** A rectangular selection in asset-local pixel coordinates. */
export interface Selection {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Normalises two corners into a positive-extent region, clamped to the grid. */
export function selectionFrom(
  a: Point,
  b: Point,
  gridWidth: number,
  gridHeight: number
): Selection | null {
  const x0 = Math.max(0, Math.min(a.x, b.x));
  const y0 = Math.max(0, Math.min(a.y, b.y));
  const x1 = Math.min(gridWidth - 1, Math.max(a.x, b.x));
  const y1 = Math.min(gridHeight - 1, Math.max(a.y, b.y));

  if (x1 < x0 || y1 < y0) {
    return null;
  }
  return { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}
