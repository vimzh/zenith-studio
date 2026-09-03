import type { RasterImage } from "./types";

/**
 * Framing a generated image before it is pixelised.
 *
 * A model asked for a sprite returns the subject floating in the middle of a
 * square frame on a flat background. Measured on a 1024x1024 generation of "a
 * small knight in blue armour": the knight occupied 484x702 — 47% of the width
 * — and the remaining 53% was solid blue with no alpha channel at all.
 *
 * `pixelize` divides the *whole* frame into a uniform grid, so that image at
 * 32 cells wide spent 17 of its 32 columns on background and drew the knight in
 * about 15x22. Under half the linear resolution the canvas actually offers,
 * which is why generated characters came out muddy while the same pipeline
 * handled a tightly-cropped reference cleanly.
 *
 * So: drop the background, crop to what is left, and scale the subject to fill
 * the canvas. This runs *before* pixelisation, on the raster, because the grid
 * detector and the quantiser should both be looking at the subject rather than
 * at a field of background.
 */

/** Squared Euclidean distance in RGB. Cheap, and adequate for flat backgrounds. */
function distance(
  data: Uint8ClampedArray,
  a: number,
  b: readonly [number, number, number]
): number {
  const dr = (data[a] ?? 0) - b[0];
  const dg = (data[a + 1] ?? 0) - b[1];
  const db = (data[a + 2] ?? 0) - b[2];
  return dr * dr + dg * dg + db * db;
}

/**
 * The background colour, taken as the median of the border ring.
 *
 * The median rather than one corner: a model sometimes vignettes, and a single
 * corner pixel is one sample of a noisy image. The border ring is the one
 * region a centred subject is guaranteed not to occupy.
 */
function borderColor(image: RasterImage): [number, number, number] {
  const { width, height, data } = image;
  const reds: number[] = [];
  const greens: number[] = [];
  const blues: number[] = [];

  const sample = (x: number, y: number): void => {
    const offset = (y * width + x) * 4;
    reds.push(data[offset] ?? 0);
    greens.push(data[offset + 1] ?? 0);
    blues.push(data[offset + 2] ?? 0);
  };

  for (let x = 0; x < width; x += 1) {
    sample(x, 0);
    sample(x, height - 1);
  }
  for (let y = 1; y < height - 1; y += 1) {
    sample(0, y);
    sample(width - 1, y);
  }

  const median = (values: number[]): number => {
    values.sort((a, b) => a - b);
    return values[Math.floor(values.length / 2)] ?? 0;
  };
  return [median(reds), median(greens), median(blues)];
}

/**
 * Clears the background by flood fill from the edges.
 *
 * A flood fill rather than "every pixel near the background colour": the
 * knight's armour was within 40 RGB of its blue background, and a global colour
 * test punched holes straight through the subject. Connectivity from the border
 * is what separates *the background* from *pixels that happen to look like it*.
 */
export function clearBackground(image: RasterImage, tolerance = 32): RasterImage {
  const { width, height } = image;
  const data = new Uint8ClampedArray(image.data);

  // Already has real transparency — the model honoured the request, and
  // second-guessing it would eat legitimately background-coloured pixels.
  for (let index = 3; index < data.length; index += 4) {
    if ((data[index] ?? 255) < 16) {
      return { width, height, data };
    }
  }

  const background = borderColor(image);
  const limit = tolerance * tolerance * 3;
  const seen = new Uint8Array(width * height);
  const stack: number[] = [];

  for (let x = 0; x < width; x += 1) {
    stack.push(x, 0, x, height - 1);
  }
  for (let y = 0; y < height; y += 1) {
    stack.push(0, y, width - 1, y);
  }

  while (stack.length > 0) {
    const y = stack.pop() as number;
    const x = stack.pop() as number;
    if (x < 0 || y < 0 || x >= width || y >= height) continue;

    const cell = y * width + x;
    if (seen[cell] === 1) continue;
    if (distance(data, cell * 4, background) > limit) continue;

    seen[cell] = 1;
    data[cell * 4 + 3] = 0;
    stack.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
  }

  return { width, height, data };
}

export interface SubjectBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The bounding box of everything still opaque, or null if nothing is. */
export function subjectBounds(image: RasterImage, threshold = 8): SubjectBounds | null {
  const { width, height, data } = image;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if ((data[(y * width + x) * 4 + 3] ?? 0) > threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < 0) return null;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/**
 * Crops to the subject and scales it to fill a `width` x `height` frame.
 *
 * Aspect ratio is preserved and the subject is centred horizontally and sat on
 * the bottom edge. Bottom-anchored because these are sprites: characters share
 * a ground line, and a walk cycle whose frames are each vertically centred
 * bobs for no reason. Stretching to fill instead would distort a tall subject
 * into a square canvas, which is worse than the margin it saves.
 *
 * Sampling is nearest-neighbour. Pixelisation resolves each output cell from
 * many input pixels anyway, so smoothing here would only blur the edges the
 * next stage is trying to find.
 */
export function fitSubject(
  image: RasterImage,
  width: number,
  height: number,
  bounds: SubjectBounds,
  padding = 0,
): RasterImage {
  const data = new Uint8ClampedArray(width * height * 4);
  const scale = Math.min((width - 2 * padding) / bounds.width, (height - 2 * padding) / bounds.height);
  const drawWidth = Math.max(1, Math.round(bounds.width * scale));
  const drawHeight = Math.max(1, Math.round(bounds.height * scale));
  const originX = Math.floor((width - drawWidth) / 2);
  const originY = height - padding - drawHeight;

  for (let y = 0; y < drawHeight; y += 1) {
    const sourceY = bounds.y + Math.min(bounds.height - 1, Math.floor((y * bounds.height) / drawHeight));
    for (let x = 0; x < drawWidth; x += 1) {
      const sourceX = bounds.x + Math.min(bounds.width - 1, Math.floor((x * bounds.width) / drawWidth));
      const from = (sourceY * image.width + sourceX) * 4;
      const to = ((originY + y) * width + originX + x) * 4;
      data[to] = image.data[from] ?? 0;
      data[to + 1] = image.data[from + 1] ?? 0;
      data[to + 2] = image.data[from + 2] ?? 0;
      data[to + 3] = image.data[from + 3] ?? 0;
    }
  }

  return { width, height, data };
}

export interface FramedSubject {
  readonly image: RasterImage;
  /** How much of the source frame the subject occupied, 0-1 by area. */
  readonly coverage: number;
  readonly notes: readonly string[];
}

/**
 * The whole preparation: clear the background, crop, and fill the frame.
 *
 * Returns the image unchanged when there is no subject to find, rather than
 * cropping to nothing — an empty result is never more useful than the input.
 */
export function frameSubject(
  image: RasterImage,
  options: { size?: number; tolerance?: number } = {}
): FramedSubject {
  const notes: string[] = [];
  const cleared = clearBackground(image, options.tolerance);
  const bounds = subjectBounds(cleared);

  if (bounds === null) {
    return {
      image,
      coverage: 1,
      notes: ["No subject was found against the background, so the full frame was kept."],
    };
  }

  const coverage = (bounds.width * bounds.height) / (image.width * image.height);
  if (coverage > 0.92) {
    // Already tight. Cropping a few pixels would gain nothing and risks
    // shaving a subject that genuinely runs to the edge, like a tile.
    return { image: cleared, coverage, notes };
  }

  const size = options.size ?? Math.max(bounds.width, bounds.height);
  const aspect = bounds.width / bounds.height;
  const width = aspect >= 1 ? size : Math.max(1, Math.round(size * aspect));
  const height = aspect >= 1 ? Math.max(1, Math.round(size / aspect)) : size;

  notes.push(
    `Subject occupied ${(coverage * 100).toFixed(0)}% of the frame; cropped to ${String(bounds.width)}x${String(bounds.height)} and scaled to fill.`
  );

  return { image: fitSubject(cleared, width, height, bounds), coverage, notes };
}

/**
 * Frames a subject into a canvas of a given aspect, ready for pixelisation.
 *
 * `frameSubject` picks its own output size, which is right for a reference
 * image and wrong for generation: the pipeline there must land on exactly the
 * preset's dimensions, and a 22x32 intermediate pixelises to 32x46 and is
 * rejected. So the subject is fitted *into* a frame of the canvas's aspect,
 * keeping its own proportions. Generated sprites reserve padding for local
 * motion; reference/animation callers keep their existing ground line by default.
 *
 * The working frame is sized to about one output cell per `cellSize` input
 * pixels, chosen so the subject is neither up- nor downsampled much before the
 * real resampling happens — resampling twice loses more than doing it once.
 *
 * Returns null when there is no subject, so the caller keeps the original
 * rather than pixelising an empty frame.
 */
export function frameToCanvas(
  image: RasterImage,
  canvasWidth: number,
  canvasHeight: number,
  options: { tolerance?: number; maxCell?: number; padding?: number } = {}
): { image: RasterImage; coverage: number; note: string } | null {
  const padding = options.padding ?? 0;
  if (!Number.isInteger(padding) || padding < 0 || 2 * padding >= Math.min(canvasWidth, canvasHeight)) {
    throw new Error("Sprite padding must be a non-negative integer smaller than half the canvas size.");
  }
  const cleared = clearBackground(image, options.tolerance);
  const bounds = subjectBounds(cleared);
  if (bounds === null) return null;

  const coverage = (bounds.width * bounds.height) / (image.width * image.height);
  if (coverage > 0.92 && padding === 0) return null;

  const maxCell = options.maxCell ?? 32;
  const cell = Math.max(
    1,
    Math.min(maxCell, Math.round(Math.max(bounds.width / canvasWidth, bounds.height / canvasHeight)))
  );

  return {
    image: fitSubject(cleared, canvasWidth * cell, canvasHeight * cell, bounds, padding * cell),
    coverage,
    note:
      `Subject filled ${(coverage * 100).toFixed(0)}% of the generated frame; ` +
      `cropped to ${String(bounds.width)}x${String(bounds.height)} and ` +
      (padding === 0 ? "scaled to fill the canvas." : `fitted with ${String(padding)}px canvas padding.`),
  };
}
