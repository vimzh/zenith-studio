/**
 * The indexed grid and its text encoding — the protocol everything else depends on.
 *
 * Compact grids use `0`–`F` for indices 0–15 and `.` for transparent. Grids with
 * larger indices start with `@hex`, followed by space-separated hex token rows.
 * `decodeGrid(encodeGrid(g))` is cell-identical to `g` in either format.
 */

import { PixelError, fail, requireInteger, requirePositiveInteger } from "./errors";
import { MAX_PALETTE_SIZE, TRANSPARENT, type Cell, type Grid, type Region } from "./types";

const TRANSPARENT_CHAR = ".";
const EXTENDED_HEADER = "@hex";

/** True when `value` is a legal cell: an integer palette index 0–254, or transparent. */
export function isCell(value: number): boolean {
  return (
    Number.isInteger(value) &&
    (value === TRANSPARENT || (value >= 0 && value < MAX_PALETTE_SIZE))
  );
}

export function createGrid(width: number, height: number, fill: Cell = TRANSPARENT): Grid {
  requirePositiveInteger(width, "width");
  requirePositiveInteger(height, "height");
  if (!isCell(fill)) {
    fail(
      "invalid_index",
      `Fill value ${String(fill)} is not a palette index 0-${MAX_PALETTE_SIZE - 1} or ${TRANSPARENT} (transparent).`,
    );
  }
  const cells = new Int16Array(width * height);
  if (fill !== 0) cells.fill(fill);
  return { width, height, cells };
}

export function cloneGrid(grid: Grid): Grid {
  return { width: grid.width, height: grid.height, cells: Int16Array.from(grid.cells) };
}

export function gridsEqual(a: Grid, b: Grid): boolean {
  if (a.width !== b.width || a.height !== b.height) return false;
  for (let i = 0; i < a.cells.length; i += 1) {
    if (a.cells[i] !== b.cells[i]) return false;
  }
  return true;
}

export function containsPoint(grid: Grid, x: number, y: number): boolean {
  return (
    Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < grid.width && y < grid.height
  );
}

/** Row-major offset of `(x, y)`, rejecting non-integer or out-of-bounds coordinates. */
export function offsetOf(grid: Grid, x: number, y: number): number {
  requireInteger(x, "x");
  requireInteger(y, "y");
  if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) {
    fail(
      "out_of_bounds",
      `(${String(x)}, ${String(y)}) is outside the ${grid.width}x${grid.height} grid. Valid x is 0-${grid.width - 1}, valid y is 0-${grid.height - 1}, origin top-left.`,
    );
  }
  return y * grid.width + x;
}

/**
 * Read one cell, validating the coordinates.
 *
 * Throws a structured {@link PixelError} naming the valid range when `(x, y)` is
 * out of bounds or non-integer — which is exactly what a WebMCP tool handler
 * should hand back to an agent. Prefer this everywhere except a hot loop that
 * already iterates in bounds; see {@link peekCell}.
 */
export function getCell(grid: Grid, x: number, y: number): Cell {
  return grid.cells[offsetOf(grid, x, y)] as Cell;
}

/**
 * Read one cell without validation, treating anything outside the grid as
 * transparent.
 *
 * The rendering counterpart to {@link getCell}. Validation costs two
 * `Number.isInteger` calls and four comparisons per read, which is the right
 * price for a tool call and the wrong one for a repaint: a 64x64 frame is 4096
 * reads, and the loop already knows its own bounds.
 *
 * Use {@link getCell} anywhere a bad coordinate is a bug worth reporting. Use
 * this only where the caller controls the iteration.
 */
export function peekCell(grid: Grid, x: number, y: number): Cell {
  if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) {
    return TRANSPARENT;
  }
  return (grid.cells[y * grid.width + x] ?? TRANSPARENT) as Cell;
}

/** Clamps a region to the grid, rejecting non-integer or non-positive extents. */
export function normalizeRegion(grid: Grid, region: Region): Region {
  requireInteger(region.x, "region.x");
  requireInteger(region.y, "region.y");
  requirePositiveInteger(region.width, "region.width");
  requirePositiveInteger(region.height, "region.height");

  const x0 = Math.max(0, region.x);
  const y0 = Math.max(0, region.y);
  const x1 = Math.min(grid.width, region.x + region.width);
  const y1 = Math.min(grid.height, region.y + region.height);
  if (x1 <= x0 || y1 <= y0) {
    fail(
      "out_of_bounds",
      `Region (${String(region.x)}, ${String(region.y)}) ${String(region.width)}x${String(region.height)} does not overlap the ${grid.width}x${grid.height} grid.`,
    );
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

export function wholeGrid(grid: Grid): Region {
  return { x: 0, y: 0, width: grid.width, height: grid.height };
}

/** Encodes a cell as a one- or two-digit hex token, or `.` for transparency. */
export function encodeCell(value: Cell): string {
  if (value === TRANSPARENT) return TRANSPARENT_CHAR;
  if (!isCell(value)) {
    fail(
      "invalid_index",
      `Cannot encode cell value ${String(value)}: expected 0-${MAX_PALETTE_SIZE - 1} or ${TRANSPARENT} (transparent).`,
    );
  }
  return value.toString(16).toUpperCase();
}

/** Decodes one complete protocol token; either hex case is accepted. */
export function decodeCell(char: string): Cell {
  if (char === TRANSPARENT_CHAR) return TRANSPARENT;
  const index = Number.parseInt(char, 16);
  if (!/^[0-9a-f]{1,2}$/i.test(char) || index >= MAX_PALETTE_SIZE) {
    fail(
      "invalid_encoding",
      `'${char}' is not a valid cell token. Use hex 0-FE for palette indices 0-254, or '.' for transparent.`,
    );
  }
  return index;
}

export function encodeGrid(grid: Grid): string {
  const extended = grid.cells.some((cell) => cell > 15);
  const rows: string[] = new Array<string>(grid.height);
  for (let y = 0; y < grid.height; y += 1) {
    let row = "";
    const base = y * grid.width;
    for (let x = 0; x < grid.width; x += 1) {
      const cell = grid.cells[base + x] as Cell;
      const token = encodeCell(cell);
      row += extended
        ? `${x === 0 ? "" : " "}${cell === TRANSPARENT ? token : token.toLowerCase().padStart(2, "0")}`
        : token;
    }
    rows[y] = row;
  }
  return `${extended ? `${EXTENDED_HEADER}\n` : ""}${rows.join("\n")}`;
}

export function encodeRows(grid: Grid): readonly string[] {
  return encodeGrid(grid).split("\n");
}

/**
 * Parses the text format back into a grid.
 *
 * Tolerant about line endings and a single trailing newline; strict about
 * everything that could silently change the art — ragged rows and unknown
 * characters are rejected with the offending position.
 */
export function decodeGrid(text: string): Grid {
  const normalized = text.replace(/\r\n?/g, "\n").replace(/\n$/, "");
  if (normalized.length === 0) {
    fail("invalid_encoding", "Grid text is empty. Provide at least one row of cell characters.");
  }
  const rows = normalized.split("\n");
  return gridFromRows(rows);
}

export function gridFromRows(rows: readonly string[]): Grid {
  const extended = rows[0] === EXTENDED_HEADER;
  const data = extended ? rows.slice(1) : rows;
  const height = data.length;
  const first = data[0];
  if (first === undefined || first.length === 0) {
    fail("invalid_encoding", "Grid text is empty. Provide at least one row of cell characters.");
  }
  const width = extended ? first.split(" ").length : first.length;

  const cells = new Int16Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const row = extended ? (data[y] as string).split(" ") : data[y] as string;
    if (row.length !== width) {
      fail(
        "dimension_mismatch",
        `Row ${String(y)} has ${String(row.length)} cells but row 0 has ${String(width)}. Every row must be the same width.`,
      );
    }
    for (let x = 0; x < width; x += 1) {
      const char = row[x] as string;
      let cell: Cell;
      try {
        cell = decodeCell(char);
      } catch (error) {
        if (error instanceof PixelError) {
          fail("invalid_encoding", `${error.message} Offending position: row ${String(y)}, column ${String(x)}.`);
        }
        throw error;
      }
      cells[y * width + x] = cell;
    }
  }
  return { width, height, cells };
}

/**
 * Integer nearest-neighbour upscale — invariant 4.
 *
 * Non-integer factors are rejected rather than rounded, because a fractional
 * scale is exactly how pixel art acquires uneven pixel sizes.
 */
export function scaleGrid(grid: Grid, factor: number): Grid {
  requirePositiveInteger(factor, "factor");
  const width = grid.width * factor;
  const height = grid.height * factor;
  const cells = new Int16Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const sourceRow = ((y / factor) | 0) * grid.width;
    const targetRow = y * width;
    for (let x = 0; x < width; x += 1) {
      cells[targetRow + x] = grid.cells[sourceRow + ((x / factor) | 0)] as number;
    }
  }
  return { width, height, cells };
}

/** Extracts a sub-grid. Used by `read_region` in phase 05. */
export function cropGrid(grid: Grid, region: Region): Grid {
  const bounds = normalizeRegion(grid, region);
  const cells = new Int16Array(bounds.width * bounds.height);
  for (let y = 0; y < bounds.height; y += 1) {
    const from = (bounds.y + y) * grid.width + bounds.x;
    cells.set(grid.cells.subarray(from, from + bounds.width), y * bounds.width);
  }
  return { width: bounds.width, height: bounds.height, cells };
}

/** Per-index cell counts, plus the transparent count under key `-1`. */
export function countCells(grid: Grid): ReadonlyMap<Cell, number> {
  const counts = new Map<Cell, number>();
  for (let i = 0; i < grid.cells.length; i += 1) {
    const value = grid.cells[i] as Cell;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

/** 1-bit opacity mask: `1` where a cell is opaque, `0` where transparent. */
export function silhouette(grid: Grid): string {
  const rows: string[] = new Array<string>(grid.height);
  for (let y = 0; y < grid.height; y += 1) {
    let row = "";
    for (let x = 0; x < grid.width; x += 1) {
      row += grid.cells[y * grid.width + x] === TRANSPARENT ? "0" : "1";
    }
    rows[y] = row;
  }
  return rows.join("\n");
}
