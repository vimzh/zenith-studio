import { TRANSPARENT, hexToOklab, oklabDistance, type Grid } from "@zenith/core";

/**
 * Making room in a full palette for an effect colour.
 *
 * A generated character almost always uses all sixteen slots, so a purple
 * trail asked for on top of it has nowhere to go and would be matched to the
 * nearest grey — an effect that was asked for and silently not delivered.
 * Real palettes carry near-duplicates: two greys a few Oklab hundredths
 * apart, a skin tone and its shadow's neighbour. Folding the less-used of such
 * a pair into the other is invisible at pixel-art scale and frees a slot.
 *
 * Deliberately conservative: only pairs closer than {@link MERGE_DISTANCE}
 * qualify, at most a couple of slots are freed, and the caller applies the
 * fold as an ordinary undoable colour replacement, so nothing is lost that a
 * single undo does not restore.
 */

export interface PaletteFold {
  /** The index that is emptied; its pixels move to `to`. */
  readonly from: number;
  readonly to: number;
  readonly distance: number;
}

/** Oklab distance under which two colours read as one in pixel art. */
export const MERGE_DISTANCE = 0.08;

/** Opaque pixel count per palette index across the given grids. */
export function paletteUsage(grids: readonly Grid[], size: number): number[] {
  const usage = new Array<number>(size).fill(0);
  for (const grid of grids) {
    for (const cell of grid.cells) {
      if (cell !== TRANSPARENT && cell < size) usage[cell] = (usage[cell] ?? 0) + 1;
    }
  }
  return usage;
}

/**
 * The folds that free up to `wanted` slots, closest pair first.
 *
 * Each pair is used once, so two folds never chain through the same colour,
 * and the less-used colour of a pair is always the one emptied.
 */
export function planPaletteRoom(
  colors: readonly string[],
  usage: readonly number[],
  wanted: number,
  maxDistance = MERGE_DISTANCE,
): PaletteFold[] {
  if (wanted <= 0 || colors.length < 2) return [];
  const labs = colors.map(hexToOklab);
  const pairs: PaletteFold[] = [];
  for (let i = 0; i < colors.length; i += 1) {
    for (let j = i + 1; j < colors.length; j += 1) {
      const distance = oklabDistance(labs[i]!, labs[j]!);
      if (distance > maxDistance) continue;
      const [from, to] = (usage[i] ?? 0) <= (usage[j] ?? 0) ? [i, j] : [j, i];
      pairs.push({ from, to, distance });
    }
  }
  pairs.sort((a, b) => a.distance - b.distance);
  const taken = new Set<number>();
  const folds: PaletteFold[] = [];
  for (const pair of pairs) {
    if (folds.length >= wanted) break;
    if (taken.has(pair.from) || taken.has(pair.to)) continue;
    taken.add(pair.from);
    taken.add(pair.to);
    folds.push(pair);
  }
  return folds;
}

/**
 * Oklab distance beyond which a colour is *foreign* to the palette — a hue the
 * asset does not have, rather than a drifted shade of one it does. A model
 * redrawing red gloves returns a red a few hundredths off the palette's; that
 * must conform to the palette, not take a slot from it. A purple trail on a
 * character with no purple sits ten times further away.
 */
export const EFFECT_DISTANCE = 0.12;
/** Two effect colours closer than this share one slot. */
const SAME_EFFECT_DISTANCE = 0.05;

export interface PaletteSeating {
  /** The palette to write: folds applied, effect colours seated, growth appended. */
  readonly colors: string[];
  readonly added: string[];
  /** Foreign colours there was no room for; they conform to the nearest colour. */
  readonly unmatched: string[];
  readonly folds: PaletteFold[];
}

/**
 * Seats the effect colours a batch of frames introduced.
 *
 * Only foreign colours are seated (see {@link EFFECT_DISTANCE}), most-used
 * first, one per colour family. Growth slots go first; when the palette is
 * full, up to `maxFolds` near-duplicate pairs are folded to make room, and
 * only as many as the foreign colours need.
 */
export function seatEffectColours(
  palette: readonly string[],
  incoming: readonly string[],
  usage: readonly number[],
  maxFolds = 2,
  limit = 16,
): PaletteSeating {
  const labs = palette.map(hexToOklab);
  const candidates: { hex: string; lab: ReturnType<typeof hexToOklab> }[] = [];
  for (const hex of incoming) {
    const lab = hexToOklab(hex);
    if (labs.some((entry) => oklabDistance(entry, lab) <= EFFECT_DISTANCE)) continue;
    if (candidates.some((entry) => oklabDistance(entry.lab, lab) <= SAME_EFFECT_DISTANCE)) continue;
    candidates.push({ hex, lab });
  }
  const colors = [...palette];
  if (candidates.length === 0) return { colors, added: [], unmatched: [], folds: [] };

  const free: number[] = [];
  for (let index = palette.length; index < limit; index += 1) free.push(index);
  const folds = free.length >= candidates.length ? [] : planPaletteRoom(palette, usage, Math.min(maxFolds, candidates.length - free.length));
  for (const fold of folds) {
    // Until an effect colour lands here the slot holds its twin's colour, so a
    // pixel that still points at it reads the same either way.
    colors[fold.from] = palette[fold.to] as string;
    free.push(fold.from);
  }

  const added: string[] = [];
  const unmatched: string[] = [];
  for (const { hex } of candidates) {
    const slot = free.shift();
    if (slot === undefined) {
      unmatched.push(hex);
      continue;
    }
    if (slot < colors.length) colors[slot] = hex;
    else colors.push(hex);
    added.push(hex);
  }
  return { colors, added, unmatched, folds };
}
