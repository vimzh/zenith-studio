import { rgbToOklab, type Oklab } from "@zenith/core";
import { pixelAt, type DetectedGrid, type RasterImage } from "./types";

/**
 * Resolving one cell to one colour.
 *
 * Three decisions matter here, and each fixes a specific visible failure:
 *
 * 1. **Medoid, not mean.** The result must be a colour that actually occurs in
 *    the source. A mean invents an in-between colour that then has to be
 *    quantised away, and on a two-tone edge it invents exactly the blend the
 *    pipeline exists to remove.
 * 2. **Candidates restricted to the cell core.** Pixels near a cell boundary are
 *    blends of neighbouring cells. Including them drags the medoid toward the
 *    blend. This restriction *is* the anti-aliasing removal — there is no
 *    separate de-aliasing pass.
 * 3. **Thin-feature rescue.** A 1px outline covers a minority of the cells it
 *    crosses and loses a plain vote every time. A colour that spans the cell in
 *    one axis and continues into the neighbouring cell is a line, not noise, and
 *    gets its cost discounted so it survives.
 */

/** Fraction of the cell trimmed from each side before choosing candidates. */
const CORE_MARGIN = 0.3;
/** Cap on samples per cell: beyond this the medoid stops changing and only costs time. */
const MAX_SAMPLES = 36;
/** Alpha at or above this counts as covered; below it the pixel is background. */
const COVERAGE_THRESHOLD = 128;
/** A colour covering less than this share of the cell is a candidate thin feature. */
const THIN_MAX_SHARE = 0.45;
/** …and must span at least this much of the cell in one axis to qualify. */
const THIN_MIN_SPAN = 0.65;
/** Cost multiplier applied to a qualifying thin feature, so it can win a vote it would lose. */
const THIN_DISCOUNT = 0.2;

interface Sample {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
  readonly oklab: Oklab;
  readonly x: number;
  readonly y: number;
}

function bounds(start: number, cell: number, limit: number): [number, number] {
  const from = Math.max(0, Math.round(start));
  const to = Math.min(limit, Math.round(start + cell));
  return [from, Math.max(from + 1, to)];
}

function collect(
  image: RasterImage,
  x0: number,
  x1: number,
  y0: number,
  y1: number
): Sample[] {
  const width = x1 - x0;
  const height = y1 - y0;
  const stepX = Math.max(1, Math.ceil(width / Math.sqrt(MAX_SAMPLES)));
  const stepY = Math.max(1, Math.ceil(height / Math.sqrt(MAX_SAMPLES)));

  const samples: Sample[] = [];
  for (let y = y0; y < y1; y += stepY) {
    for (let x = x0; x < x1; x += stepX) {
      const [r, g, b, a] = pixelAt(image, x, y);
      samples.push({ r, g, b, a, oklab: rgbToOklab({ r, g, b }), x, y });
    }
  }
  return samples;
}

function distanceSquared(a: Oklab, b: Oklab): number {
  const dL = a.L - b.L;
  const da = a.a - b.a;
  const db = a.b - b.b;
  return dL * dL + da * da + db * db;
}

/** True when `colour` also appears just outside the cell, on the side it runs toward. */
function continuesBeyond(
  image: RasterImage,
  sample: Sample,
  x0: number,
  x1: number,
  y0: number,
  y1: number
): boolean {
  const matches = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= image.width || y >= image.height) {
      return false;
    }
    const [r, g, b] = pixelAt(image, x, y);
    const dr = r - sample.r;
    const dg = g - sample.g;
    const db = b - sample.b;
    return dr * dr + dg * dg + db * db <= 192;
  };

  const probes = 4;
  for (let n = 0; n < probes; n += 1) {
    const alongY = y0 + Math.floor(((n + 0.5) * (y1 - y0)) / probes);
    const alongX = x0 + Math.floor(((n + 0.5) * (x1 - x0)) / probes);
    if (matches(x0 - 1, alongY) || matches(x1, alongY)) {
      return true;
    }
    if (matches(alongX, y0 - 1) || matches(alongX, y1)) {
      return true;
    }
  }
  return false;
}

export interface ResolvedCell {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  /** Binary: 0 or 255. Invariant 2 — no pixel is ever partially transparent. */
  readonly a: number;
}

export function resolveCell(
  image: RasterImage,
  x: number,
  y: number,
  cellWidth: number,
  cellHeight: number
): ResolvedCell {
  const [x0, x1] = bounds(x, cellWidth, image.width);
  const [y0, y1] = bounds(y, cellHeight, image.height);

  // Coverage is measured over the whole cell; colour is chosen from its core.
  const all = collect(image, x0, x1, y0, y1);
  const covered = all.filter((sample) => sample.a >= COVERAGE_THRESHOLD);
  if (covered.length * 2 < all.length) {
    return { r: 0, g: 0, b: 0, a: 0 };
  }

  const marginX = Math.min(Math.floor((x1 - x0) * CORE_MARGIN), Math.max(0, Math.floor((x1 - x0 - 1) / 2)));
  const marginY = Math.min(Math.floor((y1 - y0) * CORE_MARGIN), Math.max(0, Math.floor((y1 - y0 - 1) / 2)));
  const core = collect(image, x0 + marginX, x1 - marginX, y0 + marginY, y1 - marginY).filter(
    (sample) => sample.a >= COVERAGE_THRESHOLD
  );

  const candidates = core.length > 0 ? core : covered;
  const population = covered;

  let winner = candidates[0] as Sample;
  let bestCost = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    let cost = 0;
    let matching = 0;
    let minX = candidate.x;
    let maxX = candidate.x;
    let minY = candidate.y;
    let maxY = candidate.y;

    for (const other of population) {
      const d = distanceSquared(candidate.oklab, other.oklab);
      cost += d;
      if (d <= 0.0004) {
        matching += 1;
        minX = Math.min(minX, other.x);
        maxX = Math.max(maxX, other.x);
        minY = Math.min(minY, other.y);
        maxY = Math.max(maxY, other.y);
      }
    }

    const share = matching / population.length;
    const spanX = (maxX - minX + 1) / (x1 - x0);
    const spanY = (maxY - minY + 1) / (y1 - y0);
    const isThinFeature =
      share < THIN_MAX_SHARE &&
      (spanX >= THIN_MIN_SPAN || spanY >= THIN_MIN_SPAN) &&
      continuesBeyond(image, candidate, x0, x1, y0, y1);

    const adjusted = isThinFeature ? cost * THIN_DISCOUNT : cost;

    // Strict `<` in a fixed scan order: ties resolve to the first candidate, so
    // the same input always produces the same output. Determinism is required —
    // an agent and a human share this grid, and a re-run that shuffles colours
    // would make every diff meaningless.
    if (adjusted < bestCost) {
      bestCost = adjusted;
      winner = candidate;
    }
  }

  return { r: winner.r, g: winner.g, b: winner.b, a: 255 };
}

/** Resamples the image down to the detected grid, one resolved colour per cell. */
export function resampleToGrid(image: RasterImage, grid: DetectedGrid): RasterImage {
  const width = Math.max(1, grid.x.count);
  const height = Math.max(1, grid.y.count);
  const out = new Uint8ClampedArray(width * height * 4);

  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const cell = resolveCell(
        image,
        grid.x.phase + column * grid.x.cell,
        grid.y.phase + row * grid.y.cell,
        grid.x.cell,
        grid.y.cell
      );
      const offset = (row * width + column) * 4;
      out[offset] = cell.r;
      out[offset + 1] = cell.g;
      out[offset + 2] = cell.b;
      out[offset + 3] = cell.a;
    }
  }

  return { width, height, data: out };
}
