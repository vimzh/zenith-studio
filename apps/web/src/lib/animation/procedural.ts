import { TRANSPARENT, cloneGrid, createGrid, type Cell, type Grid } from "@zenith/core";

/**
 * Procedural animation — the underrated path.
 *
 * An idle bob is the previous frame shifted down one pixel. A blink swaps two
 * palette indices on a handful of cells for a single frame. Water scrolls by a
 * wrapped shift. These are arithmetic on pixel positions: instant, free, exactly
 * loopable, and an agent can author them with total confidence because there is
 * no model in the loop to disagree with.
 *
 * This is also where the indexed format pays off in a way that surprises people.
 * Temporal coherence — the thing generated animation is worst at — is trivially
 * guaranteed when every frame is derived from the last by a known transform.
 */

export type ProceduralPreset = "bob" | "blink" | "flicker" | "pulse" | "scroll" | "sway";

export interface ProceduralOptions {
  readonly frames?: number;
  /** Pixels of displacement, or ramp distance for colour presets. */
  readonly amplitude?: number;
  /** Direction for `scroll`, in pixels per frame. */
  readonly dx?: number;
  readonly dy?: number;
  /** Indices treated as the subject's highlights for `blink`. */
  readonly indices?: readonly Cell[];
}

function shifted(grid: Grid, dx: number, dy: number, wrap: boolean): Grid {
  const out = createGrid(grid.width, grid.height, TRANSPARENT);

  for (let y = 0; y < grid.height; y += 1) {
    for (let x = 0; x < grid.width; x += 1) {
      let sourceX = x - dx;
      let sourceY = y - dy;

      if (wrap) {
        sourceX = ((sourceX % grid.width) + grid.width) % grid.width;
        sourceY = ((sourceY % grid.height) + grid.height) % grid.height;
      } else if (sourceX < 0 || sourceY < 0 || sourceX >= grid.width || sourceY >= grid.height) {
        continue;
      }

      out.cells[y * grid.width + x] = grid.cells[sourceY * grid.width + sourceX] as Cell;
    }
  }

  return out;
}

function swapIndices(grid: Grid, from: Cell, to: Cell): Grid {
  const out = cloneGrid(grid);
  for (let i = 0; i < out.cells.length; i += 1) {
    if (out.cells[i] === from) {
      out.cells[i] = to;
    }
  }
  return out;
}

/** Moves every non-transparent pixel along a palette ramp, clamped at both ends. */
function rampBy(grid: Grid, steps: number, paletteSize: number): Grid {
  const out = cloneGrid(grid);
  for (let i = 0; i < out.cells.length; i += 1) {
    const cell = out.cells[i] as Cell;
    if (cell === TRANSPARENT) {
      continue;
    }
    out.cells[i] = Math.max(0, Math.min(paletteSize - 1, cell + steps)) as Cell;
  }
  return out;
}

/**
 * Builds a cycle from one base frame.
 *
 * The returned array always starts with the base frame and never repeats it at
 * the end — a looping player shows frame 0 again itself, and including it twice
 * is the most common way a hand-built cycle stutters.
 */
export function animateProcedural(
  base: Grid,
  preset: ProceduralPreset,
  options: ProceduralOptions = {},
  paletteSize = 16
): Grid[] {
  const amplitude = Math.max(1, Math.trunc(options.amplitude ?? 1));

  switch (preset) {
    case "bob": {
      // Down and back. Two frames is the classic idle; more just holds longer.
      const count = Math.max(2, options.frames ?? 2);
      return Array.from({ length: count }, (_, index) =>
        index < count / 2 ? cloneGrid(base) : shifted(base, 0, amplitude, false)
      );
    }

    case "blink": {
      const count = Math.max(2, options.frames ?? 4);
      const [from, to] = [options.indices?.[0] ?? 5, options.indices?.[1] ?? 0];
      // The blink is a single frame at the end, so the eye is open most of the cycle.
      return Array.from({ length: count }, (_, index) =>
        index === count - 1 ? swapIndices(base, from, to) : cloneGrid(base)
      );
    }

    case "flicker": {
      const count = Math.max(2, options.frames ?? 3);
      return Array.from({ length: count }, (_, index) =>
        index % 2 === 0 ? cloneGrid(base) : rampBy(base, amplitude, paletteSize)
      );
    }

    case "pulse": {
      // Up the ramp and back down, so the cycle closes on itself.
      const count = Math.max(2, options.frames ?? 4);
      const half = Math.max(1, Math.floor(count / 2));
      return Array.from({ length: count }, (_, index) => {
        const step = index <= half ? index : count - index;
        return rampBy(base, Math.round((step / half) * amplitude), paletteSize);
      });
    }

    case "scroll": {
      const count = Math.max(2, options.frames ?? 4);
      const dx = options.dx ?? 1;
      const dy = options.dy ?? 0;
      // Wrapped, so a scrolling tile stays seamless while it moves.
      return Array.from({ length: count }, (_, index) =>
        shifted(base, dx * index, dy * index, true)
      );
    }

    case "sway": {
      const count = Math.max(2, options.frames ?? 4);
      return Array.from({ length: count }, (_, index) => {
        const phase = Math.sin((index / count) * Math.PI * 2);
        return swayRows(base, Math.round(phase * amplitude));
      });
    }

    default: {
      const exhaustive: never = preset;
      throw new Error(`Unknown procedural preset: ${String(exhaustive)}`);
    }
  }
}

/** Leans the image, displacing rows more the higher they sit — foliage, hair, banners. */
function swayRows(grid: Grid, maxOffset: number): Grid {
  const out = createGrid(grid.width, grid.height, TRANSPARENT);

  for (let y = 0; y < grid.height; y += 1) {
    const weight = grid.height <= 1 ? 0 : (grid.height - 1 - y) / (grid.height - 1);
    const offset = Math.round(maxOffset * weight);

    for (let x = 0; x < grid.width; x += 1) {
      const sourceX = x - offset;
      if (sourceX < 0 || sourceX >= grid.width) {
        continue;
      }
      out.cells[y * grid.width + x] = grid.cells[y * grid.width + sourceX] as Cell;
    }
  }

  return out;
}
