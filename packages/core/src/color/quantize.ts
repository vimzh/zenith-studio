/**
 * Oklab k-means colour quantiser.
 *
 * Needed here for palette matching; the pixelisation pipeline in phase 08 is
 * its real consumer, where reducing a model's 4,000-colour "pixel art" to a
 * 16-entry indexed palette is the step that makes the output actually pixel art.
 *
 * Deterministic: k-means++ seeding runs off a seeded PRNG, so the same image and
 * seed always produce the same palette.
 */

import { fail, requirePositiveInteger } from "../errors";
import { MAX_PALETTE_SIZE, TRANSPARENT, type Oklab } from "../types";
import { formatHex, oklabDistanceSquared, oklabToRgb, rgbToOklab } from "./oklab";

export interface QuantizeOptions {
  /** Target palette size. Capped at 16 so cells stay one character. */
  readonly maxColors?: number;
  /** Alpha below this becomes {@link TRANSPARENT}; at or above becomes opaque — invariant 2. */
  readonly alphaThreshold?: number;
  readonly seed?: number;
  readonly maxIterations?: number;
  /** Stop once the largest centroid move falls below this Oklab distance. */
  readonly tolerance?: number;
}

export interface QuantizeResult {
  /** Palette colours as `#rrggbb`, ordered dark to light. */
  readonly colors: readonly string[];
  /** One cell per input pixel: a palette index, or {@link TRANSPARENT}. */
  readonly indices: Int8Array;
  /** Mean Oklab distance from each opaque pixel to its assigned palette colour. */
  readonly meanError: number;
  /** Distinct opaque colours in the input, before reduction. */
  readonly sourceColorCount: number;
}

/** mulberry32 — small, fast, and deterministic across runtimes. */
function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface ColorBucket {
  readonly packed: number;
  readonly lab: Oklab;
  readonly weight: number;
}

function collectBuckets(
  pixels: Uint8ClampedArray,
  alphaThreshold: number,
): { buckets: ColorBucket[]; opaque: Int32Array } {
  const pixelCount = pixels.length / 4;
  const opaque = new Int32Array(pixelCount).fill(-1);
  const weights = new Map<number, number>();

  for (let i = 0; i < pixelCount; i += 1) {
    if ((pixels[i * 4 + 3] as number) < alphaThreshold) continue;
    const packed =
      ((pixels[i * 4] as number) << 16) | ((pixels[i * 4 + 1] as number) << 8) | (pixels[i * 4 + 2] as number);
    opaque[i] = packed;
    weights.set(packed, (weights.get(packed) ?? 0) + 1);
  }

  const buckets: ColorBucket[] = [];
  for (const [packed, weight] of weights) {
    buckets.push({
      packed,
      weight,
      lab: rgbToOklab({ r: (packed >> 16) & 0xff, g: (packed >> 8) & 0xff, b: packed & 0xff }),
    });
  }
  // Sort for determinism: Map iteration order depends on insertion, which depends on the image.
  buckets.sort((a, b) => a.packed - b.packed);
  return { buckets, opaque };
}

function seedCentroids(buckets: readonly ColorBucket[], k: number, random: () => number): Oklab[] {
  const centroids: Oklab[] = [];
  const distances = new Float64Array(buckets.length).fill(Number.POSITIVE_INFINITY);

  // k-means++: first centroid weighted by pixel count, the rest by distance from
  // what is already chosen, so ramps and accents both survive the reduction.
  let firstIndex = 0;
  let bestWeight = -1;
  for (let i = 0; i < buckets.length; i += 1) {
    const weight = (buckets[i] as ColorBucket).weight;
    if (weight > bestWeight) {
      bestWeight = weight;
      firstIndex = i;
    }
  }
  centroids.push((buckets[firstIndex] as ColorBucket).lab);

  while (centroids.length < k) {
    const latest = centroids[centroids.length - 1] as Oklab;
    let total = 0;
    for (let i = 0; i < buckets.length; i += 1) {
      const bucket = buckets[i] as ColorBucket;
      const distance = oklabDistanceSquared(bucket.lab, latest);
      if (distance < (distances[i] as number)) distances[i] = distance;
      total += (distances[i] as number) * bucket.weight;
    }
    if (total <= 0) break;

    let cut = random() * total;
    let chosen = buckets.length - 1;
    for (let i = 0; i < buckets.length; i += 1) {
      cut -= (distances[i] as number) * (buckets[i] as ColorBucket).weight;
      if (cut <= 0) {
        chosen = i;
        break;
      }
    }
    centroids.push((buckets[chosen] as ColorBucket).lab);
  }
  return centroids;
}

export function quantize(pixels: Uint8ClampedArray, options: QuantizeOptions = {}): QuantizeResult {
  if (pixels.length === 0 || pixels.length % 4 !== 0) {
    fail(
      "invalid_argument",
      `Expected a non-empty RGBA buffer whose length is a multiple of 4, received ${String(pixels.length)} bytes.`,
    );
  }
  const maxColors = options.maxColors ?? MAX_PALETTE_SIZE;
  requirePositiveInteger(maxColors, "maxColors");
  if (maxColors > MAX_PALETTE_SIZE) {
    fail(
      "palette_overflow",
      `maxColors is ${String(maxColors)} but the cap is ${String(MAX_PALETTE_SIZE)}. One character per pixel is only possible at 16 colours or fewer.`,
    );
  }
  const alphaThreshold = options.alphaThreshold ?? 128;
  const maxIterations = options.maxIterations ?? 32;
  const tolerance = options.tolerance ?? 1e-4;

  const { buckets, opaque } = collectBuckets(pixels, alphaThreshold);
  const indices = new Int8Array(opaque.length).fill(TRANSPARENT);
  if (buckets.length === 0) {
    return { colors: [], indices, meanError: 0, sourceColorCount: 0 };
  }

  const k = Math.min(maxColors, buckets.length);
  let centroids = seedCentroids(buckets, k, createRandom(options.seed ?? 0x5eed));
  const assignment = new Int32Array(buckets.length);

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    for (let i = 0; i < buckets.length; i += 1) {
      const lab = (buckets[i] as ColorBucket).lab;
      let best = 0;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (let c = 0; c < centroids.length; c += 1) {
        const distance = oklabDistanceSquared(lab, centroids[c] as Oklab);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = c;
        }
      }
      assignment[i] = best;
    }

    const sums = new Float64Array(centroids.length * 3);
    const totals = new Float64Array(centroids.length);
    for (let i = 0; i < buckets.length; i += 1) {
      const bucket = buckets[i] as ColorBucket;
      const c = assignment[i] as number;
      sums[c * 3] = (sums[c * 3] as number) + bucket.lab.L * bucket.weight;
      sums[c * 3 + 1] = (sums[c * 3 + 1] as number) + bucket.lab.a * bucket.weight;
      sums[c * 3 + 2] = (sums[c * 3 + 2] as number) + bucket.lab.b * bucket.weight;
      totals[c] = (totals[c] as number) + bucket.weight;
    }

    let movement = 0;
    const next: Oklab[] = [];
    for (let c = 0; c < centroids.length; c += 1) {
      const weight = totals[c] as number;
      if (weight === 0) {
        // Re-seed an empty cluster onto the worst-served colour rather than
        // dropping it, so the palette keeps its full budget.
        next.push(farthestBucket(buckets, assignment, centroids).lab);
        movement = Number.POSITIVE_INFINITY;
        continue;
      }
      const centroid: Oklab = {
        L: (sums[c * 3] as number) / weight,
        a: (sums[c * 3 + 1] as number) / weight,
        b: (sums[c * 3 + 2] as number) / weight,
      };
      movement = Math.max(movement, oklabDistanceSquared(centroid, centroids[c] as Oklab));
      next.push(centroid);
    }
    centroids = next;
    if (movement < tolerance * tolerance) break;
  }

  // Snap each centroid to the nearest colour actually present. A palette of real
  // image colours reads better than one of averages, which tend toward grey.
  const snapped = centroids.map((centroid) => {
    let best = buckets[0] as ColorBucket;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const bucket of buckets) {
      const distance = oklabDistanceSquared(bucket.lab, centroid);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = bucket;
      }
    }
    return best;
  });

  const order = snapped
    .map((bucket, index) => ({ bucket, index }))
    .sort((a, b) => a.bucket.lab.L - b.bucket.lab.L || a.bucket.packed - b.bucket.packed);
  const remap = new Int32Array(snapped.length);
  order.forEach((entry, position) => {
    remap[entry.index] = position;
  });

  const colors = order.map((entry) =>
    formatHex({
      r: (entry.bucket.packed >> 16) & 0xff,
      g: (entry.bucket.packed >> 8) & 0xff,
      b: entry.bucket.packed & 0xff,
    }),
  );
  const finalLabs = order.map((entry) => entry.bucket.lab);

  const bucketIndex = new Map<number, number>();
  for (let i = 0; i < buckets.length; i += 1) {
    bucketIndex.set((buckets[i] as ColorBucket).packed, remap[assignment[i] as number] as number);
  }

  let errorSum = 0;
  let opaqueCount = 0;
  for (let i = 0; i < opaque.length; i += 1) {
    const packed = opaque[i] as number;
    if (packed < 0) continue;
    const index = bucketIndex.get(packed) as number;
    indices[i] = index;
    errorSum += Math.sqrt(
      oklabDistanceSquared(
        rgbToOklab({ r: (packed >> 16) & 0xff, g: (packed >> 8) & 0xff, b: packed & 0xff }),
        finalLabs[index] as Oklab,
      ),
    );
    opaqueCount += 1;
  }

  return {
    colors,
    indices,
    meanError: opaqueCount === 0 ? 0 : errorSum / opaqueCount,
    sourceColorCount: buckets.length,
  };
}

function farthestBucket(
  buckets: readonly ColorBucket[],
  assignment: Int32Array,
  centroids: readonly Oklab[],
): ColorBucket {
  let worst = buckets[0] as ColorBucket;
  let worstDistance = -1;
  for (let i = 0; i < buckets.length; i += 1) {
    const bucket = buckets[i] as ColorBucket;
    const distance = oklabDistanceSquared(bucket.lab, centroids[assignment[i] as number] as Oklab);
    if (distance > worstDistance) {
      worstDistance = distance;
      worst = bucket;
    }
  }
  return worst;
}

/** Round-trips an Oklab centroid to a hex string. Exposed for palette tooling. */
export function oklabToHex(lab: Oklab): string {
  return formatHex(oklabToRgb(lab));
}
