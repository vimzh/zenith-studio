import type { Grid } from "@zenith/core";
import {
  contentBounds,
  type CharacterType,
  type ContentBounds,
  type Joint,
  type JointPosition,
  type Pose,
} from "./model";
import { readSilhouette, runCentre, runWidth, scanRows, type Run } from "./silhouette";

/**
 * Inferring a starting skeleton from a sprite.
 *
 * Deliberately a heuristic that reads the silhouette, not a model: it needs to
 * be instant, deterministic, and good enough to drag into place. A skeleton
 * nobody adjusts is the wrong goal — a skeleton that starts near the right
 * shape and can be corrected in five drags is the right one.
 *
 * The silhouette is read as **runs of opaque pixels per row**. On a humanoid
 * those runs carry nearly everything: the width profile peaks at the head,
 * dips at the neck and peaks again at the shoulders; the torso is the widest
 * run; the legs are the row where one run becomes two; an arm held away from
 * the body is a run beside the torso, and one held against it is the torso
 * run's own edge. A held staff or sword is a thin run that persists down most
 * of the sprite, and `readSilhouette` strips it before any of that so it is
 * not mistaken for an arm or a leg.
 *
 * The previous estimator hung every limb from two measured rows and a set of
 * proportions. It put the head joint on the top pixel of the hat, the hands
 * outside the silhouette and the legs straight below the hips wherever the
 * legs actually were. Every joint here is placed on a pixel that is part of
 * the thing it names.
 */

/** Index of the widest run — the torso, on any row that has one. */
function widestIndex(runs: readonly Run[]): number {
  let best = -1;
  let bestWidth = 0;
  runs.forEach((run, index) => {
    if (runWidth(run) > bestWidth) {
      bestWidth = runWidth(run);
      best = index;
    }
  });
  return best;
}

/**
 * The first row where the profile stops widening.
 *
 * Reads the head as "the widest row before the neck", not "the widest row in
 * the top band": a hat brim is a peak followed by a drop, a bare head the same,
 * and a small head above wide shoulders no longer loses to the shoulders.
 */
function firstPeak(widths: readonly number[], from: number, to: number): number {
  let best = from;
  for (let y = from; y <= to; y += 1) {
    const width = widths[y] ?? 0;
    if (width > (widths[best] ?? 0)) {
      best = y;
    } else if (y > best && width < (widths[best] ?? 0) * 0.85) {
      return best;
    }
  }
  return best;
}

/**
 * The first row where the profile stops narrowing, and whether it then widens
 * again. A neck is a valley that widens into shoulders; a waist is a valley
 * that does not — below it the legs split and the widest run only shrinks.
 */
function firstValley(
  widths: readonly number[],
  from: number,
  to: number,
): { readonly row: number; readonly rose: boolean } {
  let best = from;
  for (let y = from; y <= to; y += 1) {
    const width = widths[y] ?? 0;
    if (width > 0 && ((widths[best] ?? 0) === 0 || width < (widths[best] ?? 0))) {
      best = y;
    } else if (y > best && (widths[best] ?? 0) > 0 && width > (widths[best] ?? 0) * 1.25) {
      return { row: best, rose: true };
    }
  }
  return { row: best, rose: false };
}

function massCentre(rows: readonly (readonly Run[])[], from: number, to: number): { x: number; y: number } | null {
  let sumX = 0;
  let sumY = 0;
  let count = 0;
  for (let y = from; y <= to; y += 1) {
    for (const run of rows[y] ?? []) {
      const width = runWidth(run);
      sumX += runCentre(run) * width;
      sumY += y * width;
      count += width;
    }
  }
  return count === 0 ? null : { x: sumX / count, y: sumY / count };
}

/** Follows one leg's run downward from `from`, returning its centre on each row it exists. */
function trackRun(
  rows: readonly (readonly Run[])[],
  from: number,
  to: number,
  start: Run,
  tolerance: number,
): { centres: number[]; last: number } {
  const centres = [runCentre(start)];
  let previous = runCentre(start);
  let last = from;
  for (let y = from + 1; y <= to; y += 1) {
    let nearest: Run | undefined;
    let distance = Number.POSITIVE_INFINITY;
    for (const run of rows[y] ?? []) {
      const d = Math.abs(runCentre(run) - previous);
      if (d < distance) {
        distance = d;
        nearest = run;
      }
    }
    if (nearest === undefined || distance > tolerance) break;
    previous = runCentre(nearest);
    centres.push(previous);
    last = y;
  }
  return { centres, last };
}

function estimateHumanoid(grid: Grid, bounds: ContentBounds, type: CharacterType): Pose {
  const { rows } = readSilhouette(grid, bounds);
  const height = bounds.height;
  const bottom = height - 1;
  const rowsOf = (fraction: number): number => Math.round(height * fraction);

  const torsoRun = rows.map((runs) => {
    const index = widestIndex(runs);
    return index < 0 ? undefined : runs[index];
  });
  const torsoWidths = torsoRun.map((run) => (run === undefined ? 0 : runWidth(run)));
  const torsoCentre = (y: number): number => {
    const run = torsoRun[Math.max(0, Math.min(bottom, y))];
    return run === undefined ? bounds.x + (bounds.width - 1) / 2 : runCentre(run);
  };

  // Vertical landmarks, read top-down off the width profile.
  //
  // The first peak is either the head (a bare head, or a hat brim) or the
  // shoulders of a figure whose head sits straight on them. The valley below
  // tells them apart: a neck widens again into shoulders, a waist does not.
  const firstPeakRow = firstPeak(torsoWidths, 0, Math.min(bottom, rowsOf(type === "bipedal-chibi" ? 0.55 : 0.45)));
  const valley = firstValley(torsoWidths, firstPeakRow, Math.min(bottom, firstPeakRow + rowsOf(0.3)));

  let neckRow: number;
  let shoulderRow: number;
  let headEnd: number;
  if (valley.rose && valley.row > firstPeakRow) {
    neckRow = valley.row;
    shoulderRow = firstPeak(torsoWidths, neckRow, Math.min(bottom, neckRow + rowsOf(0.35)));
    if (shoulderRow <= neckRow) shoulderRow = Math.min(bottom, neckRow + Math.max(1, rowsOf(0.05)));
    headEnd = neckRow - 1;
  } else {
    shoulderRow = Math.max(1, firstPeakRow);
    neckRow = shoulderRow - 1;
    while (neckRow > 0 && (torsoWidths[neckRow] ?? 0) >= (torsoWidths[shoulderRow] ?? 0) * 0.85) neckRow -= 1;
    headEnd = neckRow;
  }

  // The crotch: the first row below the torso where one run becomes two legs.
  const minLeg = Math.max(1, Math.round(bounds.width * 0.06));
  let crotchRow = -1;
  let legRuns: [Run, Run] | undefined;
  for (let y = Math.max(neckRow + 1, shoulderRow + rowsOf(0.15)); y <= bottom - rowsOf(0.08); y += 1) {
    const candidates = (rows[y] ?? [])
      .filter((run) => runWidth(run) >= minLeg)
      .sort((a, b) => runWidth(b) - runWidth(a))
      .slice(0, 2)
      .sort((a, b) => a.start - b.start);
    const [left, right] = candidates;
    if (left === undefined || right === undefined) continue;
    const ratio = Math.min(runWidth(left), runWidth(right)) / Math.max(runWidth(left), runWidth(right));
    const gap = right.start - left.end - 1;
    if (ratio >= 0.35 && gap <= bounds.width * 0.4) {
      crotchRow = y;
      legRuns = [left, right];
      break;
    }
  }
  if (crotchRow < 0) {
    crotchRow = Math.min(bottom, Math.round(shoulderRow + (bottom - shoulderRow) * 0.45));
  }

  const pelvisRow = Math.max(shoulderRow + 1, crotchRow - Math.max(1, rowsOf(0.03)));
  const chestRow = Math.max(shoulderRow, Math.min(pelvisRow - 1, shoulderRow + Math.max(1, rowsOf(0.06))));

  const nx = (x: number): number =>
    bounds.width <= 1 ? 0.5 : Math.max(0, Math.min(1, (x - bounds.x) / (bounds.width - 1)));
  const ny = (y: number): number => (height <= 1 ? 0 : Math.max(0, Math.min(1, y / bottom)));
  const at = (x: number, y: number): JointPosition => ({ x: nx(x), y: ny(y) });

  const joints: Partial<Record<Joint, JointPosition>> = {};

  // Head: the centre of everything above the neck, not the top pixel of the hat.
  const headMass = massCentre(rows, 0, Math.max(0, headEnd));
  joints.head = headMass === null ? at(torsoCentre(0), 0) : at(headMass.x, headMass.y);
  joints.neck = at(torsoCentre(neckRow), neckRow);
  joints.chest = at(torsoCentre(chestRow), chestRow);
  joints.pelvis = at(torsoCentre(pelvisRow), pelvisRow);

  // Shoulders sit just inside the torso's edge on the shoulder row.
  const shoulders = torsoRun[shoulderRow];
  const shoulderInset = shoulders === undefined ? 0 : Math.max(1, Math.round(runWidth(shoulders) * 0.12));
  const shoulderLeft = shoulders === undefined ? torsoCentre(shoulderRow) : shoulders.start + shoulderInset;
  const shoulderRight = shoulders === undefined ? torsoCentre(shoulderRow) : shoulders.end - shoulderInset;
  joints["shoulder-l"] = at(Math.min(shoulderLeft, torsoCentre(shoulderRow)), shoulderRow);
  joints["shoulder-r"] = at(Math.max(shoulderRight, torsoCentre(shoulderRow)), shoulderRow);

  // Arms: a run beside the torso is an arm held away from it; otherwise the
  // arm hangs along the torso's own edge.
  const armBottom = Math.min(bottom, crotchRow + rowsOf(0.08));
  for (const side of ["l", "r"] as const) {
    const beside = (y: number): Run | undefined => {
      const runs = rows[y] ?? [];
      const torso = widestIndex(runs);
      if (torso < 0) return undefined;
      const run = side === "l" ? runs[torso - 1] : runs[torso + 1];
      // An arm is thinner than the torso it hangs beside; below the crotch the
      // widest run is one leg, and the run beside it is the other leg.
      if (run === undefined || runWidth(run) >= runWidth(runs[torso] as Run) * 0.7) return undefined;
      return run;
    };
    const separatedRows: number[] = [];
    for (let y = shoulderRow + 1; y <= armBottom; y += 1) {
      if (beside(y) !== undefined) separatedRows.push(y);
    }
    const band = armBottom - shoulderRow;
    const separated = separatedRows.length >= Math.max(2, Math.round(band * 0.15));

    const edge = (y: number): number => {
      const run = torsoRun[y];
      if (run === undefined) return torsoCentre(y);
      const inset = Math.max(1, Math.round(runWidth(run) * 0.08));
      return side === "l" ? run.start + inset : run.end - inset;
    };

    let handRow: number;
    let handX: number;
    if (separated) {
      handRow = separatedRows[separatedRows.length - 1] as number;
      const hand = beside(handRow) as Run;
      handX = runCentre(hand);
    } else {
      handRow = Math.min(bottom, crotchRow);
      handX = edge(handRow);
    }
    const elbowRow = shoulderRow + Math.round((handRow - shoulderRow) * 0.5);
    const elbowBeside = separated ? beside(elbowRow) : undefined;
    const elbowX = elbowBeside === undefined ? edge(elbowRow) : runCentre(elbowBeside);

    joints[`elbow-${side}`] = at(elbowX, elbowRow);
    joints[`hand-${side}`] = at(handX, handRow);
  }

  // Legs: follow each run down from the crotch to its last row.
  if (legRuns !== undefined) {
    const tolerance = Math.max(2, bounds.width * 0.3);
    const [leftRun, rightRun] = legRuns;
    for (const [side, run] of [["l", leftRun], ["r", rightRun]] as const) {
      const track = trackRun(rows, crotchRow, bottom, run, tolerance);
      const footRow = track.last;
      const kneeRow = crotchRow + Math.round((footRow - crotchRow) * 0.5);
      const kneeX = track.centres[kneeRow - crotchRow] ?? runCentre(run);
      const footX = track.centres[track.centres.length - 1] ?? runCentre(run);
      joints[`hip-${side}`] = at(runCentre(run), pelvisRow);
      joints[`knee-${side}`] = at(kneeX, kneeRow);
      joints[`foot-${side}`] = at(footX, footRow);
    }
  } else {
    // Legs merged into one run — a robe, a side view, a blob. Split it.
    const quarter = (y: number): number => (torsoWidths[Math.max(0, Math.min(bottom, y))] ?? 2) / 4;
    const kneeRow = Math.round((pelvisRow + bottom) / 2);
    for (const side of ["l", "r"] as const) {
      const sign = side === "l" ? -1 : 1;
      joints[`hip-${side}`] = at(torsoCentre(pelvisRow) + sign * quarter(pelvisRow), pelvisRow);
      joints[`knee-${side}`] = at(torsoCentre(kneeRow) + sign * quarter(kneeRow), kneeRow);
      joints[`foot-${side}`] = at(torsoCentre(bottom) + sign * quarter(bottom), bottom);
    }
  }

  return { type, joints };
}

function estimateQuadruped(grid: Grid, bounds: ContentBounds): Pose {
  const rows = scanRows(grid, bounds);
  const height = bounds.height;
  const width = bounds.width;
  const bottom = height - 1;
  const nx = (x: number): number =>
    width <= 1 ? 0.5 : Math.max(0, Math.min(1, (x - bounds.x) / (width - 1)));
  const ny = (y: number): number => (height <= 1 ? 0 : Math.max(0, Math.min(1, y / bottom)));
  const at = (x: number, y: number): JointPosition => ({ x: nx(x), y: ny(y) });

  // Column profile: which end is the head? The ears and head are the highest
  // point of most quadrupeds, so the head is whichever end the top pixel is on.
  let topX = bounds.x + (width - 1) / 2;
  outer: for (let y = 0; y <= bottom; y += 1) {
    const runs = rows[y] ?? [];
    if (runs.length > 0) {
      topX = massCentre(rows, y, y)?.x ?? topX;
      break outer;
    }
  }
  const headOnLeft = topX < bounds.x + (width - 1) / 2;
  /** Column at `fraction` of the way from the head end to the tail end. */
  const along = (fraction: number): number =>
    bounds.x + (headOnLeft ? fraction : 1 - fraction) * Math.max(0, width - 1);

  const legTop = Math.round(height * 0.6);
  const bodyCentreY = (x: number): number => {
    const column = Math.round(x);
    let sum = 0;
    let count = 0;
    let fallbackSum = 0;
    let fallbackCount = 0;
    for (let y = 0; y <= bottom; y += 1) {
      const opaque = (rows[y] ?? []).some((run) => column >= run.start && column <= run.end);
      if (!opaque) continue;
      fallbackSum += y;
      fallbackCount += 1;
      if (y < legTop) {
        sum += y;
        count += 1;
      }
    }
    if (count > 0) return sum / count;
    if (fallbackCount > 0) return fallbackSum / fallbackCount;
    return bottom / 2;
  };

  const massBetween = (from: number, to: number): { x: number; y: number } | null => {
    const lo = Math.min(from, to);
    const hi = Math.max(from, to);
    let sumX = 0;
    let sumY = 0;
    let count = 0;
    for (let y = 0; y <= bottom; y += 1) {
      for (const run of rows[y] ?? []) {
        const start = Math.max(run.start, lo);
        const end = Math.min(run.end, hi);
        if (end < start) continue;
        const n = end - start + 1;
        sumX += ((start + end) / 2) * n;
        sumY += y * n;
        count += n;
      }
    }
    return count === 0 ? null : { x: sumX / count, y: sumY / count };
  };

  const joints: Partial<Record<Joint, JointPosition>> = {};
  const head = massBetween(along(0), along(0.22));
  joints.head = head === null ? at(along(0.1), bodyCentreY(along(0.1))) : at(head.x, head.y);
  joints.neck = at(along(0.27), bodyCentreY(along(0.27)));
  joints.chest = at(along(0.36), bodyCentreY(along(0.36)));
  joints.pelvis = at(along(0.72), bodyCentreY(along(0.72)));
  const tail = massBetween(along(0.9), along(1));
  joints.tail = tail === null ? at(along(0.95), bodyCentreY(along(0.95))) : at(tail.x, tail.y);

  // Feet: the runs on the lowest row that has at least two of them.
  let footRow = bottom;
  for (let y = bottom; y >= Math.max(0, bottom - Math.round(height * 0.12)); y -= 1) {
    if ((rows[y] ?? []).length >= 2) {
      footRow = y;
      break;
    }
  }
  const feet = (rows[footRow] ?? []).map(runCentre);
  const used = new Set<number>();
  const pair = (near: number): [number, number] => {
    const ordered = feet
      .map((x, index) => ({ x, index }))
      .filter(({ index }) => !used.has(index))
      .sort((a, b) => Math.abs(a.x - near) - Math.abs(b.x - near));
    const first = ordered[0];
    if (first === undefined) return [near - 1, near + 1];
    used.add(first.index);
    const second = ordered[1];
    if (second !== undefined && Math.abs(second.x - near) <= width * 0.3) {
      used.add(second.index);
      return first.x <= second.x ? [first.x, second.x] : [second.x, first.x];
    }
    return [first.x - 1, first.x + 1];
  };
  const [foreL, foreR] = pair(along(0.36));
  const [hindL, hindR] = pair(along(0.72));

  const chestY = bodyCentreY(along(0.36));
  const pelvisY = bodyCentreY(along(0.72));
  const knee = (fromX: number, fromY: number, footX: number): JointPosition =>
    at(fromX + (footX - fromX) * 0.5, fromY + (footRow - fromY) * 0.55);

  joints["fore-foot-l"] = at(foreL, footRow);
  joints["fore-foot-r"] = at(foreR, footRow);
  joints["hind-foot-l"] = at(hindL, footRow);
  joints["hind-foot-r"] = at(hindR, footRow);
  joints["fore-knee-l"] = knee(along(0.36), chestY, foreL);
  joints["fore-knee-r"] = knee(along(0.36), chestY, foreR);
  joints["hind-knee-l"] = knee(along(0.72), pelvisY, hindL);
  joints["hind-knee-r"] = knee(along(0.72), pelvisY, hindR);

  return { type: "quadrupedal", joints };
}

/**
 * Estimates a pose from a sprite's silhouette.
 *
 * Returns normalised coordinates, so the result is immediately transferable to
 * another character. Every joint lies within 0–1: each is placed on a pixel of
 * the silhouette, never hung outside it. An empty sprite yields null rather
 * than a pose centred on nothing.
 */
export function estimateSkeleton(grid: Grid, type: CharacterType = "bipedal"): Pose | null {
  const bounds = contentBounds(grid);
  if (bounds === null) {
    return null;
  }
  return type === "quadrupedal" ? estimateQuadruped(grid, bounds) : estimateHumanoid(grid, bounds, type);
}
