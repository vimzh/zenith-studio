import { TRANSPARENT, createGrid, type Cell, type Grid } from "@zenith/core";

/**
 * Grid transforms deferred out of phase 02.
 *
 * All integer, all lossless where the maths allows. Rotation by a right angle
 * is exact; rotation by anything else is not, which is what `rotSprite` below
 * is for.
 */

export type QuarterTurn = 90 | 180 | 270;

/** Rotates by a right angle. Exact — every pixel lands on a pixel. */
export function rotateGrid(grid: Grid, degrees: QuarterTurn): Grid {
  const turned = degrees === 180 ? grid : { ...grid, width: grid.height, height: grid.width };
  const out = createGrid(turned.width, turned.height, TRANSPARENT);

  for (let y = 0; y < grid.height; y += 1) {
    for (let x = 0; x < grid.width; x += 1) {
      const cell = (grid.cells[y * grid.width + x] ?? TRANSPARENT) as Cell;
      let targetX: number;
      let targetY: number;

      if (degrees === 90) {
        targetX = grid.height - 1 - y;
        targetY = x;
      } else if (degrees === 180) {
        targetX = grid.width - 1 - x;
        targetY = grid.height - 1 - y;
      } else {
        targetX = y;
        targetY = grid.width - 1 - x;
      }

      out.cells[targetY * out.width + targetX] = cell;
    }
  }

  return out;
}

export type Anchor =
  | "top-left"
  | "top"
  | "top-right"
  | "left"
  | "center"
  | "right"
  | "bottom-left"
  | "bottom"
  | "bottom-right";

function offsetFor(anchor: Anchor, from: number, to: number, axis: "x" | "y"): number {
  const slack = to - from;
  const start = axis === "x"
    ? anchor.endsWith("left") ? 0 : anchor.endsWith("right") ? slack : Math.floor(slack / 2)
    : anchor.startsWith("top") ? 0 : anchor.startsWith("bottom") ? slack : Math.floor(slack / 2);
  return start;
}

/**
 * Changes the canvas size without resampling.
 *
 * Growing adds transparency; shrinking clips. Content is never scaled — that
 * would be a different operation, and conflating them is how a resize silently
 * blurs a sprite.
 */
export function resizeCanvas(grid: Grid, width: number, height: number, anchor: Anchor = "center"): Grid {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error(
      `Canvas size must be positive integers, received ${String(width)}x${String(height)}.`
    );
  }

  const out = createGrid(width, height, TRANSPARENT);
  const offsetX = offsetFor(anchor, grid.width, width, "x");
  const offsetY = offsetFor(anchor, grid.height, height, "y");

  for (let y = 0; y < grid.height; y += 1) {
    const targetY = y + offsetY;
    if (targetY < 0 || targetY >= height) continue;
    for (let x = 0; x < grid.width; x += 1) {
      const targetX = x + offsetX;
      if (targetX < 0 || targetX >= width) continue;
      out.cells[targetY * width + targetX] = (grid.cells[y * grid.width + x] ?? TRANSPARENT) as Cell;
    }
  }

  return out;
}

export interface ColorRegion {
  readonly index: Cell;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly count: number;
}

/** Connected runs of one palette index, 4-connected, with their bounding boxes. */
export function findColorRegions(grid: Grid, index: Cell): ColorRegion[] {
  const seen = new Uint8Array(grid.cells.length);
  const regions: ColorRegion[] = [];

  for (let startY = 0; startY < grid.height; startY += 1) {
    for (let startX = 0; startX < grid.width; startX += 1) {
      const offset = startY * grid.width + startX;
      if (seen[offset] === 1 || grid.cells[offset] !== index) {
        continue;
      }

      let minX = startX;
      let maxX = startX;
      let minY = startY;
      let maxY = startY;
      let count = 0;

      // Iterative flood fill: a recursive one blows the stack on a large region.
      const stack: number[] = [offset];
      seen[offset] = 1;

      while (stack.length > 0) {
        const current = stack.pop() as number;
        const x = current % grid.width;
        const y = Math.floor(current / grid.width);
        count += 1;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;

        const neighbours = [
          x > 0 ? current - 1 : -1,
          x < grid.width - 1 ? current + 1 : -1,
          y > 0 ? current - grid.width : -1,
          y < grid.height - 1 ? current + grid.width : -1,
        ];
        for (const neighbour of neighbours) {
          if (neighbour >= 0 && seen[neighbour] === 0 && grid.cells[neighbour] === index) {
            seen[neighbour] = 1;
            stack.push(neighbour);
          }
        }
      }

      regions.push({ index, x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1, count });
    }
  }

  return regions;
}

export interface ReadabilityReport {
  /** Share of the canvas the subject occupies, 0–1. */
  readonly coverage: number;
  /** Distinct palette indices used. */
  readonly colorsUsed: number;
  /** Opaque pixels with no opaque neighbour — specks that vanish at 1x. */
  readonly isolatedPixels: number;
  readonly problems: readonly string[];
}

/**
 * Checks whether a sprite still reads at 1x.
 *
 * Not a quality judgement — three specific, countable failures: a subject too
 * small to see, so many colours that none reads as a shape, and isolated
 * pixels that disappear against any background.
 */
export function checkReadability(grid: Grid): ReadabilityReport {
  const used = new Set<Cell>();
  let opaque = 0;
  let isolated = 0;

  for (let y = 0; y < grid.height; y += 1) {
    for (let x = 0; x < grid.width; x += 1) {
      const cell = (grid.cells[y * grid.width + x] ?? TRANSPARENT) as Cell;
      if (cell === TRANSPARENT) {
        continue;
      }
      opaque += 1;
      used.add(cell);

      const hasNeighbour =
        (x > 0 && grid.cells[y * grid.width + x - 1] !== TRANSPARENT) ||
        (x < grid.width - 1 && grid.cells[y * grid.width + x + 1] !== TRANSPARENT) ||
        (y > 0 && grid.cells[(y - 1) * grid.width + x] !== TRANSPARENT) ||
        (y < grid.height - 1 && grid.cells[(y + 1) * grid.width + x] !== TRANSPARENT);

      if (!hasNeighbour) {
        isolated += 1;
      }
    }
  }

  const total = grid.width * grid.height;
  const coverage = total === 0 ? 0 : opaque / total;
  const problems: string[] = [];

  if (coverage < 0.08) {
    problems.push(
      `The subject covers ${(coverage * 100).toFixed(0)}% of the canvas, which reads as empty at 1x. Crop, or draw larger.`
    );
  }
  if (used.size > 12) {
    problems.push(
      `${String(used.size)} colours in one sprite. Past about 12 no single colour reads as a shape at this size.`
    );
  }
  if (isolated > Math.max(2, opaque * 0.05)) {
    problems.push(
      `${String(isolated)} isolated pixels have no neighbour and will disappear against most backgrounds.`
    );
  }

  return { coverage, colorsUsed: used.size, isolatedPixels: isolated, problems };
}

/** Reorders a palette and rewrites the grid so nothing changes visually. */
export function sortPalette(
  grid: Grid,
  palette: readonly string[],
  by: "luminance" | "hue"
): { grid: Grid; palette: string[] } {
  const score = (hex: string): number => {
    const value = Number.parseInt(hex.slice(1), 16);
    const r = ((value >> 16) & 0xff) / 255;
    const g = ((value >> 8) & 0xff) / 255;
    const b = (value & 0xff) / 255;

    if (by === "luminance") {
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    }

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max === min) {
      return -1; // greys first, since they have no hue to sort by
    }
    const delta = max - min;
    const hue =
      max === r ? ((g - b) / delta + 6) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
    return hue / 6;
  };

  const order = palette
    .map((hex, index) => ({ hex, index, score: score(hex) }))
    .sort((a, b) => a.score - b.score || a.index - b.index);

  const remap = new Map<number, number>(order.map((entry, position) => [entry.index, position]));
  const out = createGrid(grid.width, grid.height, TRANSPARENT);

  for (let i = 0; i < grid.cells.length; i += 1) {
    const cell = grid.cells[i] as Cell;
    out.cells[i] = cell === TRANSPARENT ? TRANSPARENT : ((remap.get(cell) ?? cell) as Cell);
  }

  return { grid: out, palette: order.map((entry) => entry.hex) };
}
