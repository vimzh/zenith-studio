import { createGrid, quantize, TRANSPARENT, type Cell, type Grid } from "@zenith/core";
import { CONFIDENCE_FLOOR, detectGrid } from "./grid";
import { detectNativeScale } from "./native-scale";
import { resampleToGrid } from "./resolve";
import type { DetectedGrid, InputKind, RasterImage } from "./types";

/**
 * The pixelisation pipeline: raster image in, indexed grid out.
 *
 *   classify → native-scale shortcut → grid detection → cell resolution →
 *   alpha binarisation → palette quantisation → indexed grid
 *
 * It never emits a PNG. The output is the canonical indexed representation, so
 * the palette cap is a constraint the resampler respects rather than a filter
 * applied afterwards — which is what stops the downsampler inventing colours the
 * palette cannot express.
 */

export interface PixelizeOptions {
  /** Target width in cells. Omitted means "use the detected grid". */
  readonly targetWidth?: number;
  readonly targetHeight?: number;
  readonly maxColors?: number;
  /** Ignore the detector and force this cell size. */
  readonly forceScale?: number;
}

export interface PixelizeResult {
  readonly grid: Grid;
  readonly palette: readonly string[];
  readonly kind: InputKind;
  readonly confidence: number;
  /** Detected cell size, or 1 when the input was already native. */
  readonly scale: number;
  /**
   * Alternative sizes worth offering when confidence is low — the chosen grid
   * plus its harmonics, since size mistakes in this domain are almost always
   * harmonic. The agent proposes; the human picks.
   */
  readonly alternatives: readonly { width: number; height: number }[];
  readonly warnings: readonly string[];
}

function uniformGrid(width: number, height: number, cell: number, phase = 0): DetectedGrid {
  return {
    x: { cell, phase, count: Math.max(1, Math.round(width / cell)) },
    y: { cell, phase, count: Math.max(1, Math.round(height / cell)) },
    confidence: 1,
  };
}

function harmonics(width: number, height: number): { width: number; height: number }[] {
  const out: { width: number; height: number }[] = [];
  for (const factor of [2, 3, 4]) {
    if (width % factor === 0 && height % factor === 0 && width / factor >= 4) {
      out.push({ width: width / factor, height: height / factor });
    }
    if (width * factor <= 256 && height * factor <= 256) {
      out.push({ width: width * factor, height: height * factor });
    }
  }
  return out;
}

/** Routes the input, so a decision about *how* to resample precedes the resampling. */
export function classify(image: RasterImage, scale: number, grid: DetectedGrid): InputKind {
  if (scale > 1) {
    return "scaled";
  }
  if (grid.confidence >= CONFIDENCE_FLOOR) {
    return grid.x.cell <= 1.5 && grid.y.cell <= 1.5 ? "native" : "soft";
  }
  return image.width <= 128 && image.height <= 128 ? "native" : "continuous";
}

export function pixelize(image: RasterImage, options: PixelizeOptions = {}): PixelizeResult {
  const warnings: string[] = [];

  if (image.width < 1 || image.height < 1 || image.data.length !== image.width * image.height * 4) {
    throw new Error(
      `Expected an RGBA buffer of ${String(image.width * image.height * 4)} bytes for a ${String(image.width)}x${String(image.height)} image, received ${String(image.data.length)}.`
    );
  }

  const scale = options.forceScale ?? detectNativeScale(image);
  const detected = detectGrid(image);
  const kind = classify(image, scale, detected);

  let plan: DetectedGrid;
  if (options.targetWidth !== undefined) {
    const targetHeight =
      options.targetHeight ?? Math.max(1, Math.round((options.targetWidth * image.height) / image.width));
    plan = {
      x: { cell: image.width / options.targetWidth, phase: 0, count: options.targetWidth },
      y: { cell: image.height / targetHeight, phase: 0, count: targetHeight },
      confidence: 1,
    };
  } else if (scale > 1) {
    plan = uniformGrid(image.width, image.height, scale);
  } else if (kind === "native") {
    plan = uniformGrid(image.width, image.height, 1);
  } else if (kind === "soft") {
    plan = detected;
  } else {
    // Continuous tone with no grid to find. Pick a sensible short side rather
    // than guessing a cell size the image does not have.
    const shortSide = Math.min(image.width, image.height);
    const cell = Math.max(1, Math.round(shortSide / 48));
    plan = uniformGrid(image.width, image.height, cell);
    warnings.push(
      "No pixel grid was detected, so a size was chosen from the image dimensions. Pass targetWidth to override."
    );
  }

  if (detected.confidence < CONFIDENCE_FLOOR && options.targetWidth === undefined && scale === 1) {
    warnings.push(
      `Grid confidence is low (${detected.confidence.toFixed(2)}). Check the result, or pass targetWidth.`
    );
  }

  const resampled = plan.x.cell === 1 && plan.y.cell === 1 ? image : resampleToGrid(image, plan);
  const reduced = quantize(resampled.data, { maxColors: options.maxColors });

  const grid = createGrid(resampled.width, resampled.height, TRANSPARENT);
  for (let i = 0; i < reduced.indices.length; i += 1) {
    grid.cells[i] = reduced.indices[i] as Cell;
  }

  return {
    grid,
    palette: reduced.colors,
    kind,
    confidence: detected.confidence,
    scale,
    alternatives: harmonics(resampled.width, resampled.height),
    warnings,
  };
}
