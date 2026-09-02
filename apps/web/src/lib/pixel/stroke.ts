import type { Point } from "./types";

/**
 * Stroke geometry for the pencil.
 *
 * Freehand drawing produces pointer samples with gaps, so consecutive samples
 * are joined with a Bresenham line. That alone leaves "L-shaped" corner pixels
 * wherever a stroke changes direction diagonally, which read as lumps at 1px —
 * `pixelPerfect` removes them.
 */

/** Integer line between two points, endpoints included. */
export function line(from: Point, to: Point): Point[] {
  const points: Point[] = [];

  let x = Math.trunc(from.x);
  let y = Math.trunc(from.y);
  const targetX = Math.trunc(to.x);
  const targetY = Math.trunc(to.y);

  const dx = Math.abs(targetX - x);
  const dy = -Math.abs(targetY - y);
  const stepX = x < targetX ? 1 : -1;
  const stepY = y < targetY ? 1 : -1;
  let error = dx + dy;

  for (;;) {
    points.push({ x, y });
    if (x === targetX && y === targetY) {
      break;
    }
    const doubled = error * 2;
    if (doubled >= dy) {
      error += dy;
      x += stepX;
    }
    if (doubled <= dx) {
      error += dx;
      y += stepY;
    }
  }

  return points;
}

function isOrthogonalStep(a: Point, b: Point): boolean {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;
}

function isDiagonalNeighbour(a: Point, b: Point): boolean {
  return Math.abs(a.x - b.x) === 1 && Math.abs(a.y - b.y) === 1;
}

/**
 * Drop corner pixels from a stroke.
 *
 * A point is redundant when it sits between two orthogonal steps whose outer
 * neighbours are themselves diagonally adjacent — the classic L. Removing it
 * leaves a clean diagonal, which is what a pixel artist would have drawn.
 */
export function pixelPerfect(points: readonly Point[]): Point[] {
  if (points.length < 3) {
    return [...points];
  }

  const result: Point[] = [points[0] as Point];

  for (let i = 1; i < points.length - 1; i += 1) {
    const previous = result[result.length - 1] as Point;
    const current = points[i] as Point;
    const next = points[i + 1] as Point;

    const isCorner =
      isOrthogonalStep(previous, current) &&
      isOrthogonalStep(current, next) &&
      isDiagonalNeighbour(previous, next);

    if (!isCorner) {
      result.push(current);
    }
  }

  result.push(points[points.length - 1] as Point);
  return result;
}

/** Deduplicate consecutive repeats, which pointer sampling produces in bulk. */
export function dedupe(points: readonly Point[]): Point[] {
  const result: Point[] = [];
  for (const point of points) {
    const last = result[result.length - 1];
    if (!last || last.x !== point.x || last.y !== point.y) {
      result.push(point);
    }
  }
  return result;
}

/** Join raw pointer samples into a clean, gap-free, corner-free stroke. */
export function buildStroke(samples: readonly Point[], usePixelPerfect = true): Point[] {
  if (samples.length === 0) {
    return [];
  }

  const joined: Point[] = [samples[0] as Point];
  for (let i = 1; i < samples.length; i += 1) {
    const segment = line(samples[i - 1] as Point, samples[i] as Point);
    joined.push(...segment.slice(1));
  }

  const deduped = dedupe(joined);
  return usePixelPerfect ? pixelPerfect(deduped) : deduped;
}


/**
 * Expands a stroke to a square brush.
 *
 * A square rather than a circle: at these sizes a "circle" is a handful of
 * pixels whose roundness is illusory, and every pixel editor this audience
 * knows uses squares for small brushes. Odd sizes centre on the cursor; even
 * sizes bias up-left, which is the convention Aseprite uses and what a person
 * expects when the brush cannot be centred exactly.
 */
export function expandBrush(points: readonly Point[], size: number): Point[] {
  if (!Number.isInteger(size) || size < 1) {
    throw new Error(`Brush size must be a positive integer, received ${String(size)}.`);
  }
  if (size === 1) {
    return [...points];
  }

  const before = Math.floor((size - 1) / 2);
  const seen = new Set<number>();
  const out: Point[] = [];

  for (const point of points) {
    for (let dy = 0; dy < size; dy += 1) {
      for (let dx = 0; dx < size; dx += 1) {
        const x = point.x - before + dx;
        const y = point.y - before + dy;
        // Cheap dedupe key. Coordinates stay well inside 16 bits for any canvas
        // this app supports, and overlapping brush stamps are the common case.
        const key = (x + 32768) * 65536 + (y + 32768);
        if (!seen.has(key)) {
          seen.add(key);
          out.push({ x, y });
        }
      }
    }
  }

  return out;
}

/** Keeps indexed pixels binary while approximating brush opacity with ordered dithering. */
export function applyOpacity(points: readonly Point[], opacity: number): Point[] {
  if (opacity >= 100) return [...points];
  if (opacity <= 0) return [];

  const bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const threshold = opacity / 6.25;
  return points.filter(({ x, y }) => {
    const column = ((x % 4) + 4) % 4;
    const row = ((y % 4) + 4) % 4;
    return (bayer[row * 4 + column] ?? 16) < threshold;
  });
}
