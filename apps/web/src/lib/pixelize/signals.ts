import { pixelAt, type Axis, type RasterImage } from "./types";

/**
 * Per-axis edge profiles.
 *
 * For each axis we build a 1-D signal of "how much changes here", averaged over
 * lines running the other way. A grid boundary shows up as a peak in that
 * signal; a flat cell interior does not.
 */

/** Cap the work regardless of input size — a 4000px image is sampled, not walked. */
const MAX_ANALYSIS_LINES = 96;

function luminance(r: number, g: number, b: number): number {
  // sRGB → linear before weighting, or dark edges are systematically underrated.
  const toLinear = (channel: number) => {
    const v = channel / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/**
 * Builds the edge profile along one axis.
 *
 * `profile[i]` is the average difference between position `i-1` and `i`, so
 * index 0 and index `length` are the image borders and always zero — a boundary
 * cannot be observed outside the image.
 */
function buildAxis(
  image: RasterImage,
  length: number,
  crossLength: number,
  read: (along: number, across: number) => [number, number, number, number]
): Axis {
  const profile = new Float64Array(length + 1);
  const lines = Math.min(crossLength, MAX_ANALYSIS_LINES);
  if (lines === 0 || length < 2) {
    return { profile, length };
  }

  for (let n = 0; n < lines; n += 1) {
    const across = Math.floor(((n + 0.5) * crossLength) / lines);
    let previous = read(0, across);

    for (let along = 1; along < length; along += 1) {
      const current = read(along, across);

      const colour =
        (Math.abs(current[0] - previous[0]) +
          Math.abs(current[1] - previous[1]) +
          Math.abs(current[2] - previous[2])) /
        (3 * 255);
      const luma = Math.abs(
        luminance(current[0], current[1], current[2]) - luminance(previous[0], previous[1], previous[2])
      );
      const alpha = Math.abs(current[3] - previous[3]) / 255;

      profile[along] += colour + 0.7 * luma + 0.3 * alpha;
      previous = current;
    }
  }

  for (let i = 0; i <= length; i += 1) {
    profile[i] = (profile[i] ?? 0) / lines;
  }

  return { profile, length };
}

export function axisProfiles(image: RasterImage): { x: Axis; y: Axis } {
  return {
    x: buildAxis(image, image.width, image.height, (along, across) =>
      pixelAt(image, along, across)
    ),
    y: buildAxis(image, image.height, image.width, (along, across) =>
      pixelAt(image, across, along)
    ),
  };
}

/** Positions of the strongest edges, used to propose candidate cell sizes. */
export function peaks(axis: Axis, limit: number): number[] {
  const scored: { at: number; value: number }[] = [];
  for (let i = 1; i < axis.length; i += 1) {
    const value = axis.profile[i] ?? 0;
    if (value > 0) {
      scored.push({ at: i, value });
    }
  }
  scored.sort((a, b) => b.value - a.value);
  return scored.slice(0, limit).map((entry) => entry.at);
}

export function meanEdge(axis: Axis): number {
  let total = 0;
  for (let i = 1; i < axis.length; i += 1) {
    total += axis.profile[i] ?? 0;
  }
  return axis.length <= 1 ? 0 : total / (axis.length - 1);
}

/**
 * Edge energy at the boundaries a given grid predicts, sampled with a ±1px
 * triangular window so non-integer cell sizes are measured fairly.
 */
export function energyAtBoundaries(axis: Axis, cell: number, phase: number): number {
  if (cell <= 0) {
    return 0;
  }

  let total = 0;
  let counted = 0;

  for (let boundary = phase; boundary <= axis.length; boundary += cell) {
    // Interior boundaries only: the image edges carry no evidence either way.
    if (boundary < 1 || boundary > axis.length - 1) {
      continue;
    }
    const centre = Math.round(boundary);
    let best = 0;
    for (let offset = -1; offset <= 1; offset += 1) {
      const at = centre + offset;
      if (at < 1 || at >= axis.length) {
        continue;
      }
      const weight = offset === 0 ? 1 : 0.5;
      best = Math.max(best, (axis.profile[at] ?? 0) * weight);
    }
    total += best;
    counted += 1;
  }

  return counted === 0 ? 0 : total / counted;
}
