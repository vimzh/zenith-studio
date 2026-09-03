import { MAX_PALETTE_SIZE } from "@zenith/core";

/**
 * Canvas presets bind a size to a palette.
 *
 * "8-bit" and "64-bit" are not sizes. Two independent axes govern pixel art:
 * canvas dimensions (spatial) and colour depth (chromatic, where 1-bit = 2
 * colours, 2-bit = 4, 4-bit = 16). These presets fix both together.
 *
 * Hardware palettes are factual data about the machines and ship built in.
 * Named artist palettes are not — those are fetched from Lospec on request with
 * attribution, never bundled.
 */
export interface CanvasPreset {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly width: number;
  readonly height: number;
  /** Lowercase `#rrggbb`, index-ordered. Never longer than MAX_PALETTE_SIZE. */
  readonly colors: readonly string[];
}

/** Game Boy DMG's four shades. Hardware fact. */
const GAME_BOY_DMG = ["#0f380f", "#306230", "#8bac0f", "#9bbc0f"] as const;

/**
 * Three colours drawn from the NES master palette, plus transparency — the
 * hardware sprite limit was 3 + transparent.
 */
const NES_SPRITE = ["#7c0800", "#f83800", "#fcd8a8"] as const;

/**
 * A general-purpose 16 built for this tool: a five-step neutral ramp, warm and
 * cool three-step ramps, plus foliage and accent. Even lightness spacing so
 * shading ramps read predictably. Authored here, not sourced.
 */
const GENERAL_16 = [
  "#14121c", // 0  near-black
  "#2e2b3f", // 1  shadow
  "#4d4a63", // 2  mid-dark
  "#7b7893", // 3  mid
  "#b8b5c9", // 4  light
  "#f2f0f5", // 5  near-white
  "#5a2f2a", // 6  warm dark
  "#96513c", // 7  warm mid
  "#d98f5c", // 8  warm light
  "#243f5c", // 9  cool dark
  "#3c6e99", // 10 cool mid
  "#74b4d4", // 11 cool light
  "#254a2c", // 12 foliage dark
  "#43854a", // 13 foliage mid
  "#8cc464", // 14 foliage light
  "#d4b44a", // 15 accent
] as const;

export const CANVAS_PRESETS: readonly CanvasPreset[] = [
  {
    id: "gb-4",
    name: "Game Boy",
    description: "16×16, 4 shades. The DMG palette.",
    width: 16,
    height: 16,
    colors: GAME_BOY_DMG,
  },
  {
    id: "nes-sprite",
    name: "NES sprite",
    description: "16×16, 3 colours + transparent. The PPU sprite limit.",
    width: 16,
    height: 16,
    colors: NES_SPRITE,
  },
  {
    id: "snes-sprite",
    name: "SNES sprite",
    description: "32×32, 16 colours.",
    width: 32,
    height: 32,
    colors: GENERAL_16,
  },
  {
    id: "tile-32",
    name: "Tile",
    description: "32×32, 16 colours, seam-checked.",
    width: 32,
    height: 32,
    colors: GENERAL_16,
  },
  {
    id: "item-16",
    name: "Item",
    description: "16×16, 16 colours. Icons, pickups, UI pieces.",
    width: 16,
    height: 16,
    colors: GENERAL_16,
  },
  {
    id: "modern-64",
    name: "Modern",
    description: "64×64, 16 colours. Detailed sprite work.",
    width: 64,
    height: 64,
    colors: GENERAL_16,
  },
];

export const DEFAULT_PRESET_ID = "tile-32";

export function findPreset(id: string): CanvasPreset | undefined {
  return CANVAS_PRESETS.find((preset) => preset.id === id);
}

/** Every preset must respect the document's palette capacity. */
export function presetsAreValid(): boolean {
  return CANVAS_PRESETS.every(
    (preset) => preset.colors.length > 0 && preset.colors.length <= MAX_PALETTE_SIZE
  );
}
