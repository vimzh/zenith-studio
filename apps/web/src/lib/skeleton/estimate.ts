import { TRANSPARENT, type Grid } from "@zenith/core";
import { contentBounds, type CharacterType, type Joint, type JointPosition, type Pose } from "./model";

/**
 * Inferring a starting skeleton from a sprite.
 *
 * Deliberately a heuristic that reads the silhouette, not a model: it needs to
 * be instant, deterministic, and good enough to drag into place. A skeleton
 * nobody adjusts is the wrong goal — a skeleton that starts near the right
 * shape and can be corrected in five drags is the right one.
 *
 * The silhouette's *width profile* carries most of the signal. On a humanoid,
 * the widest row above the midpoint is the shoulders and the narrowest between
 * shoulders and hips is the waist, which anchors everything else.
 */

/** Opaque pixel count per row, and the horizontal centre of mass of each. */
function widthProfile(grid: Grid): { widths: number[]; centres: number[] } {
  const widths: number[] = [];
  const centres: number[] = [];

  for (let y = 0; y < grid.height; y += 1) {
    let count = 0;
    let sum = 0;
    for (let x = 0; x < grid.width; x += 1) {
      if ((grid.cells[y * grid.width + x] ?? TRANSPARENT) !== TRANSPARENT) {
        count += 1;
        sum += x;
      }
    }
    widths.push(count);
    centres.push(count === 0 ? grid.width / 2 : sum / count);
  }

  return { widths, centres };
}

/** Row index of the widest row within a band, as a fraction of the bounds. */
function widestRow(widths: readonly number[], from: number, to: number): number {
  let best = from;
  let bestWidth = -1;
  for (let y = from; y <= to; y += 1) {
    const width = widths[y] ?? 0;
    if (width > bestWidth) {
      bestWidth = width;
      best = y;
    }
  }
  return best;
}

function narrowestRow(widths: readonly number[], from: number, to: number): number {
  let best = from;
  let bestWidth = Number.POSITIVE_INFINITY;
  for (let y = from; y <= to; y += 1) {
    const width = widths[y] ?? 0;
    if (width > 0 && width < bestWidth) {
      bestWidth = width;
      best = y;
    }
  }
  return best;
}

/**
 * Estimates a pose from a sprite's silhouette.
 *
 * Returns normalised coordinates, so the result is immediately transferable to
 * another character. An empty sprite yields null rather than a pose centred on
 * nothing.
 */
export function estimateSkeleton(grid: Grid, type: CharacterType = "bipedal"): Pose | null {
  const bounds = contentBounds(grid);
  if (bounds === null) {
    return null;
  }

  const { widths, centres } = widthProfile(grid);
  const top = bounds.y;
  const bottom = bounds.y + bounds.height - 1;

  // Normalise a pixel row/column into the content bounds.
  const ny = (y: number): number => (bounds.height <= 1 ? 0 : (y - bounds.y) / (bounds.height - 1));
  const nx = (x: number): number => (bounds.width <= 1 ? 0.5 : (x - bounds.x) / (bounds.width - 1));
  const centreAt = (y: number): number => nx(centres[Math.max(top, Math.min(bottom, y))] ?? bounds.x);

  if (type === "quadrupedal") {
    // A quadruped's mass sits along its length, so bands are horizontal thirds.
    const joints: Partial<Record<Joint, JointPosition>> = {
      head: { x: 0.12, y: 0.25 },
      neck: { x: 0.25, y: 0.35 },
      chest: { x: 0.35, y: 0.45 },
      pelvis: { x: 0.7, y: 0.45 },
      tail: { x: 0.92, y: 0.4 },
      "fore-knee-l": { x: 0.32, y: 0.72 },
      "fore-foot-l": { x: 0.3, y: 1 },
      "fore-knee-r": { x: 0.4, y: 0.72 },
      "fore-foot-r": { x: 0.42, y: 1 },
      "hind-knee-l": { x: 0.68, y: 0.72 },
      "hind-foot-l": { x: 0.66, y: 1 },
      "hind-knee-r": { x: 0.76, y: 0.72 },
      "hind-foot-r": { x: 0.78, y: 1 },
    };
    return { type, joints };
  }

  // Humanoid: read the shoulders and waist off the silhouette, then hang the
  // limbs from them. Chibi proportions put the head far lower.
  const headShare = type === "bipedal-chibi" ? 0.4 : 0.25;
  const headBand = top + Math.floor(bounds.height * headShare);
  const shoulderRow = widestRow(widths, headBand, top + Math.floor(bounds.height * 0.55));
  const waistRow = narrowestRow(widths, shoulderRow, top + Math.floor(bounds.height * 0.75));
  const hipRow = Math.min(bottom, waistRow + Math.floor(bounds.height * 0.05));

  const shoulderHalf = Math.max(1, (widths[shoulderRow] ?? 2) / 2);
  const hipHalf = Math.max(1, (widths[hipRow] ?? 2) / 2);
  const shoulderSpread = (shoulderHalf * 0.8) / Math.max(1, bounds.width - 1);
  const hipSpread = (hipHalf * 0.5) / Math.max(1, bounds.width - 1);

  const chestCentre = centreAt(shoulderRow);
  const hipCentre = centreAt(hipRow);

  const joints: Partial<Record<Joint, JointPosition>> = {
    head: { x: centreAt(top + Math.floor(bounds.height * headShare * 0.4)), y: ny(top) },
    neck: { x: chestCentre, y: ny(headBand) },
    chest: { x: chestCentre, y: ny(shoulderRow) },
    pelvis: { x: hipCentre, y: ny(hipRow) },

    "shoulder-l": { x: chestCentre - shoulderSpread, y: ny(shoulderRow) },
    "shoulder-r": { x: chestCentre + shoulderSpread, y: ny(shoulderRow) },
    "elbow-l": { x: chestCentre - shoulderSpread * 1.1, y: ny(waistRow) },
    "elbow-r": { x: chestCentre + shoulderSpread * 1.1, y: ny(waistRow) },
    "hand-l": { x: chestCentre - shoulderSpread * 1.2, y: ny(hipRow) },
    "hand-r": { x: chestCentre + shoulderSpread * 1.2, y: ny(hipRow) },

    "hip-l": { x: hipCentre - hipSpread, y: ny(hipRow) },
    "hip-r": { x: hipCentre + hipSpread, y: ny(hipRow) },
    "knee-l": { x: hipCentre - hipSpread, y: ny(hipRow + Math.floor((bottom - hipRow) / 2)) },
    "knee-r": { x: hipCentre + hipSpread, y: ny(hipRow + Math.floor((bottom - hipRow) / 2)) },
    "foot-l": { x: hipCentre - hipSpread, y: 1 },
    "foot-r": { x: hipCentre + hipSpread, y: 1 },
  };

  return { type, joints };
}
