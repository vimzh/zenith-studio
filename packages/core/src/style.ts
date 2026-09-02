/**
 * The style contract a project holds over its assets.
 *
 * This is what a flat library cannot do. Your hero is 32x32 on 16 colours with a
 * dark outline; three sessions later the enemy you generated is 48x48,
 * soft-edged, 40 colours. Nothing in a flat library notices, because nothing in
 * a flat library was ever told what the game looks like.
 *
 * Two consequences, and the second is the point:
 *
 *  - Conformance is **deterministic**. Palette, size and alpha are fixed by
 *    arithmetic, not by asking a model to try harder. A style rule enforced by
 *    persuasion is not a rule.
 *  - Generation becomes **fully specified**. "Generate a slime enemy" is
 *    underdetermined in a chat window and completely determined inside a
 *    project: 32x32, high top-down, dark outline, this exact palette, matching
 *    these references. The agent needs no preamble and the human never
 *    re-explains their game.
 */

import { fail } from "./errors";
import { nearestIndex } from "./palette";
import { TRANSPARENT, type Cell, type Grid, type Palette } from "./types";

export const VIEWS = ["side", "low top-down", "high top-down"] as const;
export const PROJECTIONS = ["orthographic", "isometric"] as const;
export const DIRECTION_SETS = ["side2", "cardinal4", "ordinal8"] as const;
export const OUTLINES = ["none", "dark", "darker-hue", "coloured"] as const;
export const SHADINGS = ["flat", "basic", "detailed"] as const;
export const PROPORTIONS = ["realistic", "semi-chibi", "chibi"] as const;

export type View = (typeof VIEWS)[number];
export type Projection = (typeof PROJECTIONS)[number];
export type DirectionSetName = (typeof DIRECTION_SETS)[number];
export type Outline = (typeof OUTLINES)[number];
export type Shading = (typeof SHADINGS)[number];
export type Proportions = (typeof PROPORTIONS)[number];

/** Canvas size per asset type, in pixels. Square. */
export interface CanvasSizes {
  readonly character: number;
  readonly tile: number;
  readonly texture: number;
  readonly item: number;
  readonly ui: number;
}

export interface StyleProfile {
  /** The hard colour law. Every asset in the project resolves to these. */
  readonly palette: Palette;
  readonly canvasSizes: CanvasSizes;
  readonly view: View;
  readonly projection: Projection;
  readonly directionSet: DirectionSetName;
  readonly outline: Outline;
  readonly shading: Shading;
  readonly proportions: Proportions;
  /** Asset ids held up as exemplars. Generation conditions on these. */
  readonly references: readonly string[];
  /**
   * Free-text direction for prompt building — "grimy industrial, muted, worn".
   *
   * Never checked, and deliberately so. It exists to make generation more
   * specific, and a checker that scored prose would be asserting a judgement.
   * The fields above are the contract; this is the brief.
   */
  readonly notes?: string;
}

export const DEFAULT_CANVAS_SIZES: CanvasSizes = Object.freeze({
  character: 32,
  tile: 32,
  texture: 32,
  item: 16,
  ui: 16,
});

export function createStyleProfile(
  palette: Palette,
  overrides: Partial<Omit<StyleProfile, "palette">> = {},
): StyleProfile {
  return {
    palette,
    canvasSizes: { ...DEFAULT_CANVAS_SIZES, ...overrides.canvasSizes },
    view: overrides.view ?? "side",
    projection: overrides.projection ?? "orthographic",
    directionSet: overrides.directionSet ?? "side2",
    outline: overrides.outline ?? "dark",
    shading: overrides.shading ?? "basic",
    proportions: overrides.proportions ?? "semi-chibi",
    references: overrides.references ?? [],
    ...(overrides.notes === undefined ? {} : { notes: overrides.notes }),
  };
}

/** The size this profile expects for an asset type, or null for a type it does not govern. */
export function expectedSize(profile: StyleProfile, assetType: string): number | null {
  const sizes = profile.canvasSizes as unknown as Record<string, number | undefined>;
  return sizes[assetType] ?? null;
}

export type StyleViolationKind = "palette" | "size" | "alpha";

export interface StyleViolation {
  readonly kind: StyleViolationKind;
  /** What is wrong and what it should be. Never a bare verdict. */
  readonly message: string;
  /** Offending pixels, for the kinds that have coordinates. */
  readonly coordinates: readonly (readonly [number, number])[];
}

export interface StyleReport {
  readonly conforms: boolean;
  readonly violations: readonly StyleViolation[];
}

/** Cap on listed coordinates. Beyond this the count is the information, not the list. */
const MAX_LISTED = 64;

/**
 * Checks one asset against the project's style.
 *
 * Reports specific violations with coordinates rather than a verdict, for the
 * same reason the seam check does: an agent that knows *which* pixels are out of
 * palette can fix exactly those and re-check, where one told "does not conform"
 * can only guess or regenerate.
 *
 * Only the deterministic aspects are checked — palette, size, alpha. Outline,
 * shading and proportions are judgements a model makes, not properties a grid
 * has, and claiming to verify them would be dishonest.
 */
export function checkStyleConsistency(
  grids: readonly Grid[],
  profile: StyleProfile,
  assetType: string,
  sourcePalette: Palette = profile.palette,
): StyleReport {
  const violations: StyleViolation[] = [];
  const first = grids[0];
  if (first === undefined) {
    fail("invalid_argument", "Cannot check style with no frames. Pass at least one grid.");
  }

  const wanted = expectedSize(profile, assetType);
  if (wanted !== null && (first.width !== wanted || first.height !== wanted)) {
    violations.push({
      kind: "size",
      message:
        `Canvas is ${String(first.width)}x${String(first.height)} but the project's ${assetType} size is ` +
        `${String(wanted)}x${String(wanted)}. Use conform_to_style to resize, which crops or pads rather than scaling.`,
      coordinates: [],
    });
  }

  const outOfPalette: (readonly [number, number])[] = [];
  for (const grid of grids) {
    for (let i = 0; i < grid.cells.length; i += 1) {
      const value = grid.cells[i] as Cell;
      if (value === TRANSPARENT) continue;
      const source = sourcePalette.colors[value];
      const allowed =
        source !== undefined &&
        profile.palette.colors.some((colour) => colour.hex === source.hex);
      if (!allowed) {
        if (outOfPalette.length < MAX_LISTED) {
          outOfPalette.push([i % grid.width, (i / grid.width) | 0]);
        }
      }
    }
  }

  if (outOfPalette.length > 0) {
    const allowed = profile.palette.colors.length;
    violations.push({
      kind: "palette",
      message:
        `Pixels use colours outside the project palette, which allows ${String(allowed)} colours. ` +
        "Use conform_to_style to remap them to the nearest project colour in Oklab.",
      coordinates: outOfPalette,
    });
  }

  return { conforms: violations.length === 0, violations };
}

/** One line per violation, with coordinates, ready to hand to an agent. */
export function describeStyleReport(report: StyleReport, name: string): string {
  if (report.conforms) return `'${name}' conforms to the project style.`;

  const lines = report.violations.map((violation) => {
    if (violation.coordinates.length === 0) return `  [${violation.kind}] ${violation.message}`;
    const listed = violation.coordinates
      .map(([x, y]) => `(${String(x)}, ${String(y)})`)
      .join(", ");
    const more = violation.coordinates.length >= MAX_LISTED ? ", and more" : "";
    return `  [${violation.kind}] ${violation.message}\n    at ${listed}${more}`;
  });
  return `'${name}' does not conform to the project style:\n${lines.join("\n")}`;
}

/**
 * Brings an asset into conformance, deterministically.
 *
 * Palette, size and alpha are fixed by arithmetic. A style rule enforced by
 * asking a model to try harder is not a rule, and this is the half that makes
 * the contract real rather than aspirational — same input, same output, every
 * time, with no network and no judgement.
 *
 * Outline and shading are not touched. They are not derivable from a grid, and
 * inventing them here would be guessing under the name of conforming.
 */
export function conformToStyle(
  grid: Grid,
  profile: StyleProfile,
  assetType: string,
  sourcePalette: Palette = profile.palette,
): { grid: Grid; changed: number; resized: boolean } {
  const wanted = expectedSize(profile, assetType);
  const resized = wanted !== null && (grid.width !== wanted || grid.height !== wanted);

  const width = resized ? (wanted as number) : grid.width;
  const height = resized ? (wanted as number) : grid.height;
  const cells = new Int8Array(width * height).fill(TRANSPARENT);

  // Resize crops or pads from the top-left; it never scales. Scaling would
  // resample the art, which is the one thing this pipeline never does — a
  // "conform" that silently blurred a sprite would be worse than a violation.
  const copyWidth = Math.min(width, grid.width);
  const copyHeight = Math.min(height, grid.height);

  let changed = 0;
  for (let y = 0; y < copyHeight; y += 1) {
    for (let x = 0; x < copyWidth; x += 1) {
      const value = grid.cells[y * grid.width + x] as Cell;
      const conformed = conformCell(value, sourcePalette, profile.palette);
      if (conformed !== value) changed += 1;
      cells[y * width + x] = conformed;
    }
  }

  return { grid: { width, height, cells }, changed, resized };
}

/**
 * Maps one cell into the palette.
 *
 * An index past the palette is clamped to the nearest *existing* index rather
 * than dropped: the pixel was drawn deliberately, and erasing it would lose art
 * to enforce a colour rule. Transparency is preserved exactly — invariant 2
 * means there is no partial state to negotiate.
 */
function conformCell(value: Cell, sourcePalette: Palette, palette: Palette): Cell {
  if (value === TRANSPARENT) return TRANSPARENT;
  const source = sourcePalette.colors[value];
  if (source !== undefined) return nearestIndex(palette, source.hex);
  return Math.max(0, Math.min(palette.colors.length - 1, value)) as Cell;
}

/**
 * The style contract as instructions for an image model.
 *
 * This is the half of "durable context" that costs nothing. "Generate a slime
 * enemy" is underspecified in a chat window and fully determined inside a
 * project, and the difference is entirely this text — the model is told the
 * camera angle, the outline treatment, the shading depth and the exact palette
 * instead of guessing at all four.
 *
 * Only what a model can act on. `directionSet` and `references` are absent
 * because neither is an instruction about how one image should look: the first
 * governs how many images to make, the second is conditioning that travels as
 * an image rather than as words.
 */
export interface StyleBriefOptions {
  /**
   * Whether the palette is stated as a law the model must obey.
   *
   * True for reading the contract back — `get_style_profile` should show the
   * palette, and `conform_to_style` enforces it exactly. False for generating,
   * because a project palette handed to an image model as "use only these 16
   * colours" makes every asset in the project look like the same asset: the
   * model reaches for the nearest listed shade instead of the right one, and a
   * bush, a fire and a coin come back in the same eight greens. The palette
   * stays in the contract and remains checkable and conformable on demand; it
   * simply no longer narrows the model's hand while it draws.
   */
  readonly lockPalette?: boolean;
}

export function styleBrief(
  profile: StyleProfile,
  assetType?: string,
  options: StyleBriefOptions = {},
): string {
  const parts: string[] = [];

  const size = assetType === undefined ? null : expectedSize(profile, assetType);
  if (size !== null) {
    // Feature scale is the failure that matters most: art composed finer than
    // the target grid dissolves when resampled, however good it looked large.
    const features = Math.max(3, Math.round(size / 4));
    parts.push(
      `Composed for a ${String(size)}x${String(size)} pixel grid — at most ${String(features)} distinct shapes across the full width, each a single flat colour.`,
    );
  }

  parts.push(`Drawn in ${profile.view} view, ${profile.projection} projection.`);

  const outline: Record<Outline, string> = {
    none: "No outline around forms.",
    dark: "A solid dark outline around every form.",
    "darker-hue": "An outline in a darker shade of each form's own colour, not black.",
    coloured: "A coloured outline that varies with the form it surrounds.",
  };
  parts.push(outline[profile.outline]);

  const shading: Record<Shading, string> = {
    flat: "Flat colour with no shading.",
    basic: "Simple two-tone shading — one light, one shadow, hard edges between them.",
    detailed: "Layered shading with several steps per surface, still hard-edged.",
  };
  parts.push(shading[profile.shading]);

  if (profile.proportions !== "realistic") {
    const proportions: Record<Proportions, string> = {
      realistic: "",
      "semi-chibi": "Slightly stylised proportions — a somewhat large head, simplified limbs.",
      chibi: "Chibi proportions — a very large head and small body.",
    };
    parts.push(proportions[profile.proportions]);
  }

  if (options.lockPalette !== false) {
    parts.push(
      `Use only these ${String(profile.palette.colors.length)} colours: ${profile.palette.colors.map((colour) => colour.hex).join(", ")}.`,
    );
  }

  if (profile.notes !== undefined && profile.notes.trim() !== "") {
    parts.push(`Art direction: ${profile.notes.trim()}`);
  }

  return parts.join(" ");
}
