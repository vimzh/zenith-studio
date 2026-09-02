import { TRANSPARENT, createGrid, type Cell, type Grid } from "@zenith/core";
import {
  BLOB47_MASKS,
  quadrantKind,
  type Corner,
  type QuadrantKind,
} from "./blob47";

/**
 * Deriving a tileset by composition.
 *
 * A blob set is 47 tiles, and generating 47 tiles independently guarantees they
 * disagree — different edge weights, different noise, seams that do not meet.
 * But every one of the 47 is just four quadrants drawn from five possibilities,
 * so **five quadrant pieces compose the whole set exactly**. Composition is not
 * merely cheaper than generation here; it is the only way the tiles are
 * guaranteed to fit each other.
 *
 * The five pieces themselves are derived from one base tile plus an edge
 * treatment, so the input is a single hand-drawn or generated tile.
 */

export interface QuadrantSet {
  readonly size: number;
  readonly pieces: Readonly<Record<QuadrantKind, Grid>>;
}

export interface DeriveOptions {
  /** Palette index drawn along an exposed edge. Omitted leaves the base untouched. */
  readonly edgeIndex?: Cell;
  /** Thickness of that edge treatment, in pixels. */
  readonly edgeWidth?: number;
}

function subGrid(source: Grid, x0: number, y0: number, size: number): Grid {
  const out = createGrid(size, size, TRANSPARENT);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      out.cells[y * size + x] = (source.cells[(y0 + y) * source.width + (x0 + x)] ??
        TRANSPARENT) as Cell;
    }
  }
  return out;
}

/**
 * Builds the five quadrant pieces from one base tile.
 *
 * Each piece is a quadrant of the base with an edge treatment applied along
 * whichever sides are exposed for that kind. Taking all five from the *same*
 * base is what makes them agree: the interior texture is literally identical
 * across every tile in the set.
 */
export function deriveQuadrants(base: Grid, options: DeriveOptions = {}): QuadrantSet {
  if (base.width !== base.height) {
    throw new Error(
      `A tileset base must be square, received ${String(base.width)}x${String(base.height)}.`
    );
  }
  if (base.width % 2 !== 0) {
    throw new Error(
      `A tileset base must have an even size so it splits into quadrants, received ${String(base.width)}.`
    );
  }

  const size = base.width / 2;
  const edgeIndex = options.edgeIndex;
  const edgeWidth = Math.max(1, Math.trunc(options.edgeWidth ?? 1));

  // Take the top-left quadrant as the interior texture for every piece, so the
  // fill is consistent no matter which corner a quadrant lands in.
  const interior = subGrid(base, 0, 0, size);

  const withEdges = (top: boolean, left: boolean, bottom: boolean, right: boolean, notch: boolean): Grid => {
    const piece = createGrid(size, size, TRANSPARENT);
    piece.cells.set(interior.cells);

    if (edgeIndex === undefined) {
      return piece;
    }

    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const onTop = top && y < edgeWidth;
        const onLeft = left && x < edgeWidth;
        const onBottom = bottom && y >= size - edgeWidth;
        const onRight = right && x >= size - edgeWidth;
        // An inner corner is exposed only at the diagonal itself, not along
        // either full side — that is what makes it read as a notch.
        const onNotch = notch && x < edgeWidth && y < edgeWidth;

        if (onTop || onLeft || onBottom || onRight || onNotch) {
          piece.cells[y * size + x] = edgeIndex;
        }
      }
    }

    return piece;
  };

  return {
    size,
    pieces: {
      // Exposed on both outer sides.
      "outer-corner": withEdges(true, true, false, false, false),
      // Exposed along the vertical run only.
      "edge-horizontal": withEdges(true, false, false, false, false),
      // Exposed along the horizontal run only.
      "edge-vertical": withEdges(false, true, false, false, false),
      // Exposed only at the diagonal.
      "inner-corner": withEdges(false, false, false, false, true),
      "fill": withEdges(false, false, false, false, false),
    },
  };
}

/** Rotates a square grid so a quadrant piece can serve all four corners. */
function orientFor(piece: Grid, corner: Corner): Grid {
  const size = piece.width;
  const out = createGrid(size, size, TRANSPARENT);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let sourceX = x;
      let sourceY = y;

      // Pieces are authored for the north-west corner; the others are mirrored
      // into place. Mirroring rather than rotating keeps a directional texture
      // upright, which rotation would visibly tip.
      if (corner === "ne" || corner === "se") {
        sourceX = size - 1 - x;
      }
      if (corner === "sw" || corner === "se") {
        sourceY = size - 1 - y;
      }

      out.cells[y * size + x] = (piece.cells[sourceY * size + sourceX] ?? TRANSPARENT) as Cell;
    }
  }

  return out;
}

const CORNER_ORIGIN: Record<Corner, [number, number]> = {
  nw: [0, 0],
  ne: [1, 0],
  se: [1, 1],
  sw: [0, 1],
};

/** Composes one tile for a given neighbour mask. */
export function composeTile(quadrants: QuadrantSet, mask: number): Grid {
  const size = quadrants.size;
  const tile = createGrid(size * 2, size * 2, TRANSPARENT);

  for (const corner of ["nw", "ne", "se", "sw"] as const) {
    const kind = quadrantKind(mask, corner);
    const piece = orientFor(quadrants.pieces[kind], corner);
    const [cx, cy] = CORNER_ORIGIN[corner];

    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        tile.cells[(cy * size + y) * tile.width + cx * size + x] = (piece.cells[y * size + x] ??
          TRANSPARENT) as Cell;
      }
    }
  }

  return tile;
}

export interface DerivedTileset {
  /** One tile per entry of `BLOB47_MASKS`, in the same order. */
  readonly tiles: readonly Grid[];
  readonly masks: readonly number[];
  readonly quadrants: QuadrantSet;
}

/**
 * Derives a complete 47-tile blob set from one base tile.
 *
 * No model involved: every tile is an exact composition of quadrants taken from
 * the base, so the whole set shares one texture and every edge meets.
 */
export function deriveBlobTileset(base: Grid, options: DeriveOptions = {}): DerivedTileset {
  const quadrants = deriveQuadrants(base, options);
  return {
    quadrants,
    masks: BLOB47_MASKS,
    tiles: BLOB47_MASKS.map((mask) => composeTile(quadrants, mask)),
  };
}
