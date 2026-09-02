/**
 * Types for the pixelisation pipeline.
 *
 * The pipeline turns a raster image — a generated one, or something a user
 * uploaded — into a true indexed grid. It is pure TypeScript over byte arrays
 * with no DOM dependency, so it runs in a Web Worker and is testable without a
 * browser.
 */

/** RGBA bytes, row-major, 4 bytes per pixel. The shape `ImageData` already has. */
export interface RasterImage {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

export interface Axis {
  /** Edge strength between position i-1 and i. Length is `length + 1`. */
  readonly profile: Float64Array;
  readonly length: number;
}

export interface AxisGrid {
  /** Cell size in source pixels. Non-integer sizes are expected and supported. */
  readonly cell: number;
  /** Offset of the first boundary, in source pixels. */
  readonly phase: number;
  readonly count: number;
}

export interface DetectedGrid {
  readonly x: AxisGrid;
  readonly y: AxisGrid;
  /** 0–1. Below `CONFIDENCE_FLOOR` the caller should preserve rather than resample. */
  readonly confidence: number;
}

/** How an input should be handled. */
export type InputKind =
  /** Already true pixel art at 1:1. Do not resample. */
  | "native"
  /** Pixel art at an integer upscale. Divide by the detected scale. */
  | "scaled"
  /** Pixel-art-styled but off-grid or anti-aliased. Detect the grid and resample. */
  | "soft"
  /** Continuous tone — a photo or painting. Choose a size and resample. */
  | "continuous";

export function pixelAt(
  image: RasterImage,
  x: number,
  y: number
): [number, number, number, number] {
  const offset = (y * image.width + x) * 4;
  return [
    image.data[offset] ?? 0,
    image.data[offset + 1] ?? 0,
    image.data[offset + 2] ?? 0,
    image.data[offset + 3] ?? 0,
  ];
}

export function createRaster(width: number, height: number): RasterImage {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}
