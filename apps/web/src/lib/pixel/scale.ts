/** Guards shared by anything that resamples. Kept separate so tests need no DOM. */
export function requireIntegerScale(scale: number): number {
  if (!Number.isInteger(scale) || scale < 1) {
    throw new Error(
      `Scale must be an integer of at least 1, received ${String(scale)}. Pixel art is only ever resampled at whole multiples.`
    );
  }
  return scale;
}
