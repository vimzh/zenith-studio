import { TRANSPARENT, createGrid, type Cell, type Grid } from "@zenith/core";
import { readFramesDiff } from "./diff";

/**
 * In-between frames.
 *
 * Blending two indexed grids is meaningless — the average of index 3 and index
 * 9 is not a colour between them, it is index 6, which may be an unrelated hue.
 * So this interpolates *positions*, not values: it matches each pixel that
 * appears in the target to the nearest pixel of the same colour in the source
 * and moves it part of the way. That is what a person drawing an in-between
 * does, and it keeps every intermediate frame inside the palette by
 * construction.
 */

interface Point {
  readonly x: number;
  readonly y: number;
}

function pixelsByCell(grid: Grid): Map<Cell, Point[]> {
  const byCell = new Map<Cell, Point[]>();
  for (let y = 0; y < grid.height; y += 1) {
    for (let x = 0; x < grid.width; x += 1) {
      const cell = (grid.cells[y * grid.width + x] ?? TRANSPARENT) as Cell;
      if (cell === TRANSPARENT) {
        continue;
      }
      const bucket = byCell.get(cell);
      if (bucket === undefined) {
        byCell.set(cell, [{ x, y }]);
      } else {
        bucket.push({ x, y });
      }
    }
  }
  return byCell;
}

function nearest(candidates: readonly Point[], to: Point): Point | null {
  let best: Point | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    const dx = candidate.x - to.x;
    const dy = candidate.y - to.y;
    const distance = dx * dx + dy * dy;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }

  return best;
}

/**
 * Generates `steps` frames strictly between `from` and `to`.
 *
 * Neither endpoint is included: the caller already has both, and returning them
 * is how a cycle ends up holding a frame twice.
 */
export function interpolateFrames(from: Grid, to: Grid, steps: number): Grid[] {
  if (from.width !== to.width || from.height !== to.height) {
    throw new Error(
      `Cannot interpolate between a ${String(from.width)}x${String(from.height)} frame and a ${String(to.width)}x${String(to.height)} one. All frames of an asset share its dimensions.`
    );
  }
  if (!Number.isInteger(steps) || steps < 1) {
    throw new Error(`steps must be a positive integer, received ${String(steps)}.`);
  }

  // Identical frames have nothing between them; anything else would invent motion.
  if (readFramesDiff(from, to).changed === 0) {
    return Array.from({ length: steps }, () => cloneOf(from));
  }

  const sources = pixelsByCell(from);
  const targets = pixelsByCell(to);
  const out: Grid[] = [];

  for (let step = 1; step <= steps; step += 1) {
    const t = step / (steps + 1);
    const frame = createGrid(from.width, from.height, TRANSPARENT);

    for (const [cell, points] of targets) {
      const origins = sources.get(cell);
      for (const point of points) {
        // A colour absent from the source has nowhere to travel from, so it
        // simply appears where it lands rather than sliding in from an
        // arbitrary neighbour.
        const origin = origins === undefined ? point : (nearest(origins, point) ?? point);
        const x = Math.round(origin.x + (point.x - origin.x) * t);
        const y = Math.round(origin.y + (point.y - origin.y) * t);
        if (x >= 0 && y >= 0 && x < frame.width && y < frame.height) {
          frame.cells[y * frame.width + x] = cell;
        }
      }
    }

    out.push(frame);
  }

  return out;
}

function cloneOf(grid: Grid): Grid {
  const copy = createGrid(grid.width, grid.height, TRANSPARENT);
  copy.cells.set(grid.cells);
  return copy;
}
