/**
 * Structured failures for the pixel document model.
 *
 * Every rejection carries a machine-readable `code` and a message that says what
 * was wrong *and* what to do instead — the WebMCP tool layer (phase 03) returns
 * these verbatim to agents, so vague messages cost real accuracy.
 */

export type PixelErrorCode =
  /** Invariant 1 — a cell value is neither a palette index nor transparent. */
  | "invalid_index"
  /** Invariant 2 — a colour carries partial alpha. */
  | "alpha_not_binary"
  /** Invariant 3 — an operation would change document dimensions. */
  | "dimension_mismatch"
  /** Invariant 4 — a coordinate or scale factor is not an integer. */
  | "non_integer"
  /** Invariant 5 — a frame disagrees with its document on size or palette. */
  | "frame_mismatch"
  | "out_of_bounds"
  | "invalid_dimensions"
  | "invalid_color"
  | "palette_overflow"
  | "invalid_encoding"
  | "unknown_target"
  | "invalid_document"
  | "invalid_argument"
  | "no_transaction";

export class PixelError extends Error {
  readonly code: PixelErrorCode;

  constructor(code: PixelErrorCode, message: string) {
    super(message);
    this.name = "PixelError";
    this.code = code;
  }
}

export function fail(code: PixelErrorCode, message: string): never {
  throw new PixelError(code, message);
}

/** Guards invariant 4 — fractional coordinates and sizes are rejected, never rounded. */
export function requireInteger(value: number, label: string): number {
  if (!Number.isInteger(value)) {
    fail(
      "non_integer",
      `${label} must be an integer, received ${String(value)}. Pixel coordinates and sizes are whole numbers; rasterisation is nearest-neighbour only.`,
    );
  }
  return value;
}

export function requirePositiveInteger(value: number, label: string): number {
  requireInteger(value, label);
  if (value <= 0) {
    fail("invalid_dimensions", `${label} must be greater than 0, received ${String(value)}.`);
  }
  return value;
}
