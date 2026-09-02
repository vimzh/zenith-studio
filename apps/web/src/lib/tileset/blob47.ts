/**
 * Blob autotiling — the 256 → 47 reduction.
 *
 * A tile's appearance depends on which of its eight neighbours are the same
 * terrain, which is 256 combinations. But a diagonal neighbour is only visible
 * when both of its adjacent cardinal neighbours are also filled: with the north
 * cell empty, whether the north-east cell is filled changes nothing you can
 * see. Normalising away those invisible corners collapses 256 configurations to
 * **47 distinct tiles**.
 *
 * That reduction is why a tileset can be *derived* rather than drawn: 47 is
 * small enough to compose from a handful of quadrant pieces, and composition is
 * exact where 47 separate generations would drift.
 */

export const NORTH = 1;
export const NORTH_EAST = 2;
export const EAST = 4;
export const SOUTH_EAST = 8;
export const SOUTH = 16;
export const SOUTH_WEST = 32;
export const WEST = 64;
export const NORTH_WEST = 128;

/**
 * Clears corner bits whose adjacent cardinals are not both set.
 *
 * This is the whole reduction. Two masks that normalise to the same value are
 * visually identical and must share a tile, or the set has redundant entries
 * that can never be told apart.
 */
export function normalizeMask(mask: number): number {
  let normalized = mask & 0xff;

  if ((normalized & NORTH) === 0 || (normalized & EAST) === 0) {
    normalized &= ~NORTH_EAST;
  }
  if ((normalized & SOUTH) === 0 || (normalized & EAST) === 0) {
    normalized &= ~SOUTH_EAST;
  }
  if ((normalized & SOUTH) === 0 || (normalized & WEST) === 0) {
    normalized &= ~SOUTH_WEST;
  }
  if ((normalized & NORTH) === 0 || (normalized & WEST) === 0) {
    normalized &= ~NORTH_WEST;
  }

  return normalized;
}

/** The 47 distinct normalised masks, ascending. Stable, so tile indices are stable. */
export const BLOB47_MASKS: readonly number[] = (() => {
  const seen = new Set<number>();
  for (let mask = 0; mask < 256; mask += 1) {
    seen.add(normalizeMask(mask));
  }
  return [...seen].sort((a, b) => a - b);
})();

const MASK_TO_INDEX = new Map<number, number>(
  BLOB47_MASKS.map((mask, index) => [mask, index])
);

/** Tile index for any of the 256 neighbour configurations. */
export function tileIndexForMask(mask: number): number {
  const index = MASK_TO_INDEX.get(normalizeMask(mask));
  if (index === undefined) {
    throw new Error(
      `Mask ${String(mask)} normalised to a value outside the 47-tile set. This is a bug in normalizeMask.`
    );
  }
  return index;
}

/**
 * How one quadrant of a tile should look.
 *
 * Each corner of a tile is decided by three neighbours — its two adjacent
 * cardinals and the diagonal between them — which is five distinct outcomes.
 * Five quadrant pieces therefore generate all 47 tiles.
 */
export type QuadrantKind =
  /** Neither cardinal filled: the terrain curves away on both sides. */
  | "outer-corner"
  /** Horizontal cardinal filled only: a straight edge running vertically. */
  | "edge-horizontal"
  /** Vertical cardinal filled only: a straight edge running horizontally. */
  | "edge-vertical"
  /** Both cardinals filled but not the diagonal: a notch. */
  | "inner-corner"
  /** All three filled: solid interior. */
  | "fill";

export type Corner = "nw" | "ne" | "se" | "sw";

const CORNER_BITS: Record<Corner, { horizontal: number; vertical: number; diagonal: number }> = {
  nw: { horizontal: WEST, vertical: NORTH, diagonal: NORTH_WEST },
  ne: { horizontal: EAST, vertical: NORTH, diagonal: NORTH_EAST },
  se: { horizontal: EAST, vertical: SOUTH, diagonal: SOUTH_EAST },
  sw: { horizontal: WEST, vertical: SOUTH, diagonal: SOUTH_WEST },
};

export function quadrantKind(mask: number, corner: Corner): QuadrantKind {
  const bits = CORNER_BITS[corner];
  const horizontal = (mask & bits.horizontal) !== 0;
  const vertical = (mask & bits.vertical) !== 0;
  const diagonal = (mask & bits.diagonal) !== 0;

  if (!horizontal && !vertical) {
    return "outer-corner";
  }
  if (horizontal && !vertical) {
    return "edge-horizontal";
  }
  if (!horizontal && vertical) {
    return "edge-vertical";
  }
  return diagonal ? "fill" : "inner-corner";
}

/** Neighbour mask for a cell, given a predicate for "same terrain". */
export function maskAt(
  x: number,
  y: number,
  isSame: (x: number, y: number) => boolean
): number {
  let mask = 0;
  if (isSame(x, y - 1)) mask |= NORTH;
  if (isSame(x + 1, y - 1)) mask |= NORTH_EAST;
  if (isSame(x + 1, y)) mask |= EAST;
  if (isSame(x + 1, y + 1)) mask |= SOUTH_EAST;
  if (isSame(x, y + 1)) mask |= SOUTH;
  if (isSame(x - 1, y + 1)) mask |= SOUTH_WEST;
  if (isSame(x - 1, y)) mask |= WEST;
  if (isSame(x - 1, y - 1)) mask |= NORTH_WEST;
  return mask;
}
