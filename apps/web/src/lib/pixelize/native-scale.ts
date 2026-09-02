import { pixelAt, type RasterImage } from "./types";

/**
 * Detects an integer upscale factor, exactly and in one pass.
 *
 * Pixel art that has been scaled by a whole number has every colour transition
 * on a multiple of that factor, and so does the image's own width and height.
 * The greatest common divisor of all of them therefore *is* the scale — no
 * search, no scoring, no thresholds.
 *
 * Returns 1 for art that is already native, which is the correct answer for a
 * large share of real input and worth establishing before any expensive search.
 */

/** Ignore transitions weaker than this: JPEG ringing produces tiny non-zero deltas everywhere. */
const MIN_TRANSITION = 12;
/** Below this many observed transitions, a shared divisor is coincidence rather than a lattice. */
const MIN_EVIDENCE = 4;

function gcd(a: number, b: number): number {
  let x = a;
  let y = b;
  while (y !== 0) {
    [x, y] = [y, x % y];
  }
  return x;
}

/** Positions where the colour changes along one row or column. */
function transitions(
  image: RasterImage,
  length: number,
  read: (index: number) => [number, number, number, number]
): number[] {
  const positions: number[] = [];
  let previous = read(0);

  for (let i = 1; i < length; i += 1) {
    const current = read(i);
    const delta =
      Math.abs(current[0] - previous[0]) +
      Math.abs(current[1] - previous[1]) +
      Math.abs(current[2] - previous[2]) +
      Math.abs(current[3] - previous[3]);

    if (delta >= MIN_TRANSITION) {
      positions.push(i);
    }
    previous = current;
  }

  return positions;
}

export function detectNativeScale(image: RasterImage): number {
  if (image.width === 0 || image.height === 0) {
    return 1;
  }

  // Seed with the dimensions: the scale must divide both.
  let divisor = gcd(image.width, image.height);
  // A scale claimed on no evidence is a guess. A smooth gradient has no
  // transitions at all, and without this the seed would survive untouched and
  // report gcd(width, height) — for a 64x64 image, a scale of 64.
  let evidence = 0;

  // Sample a limited number of lines. One line through a flat region yields no
  // transitions, so several are needed, but every line is redundant once the
  // divisor reaches 1.
  const rows = Math.min(image.height, 24);
  const columns = Math.min(image.width, 24);

  for (let n = 0; n < rows && divisor > 1; n += 1) {
    const y = Math.floor(((n + 0.5) * image.height) / rows);
    for (const x of transitions(image, image.width, (i) => pixelAt(image, i, y))) {
      evidence += 1;
      divisor = gcd(divisor, x);
      if (divisor === 1) {
        return 1;
      }
    }
  }

  for (let n = 0; n < columns && divisor > 1; n += 1) {
    const x = Math.floor(((n + 0.5) * image.width) / columns);
    for (const y of transitions(image, image.height, (i) => pixelAt(image, x, i))) {
      evidence += 1;
      divisor = gcd(divisor, y);
      if (divisor === 1) {
        return 1;
      }
    }
  }

  // Require enough transitions that the divisor means something. A handful of
  // edges can share a large common factor by coincidence.
  return evidence >= MIN_EVIDENCE ? Math.max(1, divisor) : 1;
}
