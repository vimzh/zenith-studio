import { TRANSPARENT, type Grid } from "@zenith/core";
import type { ContentBounds } from "./model";

/**
 * Reading a sprite's silhouette as runs of opaque pixels per row.
 *
 * Shared by the estimator, which places joints from the runs, and the rig,
 * which needs to know which pixels are a held prop rather than the body.
 */

export interface Run {
  readonly start: number;
  readonly end: number;
}

export const runWidth = (run: Run): number => run.end - run.start + 1;
export const runCentre = (run: Run): number => (run.start + run.end) / 2;

/** Opaque runs per content row, columns in grid coordinates. */
export function scanRows(grid: Grid, bounds: ContentBounds): Run[][] {
  const rows: Run[][] = [];
  for (let y = bounds.y; y < bounds.y + bounds.height; y += 1) {
    const runs: Run[] = [];
    let start = -1;
    for (let x = bounds.x; x <= bounds.x + bounds.width; x += 1) {
      const opaque =
        x < bounds.x + bounds.width && (grid.cells[y * grid.width + x] ?? TRANSPARENT) !== TRANSPARENT;
      if (opaque && start < 0) start = x;
      if (!opaque && start >= 0) {
        runs.push({ start, end: x - 1 });
        start = -1;
      }
    }
    rows.push(runs);
  }
  return rows;
}

export type PropSide = "l" | "r";

export interface Silhouette {
  /** Runs per content row with any held prop removed. */
  readonly rows: readonly (readonly Run[])[];
  /** Per grid pixel: 0 for body, 1 for a prop on the left, 2 for one on the right. */
  readonly props: Uint8Array;
  readonly propSides: readonly PropSide[];
}

/**
 * Separates a held prop from the body.
 *
 * A staff is a thin run, separated from the body, present down most of the
 * sprite. An arm is thin and separated too, but only for a third of the
 * height, and a leg only below it; a leg is as wide as the leg beside it. So
 * a side whose outermost run is separated and thinner than the row's widest,
 * in more than half the rows and in both halves of the sprite, is holding
 * something.
 *
 * Where the prop is separated it is simply dropped from the row. Where it
 * merges with the body — the hand gripping it, the end resting by a boot — it
 * is recovered by flooding from the separated pixels through the prop's own
 * columns, so the rig can move the whole staff as one thing. The flood is
 * confined to those columns: a hat brim that happens to overhang them is not
 * reached unless it touches the prop directly.
 */
export function readSilhouette(grid: Grid, bounds: ContentBounds): Silhouette {
  const raw = scanRows(grid, bounds);
  const thin = Math.max(2, Math.round(bounds.width * 0.08));
  const props = new Uint8Array(grid.width * grid.height);
  const propSides: PropSide[] = [];
  let rows: Run[][] = raw.map((runs) => [...runs]);

  for (const side of ["l", "r"] as const) {
    const isProp = (runs: readonly Run[]): boolean => {
      if (runs.length < 2) return false;
      const outer = side === "l" ? runs[0] : runs[runs.length - 1];
      if (outer === undefined || runWidth(outer) > thin) return false;
      // Thinner than the body beside it, not merely thin: a leg beside its
      // twin is as wide as the row's widest run, a staff beside a leg is not.
      const widest = Math.max(...runs.map(runWidth));
      return runWidth(outer) <= widest * 0.7;
    };
    // A prop runs from the hand down past the legs, so it qualifies in both
    // halves of the sprite. Arms qualify only above the waist, legs only below.
    const half = Math.floor(raw.length / 2);
    const upper = rows.slice(0, half).filter(isProp).length;
    const lower = rows.slice(half).filter(isProp).length;
    if (upper + lower < raw.length * 0.55) continue;
    if (upper < half * 0.25 || lower < (raw.length - half) * 0.25) continue;

    const code = side === "l" ? 1 : 2;
    propSides.push(side);
    let bandMin = Number.POSITIVE_INFINITY;
    let bandMax = Number.NEGATIVE_INFINITY;
    const queue: number[] = [];

    rows = rows.map((runs, index) => {
      if (!isProp(runs)) return runs;
      const outer = (side === "l" ? runs[0] : runs[runs.length - 1]) as Run;
      const y = bounds.y + index;
      if (outer.start < bandMin) bandMin = outer.start;
      if (outer.end > bandMax) bandMax = outer.end;
      for (let x = outer.start; x <= outer.end; x += 1) {
        const offset = y * grid.width + x;
        props[offset] = code;
        queue.push(offset);
      }
      return side === "l" ? runs.slice(1) : runs.slice(0, -1);
    });

    // Recover the prop where it merges with the body.
    while (queue.length > 0) {
      const offset = queue.pop() as number;
      const x = offset % grid.width;
      const y = Math.floor(offset / grid.width);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < bandMin || nx > bandMax) continue;
        if (ny < bounds.y || ny >= bounds.y + bounds.height) continue;
        const next = ny * grid.width + nx;
        if (props[next] !== 0) continue;
        if ((grid.cells[next] ?? TRANSPARENT) === TRANSPARENT) continue;
        props[next] = code;
        queue.push(next);
      }
    }
  }

  return { rows, props, propSides };
}
