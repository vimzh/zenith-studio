/**
 * Palettes — up to 16 entries, each caching its Oklab coordinates so nearest-colour
 * matching never re-converts.
 *
 * The cap is not a style choice. It is what keeps one cell to one character, and
 * therefore what makes the grid round-trippable through a language model.
 */

import { fail } from "./errors";
import { hexToOklab, normalizeHex, oklabDistanceSquared, parseHex, rgbToOklab } from "./color/oklab";
import type { QuantizeResult } from "./color/quantize";
import {
  MAX_PALETTE_SIZE,
  TRANSPARENT,
  type Cell,
  type Palette,
  type PaletteColor,
  type PaletteIndex,
  type Rgb,
} from "./types";

export interface PaletteInput {
  readonly id?: string;
  readonly name?: string;
  readonly colors: readonly string[];
}

export function createPalette(input: PaletteInput): Palette {
  if (input.colors.length === 0) {
    fail("invalid_color", "A palette needs at least one colour.");
  }
  if (input.colors.length > MAX_PALETTE_SIZE) {
    fail(
      "palette_overflow",
      `Palette has ${String(input.colors.length)} colours but the cap is ${String(MAX_PALETTE_SIZE)}. Quantise the source down to 16 or fewer first.`,
    );
  }
  const colors: PaletteColor[] = input.colors.map((hex) => {
    const normalized = normalizeHex(hex);
    return { hex: normalized, oklab: hexToOklab(normalized) };
  });
  return {
    id: input.id ?? "palette",
    name: input.name ?? input.id ?? "palette",
    colors,
  };
}

export function paletteFromQuantize(result: QuantizeResult, input: Omit<PaletteInput, "colors"> = {}): Palette {
  return createPalette({ ...input, colors: result.colors });
}

export function paletteHexes(palette: Palette): readonly string[] {
  return palette.colors.map((color) => color.hex);
}

/** True when `value` addresses a colour in this palette, or is transparent. */
export function isCellInPalette(palette: Palette, value: Cell): boolean {
  return (
    Number.isInteger(value) && (value === TRANSPARENT || (value >= 0 && value < palette.colors.length))
  );
}

export function paletteColor(palette: Palette, index: PaletteIndex): PaletteColor {
  const color = palette.colors[index];
  if (color === undefined) {
    fail(
      "invalid_index",
      `Palette index ${String(index)} does not exist. '${palette.name}' has ${String(palette.colors.length)} colours, so valid indices are 0-${String(palette.colors.length - 1)}, or -1 for transparent.`,
    );
  }
  return color;
}

/** Nearest palette entry to an RGB or hex colour, measured in Oklab. */
export function nearestIndex(palette: Palette, color: Rgb | string): PaletteIndex {
  const rgb = typeof color === "string" ? parseHex(color) : color;
  const lab = rgbToOklab(rgb);
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < palette.colors.length; i += 1) {
    const distance = oklabDistanceSquared(lab, (palette.colors[i] as PaletteColor).oklab);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  }
  return best;
}

/** Palette indices ordered dark to light — the ramp `shade_region` walks in phase 07. */
export function lightnessRamp(palette: Palette): readonly PaletteIndex[] {
  return palette.colors
    .map((color, index) => ({ color, index }))
    .sort((a, b) => a.color.oklab.L - b.color.oklab.L)
    .map((entry) => entry.index);
}

/**
 * Built-in palettes.
 *
 * Hardware and fantasy-console palettes are factual data and ship with the app.
 * Community palettes are not bundled — Lospec palettes are fetched on request
 * with `name` and `author` attribution shown (see `docs/requirements.md` §2).
 */
export const BUILTIN_PALETTES: Readonly<Record<string, Palette>> = Object.freeze({
  "gb-dmg": createPalette({
    id: "gb-dmg",
    name: "Game Boy DMG",
    colors: ["#0f380f", "#306230", "#8bac0f", "#9bbc0f"],
  }),
  "pico-8": createPalette({
    id: "pico-8",
    name: "PICO-8",
    colors: [
      "#000000",
      "#1d2b53",
      "#7e2553",
      "#008751",
      "#ab5236",
      "#5f574f",
      "#c2c3c7",
      "#fff1e8",
      "#ff004d",
      "#ffa300",
      "#ffec27",
      "#00e436",
      "#29adff",
      "#83769c",
      "#ff77a8",
      "#ffccaa",
    ],
  }),
});

export function builtinPalette(id: string): Palette {
  const palette = BUILTIN_PALETTES[id];
  if (palette === undefined) {
    fail(
      "invalid_argument",
      `No built-in palette '${id}'. Available: ${Object.keys(BUILTIN_PALETTES).join(", ")}.`,
    );
  }
  return palette;
}
