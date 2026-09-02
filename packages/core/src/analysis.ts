/**
 * Analysis over a grid — the deterministic checks an agent uses to verify its own work.
 *
 * Every check returns coordinates, not a boolean. That is what closes the loop:
 * an agent fails a check, fixes exactly those pixels, and re-checks. A boolean
 * tells it something is wrong and leaves it guessing where.
 */

import { fail } from "./errors";
import { encodeCell } from "./grid";
import type { Cell, Grid } from "./types";

export interface SeamMismatch {
  /** Position along the seam: the row for a left/right seam, the column for top/bottom. */
  readonly position: number;
  /** Cell on the trailing edge — the right column, or the bottom row. */
  readonly from: Cell;
  /** Cell it lands beside when the tile repeats — the left column, or the top row. */
  readonly to: Cell;
  /** Coordinates of the two cells, so a fix needs no arithmetic. */
  readonly fromXY: readonly [number, number];
  readonly toXY: readonly [number, number];
}

export interface SeamReport {
  readonly pass: boolean;
  readonly checked: number;
  readonly mismatches: readonly SeamMismatch[];
}

/**
 * How bad the seam is, graded rather than asserted.
 *
 * A boolean was the wrong shape. The check accepts a seam pairing when that
 * pairing occurs in the tile's interior, so its strictness scales with palette
 * size: on a 16-colour tile an ordinary pairing can be absent from the interior
 * by chance, and a single absent pairing used to flip the verdict. Measured
 * against textures that tile by construction, that produced a false "not
 * seamless" on 56% of them.
 *
 * The thresholds below come from measurement, not taste:
 *
 *   textures that tile by construction   ~1% of seam positions
 *   20 generated textures, all fine      up to 9%
 *   deliberately chunky re-generations   14-28%, tile visibly worse but usable
 *   a left-dark to right-light gradient  100% of one edge
 *
 * So 12% and 40% sit in wide empty gaps either side of the real cases.
 */
export type SeamVerdict =
  /** Within the noise this check produces on tiles that do repeat cleanly. */
  | "seamless"
  /** Real discontinuities, but the tile is usable. Worth an eye, not a rewrite. */
  | "minor"
  /** A visible seam. */
  | "seam";

/** Share of seam positions that may differ before the tile is called imperfect. */
export const SEAM_TOLERANCE = 0.12;
/** Above this share the seam is visible rather than merely present. */
export const SEAM_FAILURE = 0.4;

export interface SeamlessTilingReport {
  /** True when the verdict is `seamless`. Grades below tell you how bad, if not. */
  readonly seamless: boolean;
  readonly verdict: SeamVerdict;
  /** Share of all seam positions that differ, 0-1. */
  readonly severity: number;
  /** The seam running top to bottom, where the right edge meets the left. */
  readonly leftRight: SeamReport;
  /** The seam running left to right, where the bottom edge meets the top. */
  readonly topBottom: SeamReport;
}

function pairKey(a: Cell, b: Cell): number {
  // Cells are -1..15, so a 32-wide bucket packs a pair into one integer.
  return (a + 1) * 32 + (b + 1);
}

/**
 * Checks whether a tile repeats without a visible seam.
 *
 * The test is not "do the edges match" — almost no hand-drawn tile survives
 * that, and the ones that do are usually symmetric to the point of being dull.
 * A tile reads as seamless when the pairings the wrap creates are pairings the
 * art already contains: mortar beside stone at the seam is invisible when mortar
 * sits beside stone throughout the tile, and glaring when it appears nowhere else.
 *
 * So each seam pair is checked against the set of adjacent pairs found in the
 * tile's interior along the same axis. A pair that occurs nowhere inside is a
 * mismatch, reported with both coordinates.
 */
export function checkSeamlessTiling(grid: Grid): SeamlessTilingReport {
  if (grid.width < 2 || grid.height < 2) {
    fail(
      "invalid_dimensions",
      `Seam checking needs a grid at least 2x2, received ${String(grid.width)}x${String(grid.height)}. A single row or column has no interior to compare the seam against.`,
    );
  }

  const cell = (x: number, y: number): Cell => grid.cells[y * grid.width + x] as Cell;

  const horizontalPairs = new Set<number>();
  for (let y = 0; y < grid.height; y += 1) {
    for (let x = 0; x < grid.width - 1; x += 1) {
      horizontalPairs.add(pairKey(cell(x, y), cell(x + 1, y)));
    }
  }

  const verticalPairs = new Set<number>();
  for (let y = 0; y < grid.height - 1; y += 1) {
    for (let x = 0; x < grid.width; x += 1) {
      verticalPairs.add(pairKey(cell(x, y), cell(x, y + 1)));
    }
  }

  const leftRightMismatches: SeamMismatch[] = [];
  for (let y = 0; y < grid.height; y += 1) {
    const from = cell(grid.width - 1, y);
    const to = cell(0, y);
    if (!horizontalPairs.has(pairKey(from, to))) {
      leftRightMismatches.push({
        position: y,
        from,
        to,
        fromXY: [grid.width - 1, y],
        toXY: [0, y],
      });
    }
  }

  const topBottomMismatches: SeamMismatch[] = [];
  for (let x = 0; x < grid.width; x += 1) {
    const from = cell(x, grid.height - 1);
    const to = cell(x, 0);
    if (!verticalPairs.has(pairKey(from, to))) {
      topBottomMismatches.push({
        position: x,
        from,
        to,
        fromXY: [x, grid.height - 1],
        toXY: [x, 0],
      });
    }
  }

  const checked = grid.height + grid.width;
  const failed = leftRightMismatches.length + topBottomMismatches.length;
  const severity = checked === 0 ? 0 : failed / checked;
  const verdict: SeamVerdict =
    severity <= SEAM_TOLERANCE ? "seamless" : severity <= SEAM_FAILURE ? "minor" : "seam";

  return {
    seamless: verdict === "seamless",
    verdict,
    severity,
    // `pass` stays exact — no mismatches at all on that edge — because the
    // tolerance is a property of the whole tile, not of one edge.
    leftRight: { pass: leftRightMismatches.length === 0, checked: grid.height, mismatches: leftRightMismatches },
    topBottom: { pass: topBottomMismatches.length === 0, checked: grid.width, mismatches: topBottomMismatches },
  };
}

/** One mismatch as a line an agent can act on without re-deriving anything. */
export function describeSeamMismatch(mismatch: SeamMismatch, axis: "leftRight" | "topBottom"): string {
  const edge = axis === "leftRight" ? "row" : "column";
  return (
    `${edge} ${String(mismatch.position)}: (${String(mismatch.fromXY[0])}, ${String(mismatch.fromXY[1])})='${encodeCell(mismatch.from)}' ` +
    `wraps onto (${String(mismatch.toXY[0])}, ${String(mismatch.toXY[1])})='${encodeCell(mismatch.to)}'`
  );
}
