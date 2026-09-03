/** Core value types for the indexed pixel document model. */

/** Sentinel cell value for a transparent pixel. Serialises as `.`. */
export const TRANSPARENT = -1;

/** Indexed PNG/GIF leave one byte value available for transparency. */
export const MAX_PALETTE_SIZE = 255;

/** Keep generation's default compact palette independent of the storage cap. */
export const DEFAULT_PALETTE_SIZE = 16;

/** A palette index (0–254) or {@link TRANSPARENT}. */
export type Cell = number;

/** A palette index, 0-based. */
export type PaletteIndex = number;

export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export interface Oklab {
  readonly L: number;
  readonly a: number;
  readonly b: number;
}

/**
 * A 2D array of {@link Cell} values in row-major order.
 *
 * `cells` is an `Int16Array` to hold both -1 and indices through 254. Grids handed out by
 * {@link DocumentStore} are always copies, so mutating one cannot reach store
 * state — see `store.ts`.
 */
export interface Grid {
  readonly width: number;
  readonly height: number;
  readonly cells: Int16Array;
}

/** An axis-aligned rectangle in asset-local pixel coordinates (origin top-left). */
export interface Region {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface PaletteColor {
  /** Normalised lowercase `#rrggbb`. */
  readonly hex: string;
  /** Cached Oklab coordinates, so nearest-colour matching never re-converts. */
  readonly oklab: Oklab;
}

export interface Palette {
  readonly id: string;
  readonly name: string;
  readonly colors: readonly PaletteColor[];
}

/**
 * One layer of a frame.
 *
 * Layers do not ship as a feature until phase 15. The abstraction is carried
 * from phase 01 anyway because retrofitting a composite through every phase
 * that touches pixels is far more expensive than an unused field.
 */
export interface Layer {
  readonly id: string;
  readonly name: string;
  readonly visible: boolean;
  readonly grid: Grid;
}

/** A frame is a composite of layers. Nothing interprets frames as motion until phase 09. */
export interface Frame {
  readonly id: string;
  readonly durationMs: number;
  readonly layers: readonly Layer[];
}

export interface DocumentMetadata {
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly tags: readonly string[];
}

export interface PixelDocument {
  readonly id: string;
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly palette: Palette;
  readonly frames: readonly Frame[];
  readonly metadata: DocumentMetadata;
}

/** Addresses one layer of one frame. Omitted members resolve to the store's active selection. */
export interface Target {
  readonly frame?: number;
  readonly layer?: number;
}

/** A fully resolved {@link Target}. */
export interface ResolvedTarget {
  readonly frame: number;
  readonly layer: number;
}

export type MirrorAxis = "horizontal" | "vertical";

/** A single-cell change, and the unit of undo. */
export interface PixelPatch {
  readonly frame: number;
  readonly layer: number;
  /** Row-major offset into the layer grid: `y * width + x`. */
  readonly offset: number;
  readonly from: Cell;
  readonly to: Cell;
}
