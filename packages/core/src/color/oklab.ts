/**
 * sRGB <-> Oklab conversion.
 *
 * Oklab is perceptually uniform, so "nearest colour" in Oklab means nearest to
 * the eye. Palette matching (here) and the k-means quantiser (phase 08) both
 * measure distance in this space; doing it in RGB is what produces the muddy
 * colour reduction this project exists to avoid.
 *
 * Transform from Björn Ottosson's public description of Oklab.
 */

import { fail } from "../errors";
import type { Oklab, Rgb } from "../types";

const HEX_PATTERN = /^#?([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

function srgbToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(channel: number): number {
  const c = channel <= 0.0031308 ? 12.92 * channel : 1.055 * channel ** (1 / 2.4) - 0.055;
  return Math.min(255, Math.max(0, Math.round(c * 255)));
}

export function rgbToOklab(rgb: Rgb): Oklab {
  const r = srgbToLinear(rgb.r);
  const g = srgbToLinear(rgb.g);
  const b = srgbToLinear(rgb.b);

  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.629978701 * b);

  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

export function oklabToRgb(lab: Oklab): Rgb {
  const l = (lab.L + 0.3963377774 * lab.a + 0.2158037573 * lab.b) ** 3;
  const m = (lab.L - 0.1055613458 * lab.a - 0.0638541728 * lab.b) ** 3;
  const s = (lab.L - 0.0894841775 * lab.a - 1.291485548 * lab.b) ** 3;

  return {
    r: linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  };
}

/**
 * Parses `#rgb`, `#rrggbb` or `#rrggbbff`.
 *
 * Partial alpha is rejected rather than composited — invariant 2. A pixel is
 * fully opaque or fully transparent, and transparency is the `.` cell, never a
 * colour channel.
 */
export function parseHex(hex: string): Rgb {
  const match = HEX_PATTERN.exec(hex.trim());
  if (match === null) {
    fail(
      "invalid_color",
      `'${hex}' is not a hex colour. Use #rgb or #rrggbb (or #rrggbbff for explicit full opacity).`,
    );
  }
  let body = match[1] as string;
  if (body.length === 3) {
    body = `${body[0] as string}${body[0] as string}${body[1] as string}${body[1] as string}${body[2] as string}${body[2] as string}`;
  }
  if (body.length === 8) {
    const alpha = Number.parseInt(body.slice(6, 8), 16);
    if (alpha !== 255) {
      fail(
        "alpha_not_binary",
        `'${hex}' has alpha ${String(alpha)}. Every pixel is fully opaque or fully transparent; drop the alpha channel and use the '.' cell for transparency.`,
      );
    }
    body = body.slice(0, 6);
  }
  return {
    r: Number.parseInt(body.slice(0, 2), 16),
    g: Number.parseInt(body.slice(2, 4), 16),
    b: Number.parseInt(body.slice(4, 6), 16),
  };
}

export function formatHex(rgb: Rgb): string {
  const channel = (value: number): string =>
    Math.min(255, Math.max(0, Math.round(value))).toString(16).padStart(2, "0");
  return `#${channel(rgb.r)}${channel(rgb.g)}${channel(rgb.b)}`;
}

/** Normalises any accepted hex form to lowercase `#rrggbb`. */
export function normalizeHex(hex: string): string {
  return formatHex(parseHex(hex));
}

export function hexToOklab(hex: string): Oklab {
  return rgbToOklab(parseHex(hex));
}

/** Squared Oklab distance. Squared is enough for comparisons and avoids a sqrt per pixel. */
export function oklabDistanceSquared(a: Oklab, b: Oklab): number {
  const dL = a.L - b.L;
  const da = a.a - b.a;
  const db = a.b - b.b;
  return dL * dL + da * da + db * db;
}

export function oklabDistance(a: Oklab, b: Oklab): number {
  return Math.sqrt(oklabDistanceSquared(a, b));
}
