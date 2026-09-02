import type { Grid } from "@zenith/core";
import { animateProcedural } from "@/lib/animation";
import {
  DIRECTION_SETS,
  generationCount,
  mirrorGrid,
  planDirectionSet,
  type Direction,
  type DirectionSet,
  type Provenance,
} from "@/lib/directions";
import { packSpritesheet, type PackedSheet, type SheetFrame } from "@/lib/spritesheet";
import { pixelize, type PixelizeResult, type RasterImage } from "@/lib/pixelize";

/**
 * Concept art to playable character.
 *
 * Deliberately a chain of named steps rather than one call. Every step commits
 * its own artifact, so a bad north-facing sprite is fixed in place instead of
 * re-running the whole thing — and an agent driving this is orchestrating
 * primitives it can inspect, not invoking a black box it has to trust.
 *
 * The generative steps are injected. Everything here is pure and testable; the
 * model calls live behind `generateDirection`, so the chain's *shape* can be
 * verified without a network or an API key.
 */

export interface CharacterStep {
  readonly step: string;
  readonly detail: string;
}

export interface BuildCharacterOptions {
  readonly directionSet?: DirectionSet;
  /** Which facing the supplied reference depicts. Must belong to directionSet. */
  readonly baseDirection?: Direction;
  readonly targetWidth?: number;
  readonly maxColors?: number;
  /** Idle bob and a walk cycle by default; pass an empty array to skip. */
  readonly animations?: readonly { name: string; preset: "bob" | "blink" | "sway"; frames: number }[];
  /**
   * Produces a direction that cannot be mirrored into existence.
   *
   * Omitted means mirror-only: the chain completes what it can for free and
   * reports the rest as skipped rather than failing.
   */
  readonly generateDirection?: (base: Grid, direction: Direction) => Promise<Grid> | Grid;
}

export interface CharacterResult {
  readonly pixelised: PixelizeResult;
  readonly directions: ReadonlyMap<Direction, { grid: Grid; provenance: Provenance }>;
  readonly sheet: PackedSheet;
  readonly steps: readonly CharacterStep[];
  /** Directions that needed a model but had none available. */
  readonly skipped: readonly Direction[];
}

const DEFAULT_ANIMATIONS = [
  { name: "idle", preset: "bob" as const, frames: 2 },
  { name: "walk", preset: "sway" as const, frames: 4 },
];

export async function buildCharacter(
  reference: RasterImage,
  options: BuildCharacterOptions = {}
): Promise<CharacterResult> {
  const steps: CharacterStep[] = [];
  const directionSet = options.directionSet ?? "cardinal4";
  const base = options.baseDirection ?? DIRECTION_SETS[directionSet][0];
  if (!DIRECTION_SETS[directionSet].some((direction) => direction === base)) {
    throw new Error(`Base direction '${base}' is not part of '${directionSet}'.`);
  }

  const pixelised = pixelize(reference, {
    targetWidth: options.targetWidth,
    maxColors: options.maxColors,
  });
  steps.push({
    step: "pixelize",
    detail: `${String(pixelised.grid.width)}x${String(pixelised.grid.height)}, ${String(pixelised.palette.length)} colours, input classified as ${pixelised.kind}.`,
  });

  // The caller names what the reference depicts; guessing front as north files
  // a correct drawing under the wrong direction and poisons every later turn.
  const directions = new Map<Direction, { grid: Grid; provenance: Provenance }>([
    [base, { grid: pixelised.grid, provenance: "drawn" }],
  ]);

  const plan = planDirectionSet([base], directionSet);
  steps.push({
    step: "plan_directions",
    detail: `${String(DIRECTION_SETS[directionSet].length)} directions: ${String(
      plan.filter((s) => s.method === "mirror").length
    )} by mirroring (free and exact), ${String(generationCount(plan))} needing generation.`,
  });

  const skipped: Direction[] = [];

  for (const step of plan) {
    if (step.method === "have") {
      continue;
    }

    if (step.method === "mirror") {
      const source = directions.get(step.from as Direction);
      if (source !== undefined) {
        directions.set(step.direction, {
          grid: mirrorGrid(source.grid),
          provenance: "mirrored",
        });
        continue;
      }
    }

    if (options.generateDirection === undefined) {
      skipped.push(step.direction);
      continue;
    }

    directions.set(step.direction, {
      grid: await options.generateDirection(pixelised.grid, step.direction),
      provenance: "generated",
    });
  }

  steps.push({
    step: "generate_directions",
    detail:
      skipped.length === 0
        ? `${String(directions.size)} directions ready.`
        : `${String(directions.size)} ready; ${String(skipped.length)} skipped with no generator available: ${skipped.join(", ")}.`,
  });

  const frames: SheetFrame[] = [];
  const animations = options.animations ?? DEFAULT_ANIMATIONS;

  for (const [direction, entry] of directions) {
    if (animations.length === 0) {
      frames.push({ name: direction, grid: entry.grid, tag: direction });
      continue;
    }
    for (const animation of animations) {
      const cycle = animateProcedural(entry.grid, animation.preset, { frames: animation.frames });
      cycle.forEach((grid, index) => {
        frames.push({
          name: `${direction}_${animation.name}_${String(index)}`,
          grid,
          tag: `${direction}_${animation.name}`,
        });
      });
    }
  }

  steps.push({
    step: "animate",
    detail: `${String(animations.length)} animation(s) per direction, ${String(frames.length)} frames total.`,
  });

  const sheet = packSpritesheet(frames, { columns: Math.max(1, animations[0]?.frames ?? 4) });
  steps.push({
    step: "export_spritesheet",
    detail: `${String(sheet.atlas.meta.size.w)}x${String(sheet.atlas.meta.size.h)} sheet, ${String(sheet.atlas.meta.frameTags.length)} tagged animation(s).`,
  });

  return { pixelised, directions, sheet, steps, skipped };
}
