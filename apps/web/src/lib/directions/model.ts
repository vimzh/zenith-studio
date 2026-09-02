import { TRANSPARENT, createGrid, type Cell, type Grid } from "@zenith/core";

/**
 * Directional sprites.
 *
 * Top-down and isometric games need a character drawn facing four or eight
 * ways, which is the most tedious job in pixel art. Most of it is generative
 * and imperfect — but not all of it: **east and west are a horizontal flip**,
 * as are NE/NW and SE/SW. That path is deterministic, instant, and pixel-exact,
 * and it turns eight directions into five generations.
 *
 * The deliberate design here is that the free path is the default and the
 * expensive one is the fallback, not the other way round.
 */

export const VIEWS = ["side", "low top-down", "high top-down"] as const;
export type View = (typeof VIEWS)[number];

export const DIRECTIONS = [
  "north",
  "north-east",
  "east",
  "south-east",
  "south",
  "south-west",
  "west",
  "north-west",
] as const;
export type Direction = (typeof DIRECTIONS)[number];

export const DIRECTION_SETS = {
  side2: ["east", "west"],
  cardinal4: ["north", "east", "south", "west"],
  ordinal8: [...DIRECTIONS],
} as const satisfies Record<string, readonly Direction[]>;

export type DirectionSet = keyof typeof DIRECTION_SETS;

/**
 * The direction a horizontal flip produces, or null when there is none.
 *
 * North and south face the camera and have no mirror partner — flipping them
 * yields the same direction, which is why a bilaterally symmetric character
 * still needs them drawn.
 */
export function mirrorOf(direction: Direction): Direction | null {
  switch (direction) {
    case "east":
      return "west";
    case "west":
      return "east";
    case "north-east":
      return "north-west";
    case "north-west":
      return "north-east";
    case "south-east":
      return "south-west";
    case "south-west":
      return "south-east";
    default:
      return null;
  }
}

/** Horizontal flip. Pixel-exact and lossless — the whole point of this path. */
export function mirrorGrid(grid: Grid): Grid {
  const out = createGrid(grid.width, grid.height, TRANSPARENT);
  for (let y = 0; y < grid.height; y += 1) {
    const row = y * grid.width;
    for (let x = 0; x < grid.width; x += 1) {
      out.cells[row + (grid.width - 1 - x)] = (grid.cells[row + x] ?? TRANSPARENT) as Cell;
    }
  }
  return out;
}

export type Provenance = "drawn" | "mirrored" | "generated";

export interface DirectionEntry {
  readonly direction: Direction;
  readonly grid: Grid;
  readonly provenance: Provenance;
}

export interface DirectionPlanStep {
  readonly direction: Direction;
  readonly method: "have" | "mirror" | "generate";
  /** For `mirror`, the direction it is flipped from. */
  readonly from?: Direction;
}

/**
 * Works out how to complete a direction set as cheaply as possible.
 *
 * Mirroring is preferred wherever a partner already exists, so the plan reports
 * generation only for directions that genuinely cannot be derived. An agent
 * reads this before spending anything.
 */
export function planDirectionSet(
  have: readonly Direction[],
  set: DirectionSet
): DirectionPlanStep[] {
  const present = new Set<Direction>(have);
  const plan: DirectionPlanStep[] = [];

  for (const direction of DIRECTION_SETS[set]) {
    if (present.has(direction)) {
      plan.push({ direction, method: "have" });
      continue;
    }

    const partner = mirrorOf(direction);
    if (partner !== null && present.has(partner)) {
      plan.push({ direction, method: "mirror", from: partner });
      // A mirrored direction can itself be a source for later steps.
      present.add(direction);
      continue;
    }

    plan.push({ direction, method: "generate" });
    present.add(direction);
  }

  return plan;
}

/** How many directions in a plan need a model. The number that costs money. */
export function generationCount(plan: readonly DirectionPlanStep[]): number {
  return plan.filter((step) => step.method === "generate").length;
}

/**
 * Which directions are reachable by mirroring alone, with no model at all.
 *
 * Distinct from reading `method === "mirror"` off a full plan, and the
 * difference is not academic: that plan assumes every generation succeeds, so
 * it counts `west` as mirrorable because `east` will exist by then. With no
 * generator, `east` never arrives and `west` is unreachable too. Reporting the
 * optimistic number to someone who has no model configured promises assets that
 * cannot be produced.
 */
export function mirrorableFrom(
  have: readonly Direction[],
  set: DirectionSet
): Direction[] {
  const present = new Set<Direction>(have);
  const reachable: Direction[] = [];

  // Repeat to a fixed point: a direction mirrored in this pass can be the
  // source for another in the next.
  let changed = true;
  while (changed) {
    changed = false;
    for (const direction of DIRECTION_SETS[set]) {
      if (present.has(direction)) {
        continue;
      }
      const partner = mirrorOf(direction);
      if (partner !== null && present.has(partner)) {
        present.add(direction);
        reachable.push(direction);
        changed = true;
      }
    }
  }

  return reachable;
}
