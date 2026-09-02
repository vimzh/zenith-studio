import { TRANSPARENT, silhouette, type Cell, type Grid } from "@zenith/core";

/**
 * Animation perception — how an agent understands motion without reading it all.
 *
 * A 64x64 frame is ~1300 tokens to read in full, so a six-frame cycle is ~8k
 * just to look at. A typical adjacent frame pair differs by 5-15% of its
 * pixels, so a diff is an order of magnitude cheaper and says more: it names
 * what *moved*, which is the thing being reasoned about.
 *
 * This only works because the format is indexed. You cannot diff two PNGs and
 * get something an LLM can act on.
 */

export interface CellChange {
  readonly x: number;
  readonly y: number;
  readonly from: Cell;
  readonly to: Cell;
}

export interface FramesDiff {
  readonly changes: readonly CellChange[];
  readonly changed: number;
  readonly total: number;
  /** Share of the frame that differs, 0–1. */
  readonly ratio: number;
}

export function readFramesDiff(from: Grid, to: Grid): FramesDiff {
  if (from.width !== to.width || from.height !== to.height) {
    throw new Error(
      `Cannot diff a ${String(from.width)}x${String(from.height)} frame against a ${String(to.width)}x${String(to.height)} one. All frames of an asset share its dimensions.`
    );
  }

  const changes: CellChange[] = [];
  for (let y = 0; y < from.height; y += 1) {
    for (let x = 0; x < from.width; x += 1) {
      const offset = y * from.width + x;
      const before = (from.cells[offset] ?? TRANSPARENT) as Cell;
      const after = (to.cells[offset] ?? TRANSPARENT) as Cell;
      if (before !== after) {
        changes.push({ x, y, from: before, to: after });
      }
    }
  }

  const total = from.width * from.height;
  return { changes, changed: changes.length, total, ratio: total === 0 ? 0 : changes.length / total };
}

export interface FrameStats {
  readonly index: number;
  readonly opaque: number;
  /** Centre of mass of the opaque pixels, or null for an empty frame. */
  readonly centroid: { x: number; y: number } | null;
  /** Pixels differing from the previous frame; null for the first. */
  readonly changedFromPrevious: number | null;
  /** How far the centroid moved since the previous frame; null for the first. */
  readonly centroidShift: number | null;
}

function centroidOf(grid: Grid): { x: number; y: number } | null {
  let sumX = 0;
  let sumY = 0;
  let count = 0;

  for (let y = 0; y < grid.height; y += 1) {
    for (let x = 0; x < grid.width; x += 1) {
      if ((grid.cells[y * grid.width + x] ?? TRANSPARENT) !== TRANSPARENT) {
        sumX += x;
        sumY += y;
        count += 1;
      }
    }
  }

  return count === 0 ? null : { x: sumX / count, y: sumY / count };
}

/** Per-frame shape and motion, so an agent can read a cycle without reading its pixels. */
export function readAnimationSummary(frames: readonly Grid[]): FrameStats[] {
  return frames.map((grid, index) => {
    const centroid = centroidOf(grid);
    const previous = index === 0 ? null : (frames[index - 1] as Grid);
    const previousCentroid = previous === null ? null : centroidOf(previous);

    return {
      index,
      opaque: countOpaque(grid),
      centroid,
      changedFromPrevious: previous === null ? null : readFramesDiff(previous, grid).changed,
      centroidShift:
        centroid === null || previousCentroid === null
          ? null
          : Math.hypot(centroid.x - previousCentroid.x, centroid.y - previousCentroid.y),
    };
  });
}

function countOpaque(grid: Grid): number {
  let count = 0;
  for (const cell of grid.cells) {
    if (cell !== TRANSPARENT) {
      count += 1;
    }
  }
  return count;
}

export interface CoherenceProblem {
  readonly frame: number;
  readonly kind: "palette" | "silhouette" | "loop";
  readonly message: string;
}

/**
 * Flags the three ways a generated cycle usually goes wrong.
 *
 * Reports frame indices, never a boolean — the point is that an agent can fix
 * the named frame and re-check, the same loop `check_seamless_tiling` supports.
 */
export function checkAnimationCoherence(
  frames: readonly Grid[],
  options: { paletteSize: number; loop?: boolean; maxAreaJump?: number } = { paletteSize: 16 }
): CoherenceProblem[] {
  const problems: CoherenceProblem[] = [];
  const maxAreaJump = options.maxAreaJump ?? 0.4;

  frames.forEach((grid, index) => {
    for (const cell of grid.cells) {
      if (cell !== TRANSPARENT && (cell < 0 || cell >= options.paletteSize)) {
        problems.push({
          frame: index,
          kind: "palette",
          message: `Frame ${String(index)} uses palette index ${String(cell)}, outside the ${String(options.paletteSize)}-colour palette.`,
        });
        break;
      }
    }
  });

  // A sudden change in how much of the frame is filled reads as a pop rather
  // than motion — the subject appearing to grow or vanish between frames.
  for (let index = 1; index < frames.length; index += 1) {
    const previous = countOpaque(frames[index - 1] as Grid);
    const current = countOpaque(frames[index] as Grid);
    const base = Math.max(previous, current);
    if (base > 0 && Math.abs(current - previous) / base > maxAreaJump) {
      problems.push({
        frame: index,
        kind: "silhouette",
        message: `Frame ${String(index)} changes filled area by ${(
          (Math.abs(current - previous) / base) * 100
        ).toFixed(0)}% from frame ${String(index - 1)}, which reads as a pop rather than motion.`,
      });
    }
  }

  // A looping cycle whose last frame is identical to its first stutters: that
  // frame is shown twice in a row.
  if (options.loop !== false && frames.length > 2) {
    const first = frames[0] as Grid;
    const last = frames[frames.length - 1] as Grid;
    if (silhouette(first) === silhouette(last) && readFramesDiff(first, last).changed === 0) {
      problems.push({
        frame: frames.length - 1,
        kind: "loop",
        message: `Frame ${String(frames.length - 1)} is identical to frame 0, so a looping cycle holds it twice. Remove it, or change it.`,
      });
    }
  }

  return problems;
}
