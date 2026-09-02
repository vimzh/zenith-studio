import { rgbToOklab } from "@zenith/core";
import { axisProfiles, energyAtBoundaries, meanEdge, peaks } from "./signals";
import { pixelAt, type Axis, type AxisGrid, type DetectedGrid, type RasterImage } from "./types";

/**
 * Grid detection.
 *
 * The crux, and the reason a naive implementation fails: **reconstruction error
 * decreases monotonically as cells get finer**. Score candidates on how well
 * they reproduce the image and the winner is always the finest grid on offer —
 * half or a third of the true cell, forever.
 *
 * The fix is a second metric that pulls the other way. `boundaryContrast` is
 * the edge energy at the boundaries a grid predicts, divided by the average
 * edge energy everywhere. A correct grid puts its boundaries on real edges, so
 * the ratio is high. A grid twice too fine puts half its boundaries inside flat
 * cell interiors, which dilutes the numerator — so over-splitting is penalised
 * rather than rewarded.
 *
 * **Both metrics are required, and each catches what the other cannot.** A grid
 * twice too *coarse* also lands every boundary on a real edge, so contrast alone
 * is equally happy with it — it only rules out grids that are too fine.
 * Reconstruction error rules out the coarse ones, because a cell spanning two
 * different colours cannot represent either. Scoring on contrast alone returns
 * 2x the true cell; scoring on reconstruction alone returns 1/2 of it. Only the
 * pair converges on the truth.
 */

/** Below this the caller should preserve the input rather than resample it. */
export const CONFIDENCE_FLOOR = 0.3;

/** A cell must repeat at least this often; one huge cell trivially fits every boundary. */
const MIN_PERIODS = 3;
/** Ratio of 1.0 means the predicted boundaries are no better than average — no grid. */
const MIN_CONTRAST = 1.08;
const MAX_CANDIDATES = 48;
const MIN_CELL = 2;

function axisCandidates(axis: Axis): number[] {
  const maxCell = Math.floor(axis.length / MIN_PERIODS);
  if (maxCell < MIN_CELL) {
    return [];
  }

  const cells = new Set<number>();

  // Every integer cell that repeats enough times.
  for (let cell = MIN_CELL; cell <= maxCell; cell += 1) {
    cells.add(cell);
  }

  // Spacings implied by the strongest observed edges. This is what finds
  // non-integer cell sizes, which integer enumeration alone cannot reach.
  const observed = peaks(axis, 24).sort((a, b) => a - b);
  for (let i = 0; i < observed.length; i += 1) {
    for (let j = i + 1; j < Math.min(i + 6, observed.length); j += 1) {
      const span = (observed[j] as number) - (observed[i] as number);
      const steps = j - i;
      const cell = span / steps;
      if (cell >= MIN_CELL && cell <= maxCell) {
        cells.add(Math.round(cell * 4) / 4);
      }
    }
  }

  return [...cells].slice(0, MAX_CANDIDATES);
}

/** Best offset for a cell size, chosen by the boundary evidence it lands on. */
function bestPhase(axis: Axis, cell: number): { phase: number; energy: number } {
  let phase = 0;
  let energy = -1;

  const step = cell < 4 ? 0.25 : 0.5;
  for (let candidate = 0; candidate < cell - 1e-6; candidate += step) {
    const value = energyAtBoundaries(axis, cell, candidate);
    if (value > energy) {
      energy = value;
      phase = candidate;
    }
  }

  return { phase, energy: Math.max(energy, 0) };
}

interface Scored extends AxisGrid {
  readonly contrast: number;
}

/** Top candidates for one axis, ranked by boundary contrast. */
function rankAxis(axis: Axis, limit: number): Scored[] {
  const average = meanEdge(axis);
  if (average <= 0) {
    return [];
  }

  const scored: Scored[] = [];
  for (const cell of axisCandidates(axis)) {
    const { phase, energy } = bestPhase(axis, cell);
    const contrast = energy / average;
    if (contrast >= MIN_CONTRAST) {
      scored.push({ cell, phase, contrast, count: Math.max(1, Math.round(axis.length / cell)) });
    }
  }

  scored.sort((a, b) => b.contrast - a.contrast || a.cell - b.cell);
  return scored.slice(0, limit);
}

/**
 * Mean Oklab distance from sampled pixels to their own cell's centre colour.
 *
 * This is what rules out a grid that is too coarse: a cell spanning two colours
 * has to pick one, and every pixel of the other colour contributes error.
 */
function reconstructionError(image: RasterImage, x: Scored, y: Scored): number {
  let total = 0;
  let counted = 0;

  const columns = Math.min(x.count, 24);
  const rows = Math.min(y.count, 24);

  for (let row = 0; row < rows; row += 1) {
    const cellY = y.phase + Math.floor((row * y.count) / rows) * y.cell;
    for (let column = 0; column < columns; column += 1) {
      const cellX = x.phase + Math.floor((column * x.count) / columns) * x.cell;

      const centreX = Math.min(image.width - 1, Math.max(0, Math.round(cellX + x.cell / 2)));
      const centreY = Math.min(image.height - 1, Math.max(0, Math.round(cellY + y.cell / 2)));
      const [cr, cg, cb] = pixelAt(image, centreX, centreY);
      const centre = rgbToOklab({ r: cr, g: cg, b: cb });

      const stepX = Math.max(1, Math.floor(x.cell / 3));
      const stepY = Math.max(1, Math.floor(y.cell / 3));
      for (let dy = 0; dy < y.cell; dy += stepY) {
        for (let dx = 0; dx < x.cell; dx += stepX) {
          const px = Math.round(cellX + dx);
          const py = Math.round(cellY + dy);
          if (px < 0 || py < 0 || px >= image.width || py >= image.height) {
            continue;
          }
          const [r, g, b] = pixelAt(image, px, py);
          const sample = rgbToOklab({ r, g, b });
          const dL = sample.L - centre.L;
          const da = sample.a - centre.a;
          const db = sample.b - centre.b;
          total += Math.sqrt(dL * dL + da * da + db * db);
          counted += 1;
        }
      }
    }
  }

  return counted === 0 ? 0 : total / counted;
}

export function detectGrid(image: RasterImage): DetectedGrid {
  const { x, y } = axisProfiles(image);
  const rankedX = rankAxis(x, 6);
  const rankedY = rankAxis(y, 6);

  if (rankedX.length === 0 || rankedY.length === 0) {
    return {
      x: { cell: 1, phase: 0, count: image.width },
      y: { cell: 1, phase: 0, count: image.height },
      confidence: 0,
    };
  }

  let bestX = rankedX[0] as Scored;
  let bestY = rankedY[0] as Scored;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const candidateX of rankedX) {
    for (const candidateY of rankedY) {
      const contrast = Math.sqrt(candidateX.contrast * candidateY.contrast);
      const error = reconstructionError(image, candidateX, candidateY);
      // Contrast rewards boundaries that sit on real edges; error punishes
      // cells that span more than one colour. Neither alone finds the truth.
      const score = contrast - error * 6;
      if (score > bestScore) {
        bestScore = score;
        bestX = candidateX;
        bestY = candidateY;
      }
    }
  }

  const normalise = (contrast: number) => Math.min(1, Math.max(0, (contrast - 1) / 1.5));
  const confidence = Math.sqrt(normalise(bestX.contrast) * normalise(bestY.contrast));

  return {
    x: { cell: bestX.cell, phase: bestX.phase, count: bestX.count },
    y: { cell: bestY.cell, phase: bestY.phase, count: bestY.count },
    confidence,
  };
}
