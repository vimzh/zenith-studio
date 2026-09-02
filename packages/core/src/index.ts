/**
 * `@zenith/core` — the pixel document model.
 *
 * Phase 01 of the build plan (`docs/phases/01-core-data-model.md`): an
 * invariant-enforcing indexed-grid store with undo/redo, plus the Oklab
 * conversion and quantiser that palette matching needs now and the pixelisation
 * pipeline needs in phase 08.
 *
 * No rendering, no persistence, no animation semantics — the frame array exists
 * here, but nothing in this package interprets it as motion.
 */

export {
  MAX_PALETTE_SIZE,
  TRANSPARENT,
  type Cell,
  type DocumentMetadata,
  type Frame,
  type Grid,
  type Layer,
  type MirrorAxis,
  type Oklab,
  type Palette,
  type PaletteColor,
  type PaletteIndex,
  type PixelDocument,
  type PixelPatch,
  type Region,
  type ResolvedTarget,
  type Rgb,
  type Target,
} from "./types";

export { PixelError, type PixelErrorCode } from "./errors";

export {
  DEFAULT_CANVAS_SIZES,
  DIRECTION_SETS,
  OUTLINES,
  PROJECTIONS,
  PROPORTIONS,
  SHADINGS,
  VIEWS,
  checkStyleConsistency,
  conformToStyle,
  createStyleProfile,
  describeStyleReport,
  expectedSize,
  styleBrief,
  type CanvasSizes,
  type DirectionSetName,
  type Outline,
  type Projection,
  type Proportions,
  type Shading,
  type StyleBriefOptions,
  type StyleProfile,
  type StyleReport,
  type StyleViolation,
  type StyleViolationKind,
  type View,
} from "./style";

export {
  SEAM_FAILURE,
  SEAM_TOLERANCE,
  checkSeamlessTiling,
  describeSeamMismatch,
  type SeamVerdict,
  type SeamMismatch,
  type SeamReport,
  type SeamlessTilingReport,
} from "./analysis";

export {
  cloneGrid,
  containsPoint,
  countCells,
  createGrid,
  cropGrid,
  decodeCell,
  decodeGrid,
  encodeCell,
  encodeGrid,
  encodeRows,
  getCell,
  gridFromRows,
  gridsEqual,
  isCell,
  normalizeRegion,
  offsetOf,
  peekCell,
  scaleGrid,
  silhouette,
  wholeGrid,
} from "./grid";

export {
  formatHex,
  hexToOklab,
  normalizeHex,
  oklabDistance,
  oklabDistanceSquared,
  oklabToRgb,
  parseHex,
  rgbToOklab,
} from "./color/oklab";

export {
  oklabToHex,
  quantize,
  type QuantizeOptions,
  type QuantizeResult,
} from "./color/quantize";

export {
  BUILTIN_PALETTES,
  builtinPalette,
  createPalette,
  isCellInPalette,
  lightnessRamp,
  nearestIndex,
  paletteColor,
  paletteFromQuantize,
  paletteHexes,
  type PaletteInput,
} from "./palette";

export {
  DEFAULT_FRAME_DURATION_MS,
  cloneDocument,
  compositeFrame,
  createDocument,
  createFrame,
  createLayer,
  frameStats,
  nextId,
  validateDocument,
  type CreateDocumentInput,
  type CreateFrameInput,
  type CreateLayerInput,
  type DocumentStats,
} from "./document";

export {
  bucketFill,
  clearRegion,
  fillRegion,
  mirror,
  replaceColor,
  setPixels,
  shift,
  writeRegion,
  type BucketFillOptions,
  type CellChange,
  type PixelWrite,
  type ShiftOptions,
} from "./mutations";

export {
  DocumentStore,
  createStore,
  type AddFrameOptions,
  type CompoundHistoryEntry,
  type DocumentStoreOptions,
  type FrameChange,
  type FrameHistoryEntry,
  type HistoryEntry,
  type PixelHistoryEntry,
} from "./store";

export {
  DOCUMENT_FORMAT,
  DOCUMENT_VERSION,
  deserializeDocument,
  documentFromJSON,
  documentToJSON,
  serializeDocument,
  type SerializedDocument,
  type SerializedFrame,
  type SerializedLayer,
  type SerializedPalette,
} from "./serialize";
