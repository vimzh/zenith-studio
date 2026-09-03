import { createGrid, paletteHexes, TRANSPARENT, type Cell, type DocumentStore, type Grid } from "@zenith/core";
import { buildCharacter } from "@/lib/character";
import {
  directionFromName,
  generationCount,
  mirrorGrid,
  planDirectionSet,
  type Direction,
  type DirectionSet,
} from "@/lib/directions";
import { deriveBlobTileset } from "@/lib/tileset";
import { checkReadability, resizeCanvas, rotateGrid, type Anchor, type QuarterTurn } from "@/lib/transform";
import { frameToCanvas, pixelize } from "@/lib/pixelize";
import type { RasterImage } from "@/lib/pixelize";
import {
  animateGridWithSkeleton,
  deformGridByPose,
  estimateSkeleton,
  poseTemplate,
  type Pose,
} from "@/lib/skeleton";
import { projects, type AssetPlacement } from "./projects";
import { session, type AssetSummary, type AssetType } from "./session";

/**
 * Asset-producing operations, shared by the UI panels and available to the
 * WebMCP tool layer.
 *
 * Each returns a summary string, the same contract as `exporters.ts`: the
 * caller reports what happened rather than assuming it worked.
 */

/**
 * Runs `work`, then puts the active asset back where it was.
 *
 * `session.create()` reassigns `activeId`, which is right when the human asked
 * for a new asset and wrong when one is a by-product. These generators are the
 * second case: deriving a tileset from a tile does not mean you stopped working
 * on the tile.
 *
 * Left alone, `activeId` drifts to the last thing created while the route stays
 * put, and `readScopeContext` — correctly — treats that disagreement as "no
 * asset open". The visible result is the agent surface collapsing to the
 * library tools and the chat reporting nothing to edit, with no error anywhere.
 * See "The route owns which asset is open" in AGENTS.md; this is the hazard
 * that section names, reached through creation rather than through `close()`.
 *
 * Anything that genuinely wants to move the human's view says so explicitly
 * with `assetNavigation.request`, which is the only thing allowed to mean it.
 */
/**
 * Puts an asset with no source into the open project's root.
 *
 * The counterpart to `projects.inherit`, for the creators built from a
 * reference image rather than from an existing asset: there is nothing to sit
 * beside, and the root is where `create_asset` puts a new asset too. Without
 * it these landed in the loose pool — present in the library, absent from the
 * project the human was working in, and reported by nothing.
 */
function placeInOpenProject(assetId: string): void {
  const projectId = projects.activeProjectId;
  if (projectId !== null) projects.place(assetId, projectId, projects.activeFolderId);
}

/** A slow creator must validate its captured destination before saving assets. */
export function assertGenerationDestination({ projectId, folderId }: AssetPlacement): void {
  if (projectId !== null && projects.getProject(projectId) === undefined) {
    throw new Error("The generation destination project was deleted. No asset was created.");
  }
  if (folderId !== null && (projectId === null || projects.getFolder(folderId)?.projectId !== projectId)) {
    throw new Error("The generation destination folder was deleted or moved. No asset was created.");
  }
}

function preservingActiveAsset<T>(work: () => T): T {
  const before = session.activeId;
  const result = work();
  if (before !== null && session.activeId !== before && session.get(before) !== undefined) {
    session.open(before);
  }
  return result;
}

/** Resolve named siblings inside the source project, never a different game. */
export function directionFamily(sourceId: string, baseName?: string): {
  name: string;
  direction: Direction | undefined;
  assets: Map<Direction, AssetSummary>;
} {
  const summaries = session.list();
  const source = summaries.find((asset) => asset.id === sourceId);
  if (source === undefined) throw new Error(`No asset '${sourceId}' is open.`);
  const direction = directionFromName(source.name);
  const name = baseName ?? (direction === undefined ? source.name : source.name.slice(0, -direction.length - 1));
  const projectId = projects.placementOf(sourceId).projectId;
  const assets = new Map<Direction, AssetSummary>();
  for (const asset of summaries) {
    const facing = directionFromName(asset.name);
    if (facing !== undefined && asset.name.toLowerCase() === `${name} ${facing}`.toLowerCase() && projects.placementOf(asset.id).projectId === projectId) {
      if (!assets.has(facing) || asset.id === sourceId) assets.set(facing, asset);
    }
  }
  return { name, direction, assets };
}

/**
 * Creates one asset per direction, mirroring wherever a partner exists.
 *
 * Mirroring is exact and free, so the plan prefers it — eight directions cost
 * five generations rather than eight. Without a generator the un-mirrorable
 * directions are reported rather than faked.
 */
export function generateDirections(
  sourceId: string,
  set: DirectionSet,
  generate?: (base: Grid, direction: Direction) => Grid
): string {
  const store = session.get(sourceId);
  const summary = session.list().find((asset) => asset.id === sourceId);
  if (store === undefined || summary === undefined) {
    throw new Error(`No asset '${sourceId}' is open.`);
  }

  const family = directionFamily(sourceId);
  const base = family.direction ?? (set === "side2" ? "east" : "south");
  const grids = new Map<Direction, { grid: Grid; palette: readonly string[]; sourceId: string }>();
  for (const [direction, asset] of family.assets) {
    const sibling = session.get(asset.id);
    if (sibling === undefined) throw new Error(`No asset '${asset.id}' is open.`);
    grids.set(direction, { grid: sibling.readComposite(), palette: paletteHexes(sibling.palette), sourceId: asset.id });
  }
  if (!grids.has(base)) grids.set(base, { grid: store.readComposite(), palette: paletteHexes(store.palette), sourceId });
  const existing = new Set(grids.keys());
  const plan = planDirectionSet([...existing], set);
  const skipped: Direction[] = [];

  for (const step of plan) {
    if (step.method === "have") {
      continue;
    }
    if (step.method === "mirror") {
      const source = grids.get(step.from as Direction);
      if (source !== undefined) {
        grids.set(step.direction, { ...source, grid: mirrorGrid(source.grid) });
        continue;
      }
    }
    if (generate === undefined) {
      skipped.push(step.direction);
      continue;
    }
    grids.set(step.direction, { grid: generate(store.readComposite(), step.direction), palette: paletteHexes(store.palette), sourceId });
  }

  let created = 0;
  preservingActiveAsset(() => {
  for (const [direction, entry] of grids) {
    if (existing.has(direction)) {
      continue;
    }
    const { grid, palette } = entry;
    const id = session.create({
      name: `${family.name} ${direction}`,
      type: "character",
      preset: "tile-32",
      grid,
      palette,
      width: grid.width,
      height: grid.height,
    });
    projects.inherit(entry.sourceId, id);
    created += 1;
  }
  });

  const mirrored = plan.filter((step) => step.method === "mirror").length;
  return skipped.length === 0
    ? `Created ${String(created)} directions (${String(mirrored)} mirrored exactly, ${String(generationCount(plan))} generated).`
    : `Created ${String(created)} directions; ${String(skipped.length)} need a model and were skipped: ${skipped.join(", ")}.`;
}

/**
 * Derives a 47-tile blob set from the open tile and lays it out as one sheet.
 *
 * A sheet rather than 47 assets: that is the shape Tiled and Godot import, and
 * 47 library entries for one terrain would bury everything else.
 */
export function generateTileset(sourceId: string, edgeIndex?: Cell): string {
  const store = session.get(sourceId);
  const summary = session.list().find((asset) => asset.id === sourceId);
  if (store === undefined || summary === undefined) {
    throw new Error(`No asset '${sourceId}' is open.`);
  }

  const base = store.readComposite();
  if (base.width !== base.height || base.width % 2 !== 0) {
    throw new Error(
      `A tileset base must be square with an even size so it splits into quadrants. '${summary.name}' is ${String(base.width)}x${String(base.height)}.`
    );
  }

  const { tiles } = deriveBlobTileset(base, edgeIndex === undefined ? {} : { edgeIndex });

  const columns = 8;
  const rows = Math.ceil(tiles.length / columns);
  const sheet = createGrid(columns * base.width, rows * base.height, TRANSPARENT);

  tiles.forEach((tile, index) => {
    const originX = (index % columns) * base.width;
    const originY = Math.floor(index / columns) * base.height;
    for (let y = 0; y < tile.height; y += 1) {
      for (let x = 0; x < tile.width; x += 1) {
        sheet.cells[(originY + y) * sheet.width + originX + x] = (tile.cells[y * tile.width + x] ??
          TRANSPARENT) as Cell;
      }
    }
  });

  const id = preservingActiveAsset(() =>
    session.create({
      name: `${summary.name} tileset`,
      type: "tileset",
      preset: "tile-32",
      grid: sheet,
      palette: paletteHexes(store.palette),
      width: sheet.width,
      height: sheet.height,
    })
  );

  return `Derived ${String(tiles.length)} tiles by composition into a ${String(sheet.width)}x${String(sheet.height)} sheet (${id}). No model involved, so every tile shares one texture and the edges meet.`;
}

/** Runs the concept-art chain and adds each direction to the library. */
export async function buildCharacterFromReference(
  reference: RasterImage,
  name: string,
  options: { directionSet?: DirectionSet; baseDirection?: Direction; targetWidth?: number; destination?: AssetPlacement } = {}
): Promise<string> {
  const destination = options.destination ?? { projectId: projects.activeProjectId, folderId: projects.activeFolderId };
  const targetWidth = options.targetWidth ?? 32;
  const framed = frameToCanvas(reference, targetWidth, targetWidth);
  const result = await buildCharacter(framed?.image ?? reference, {
    directionSet: options.directionSet ?? "cardinal4",
    baseDirection: options.baseDirection,
    targetWidth,
    animations: [],
  });

  const palette = result.pixelised.palette;
  assertGenerationDestination(destination);
  preservingActiveAsset(() => {
  for (const [direction, entry] of result.directions) {
    const id = session.create({
      name: `${name} ${direction}`,
      type: "character" as AssetType,
      preset: "tile-32",
      grid: entry.grid,
      palette,
      width: entry.grid.width,
      height: entry.grid.height,
    });
    if (destination.projectId !== null && !projects.place(id, destination.projectId, destination.folderId)) {
      throw new Error(`The generation destination changed before '${id}' could be placed. The asset is available in the loose library.`);
    }
  }
  });

  const preparation = framed === null ? "" : `prepare_reference: ${framed.note} `;
  const steps = preparation + result.steps.map((step) => `${step.step}: ${step.detail}`).join(" ");
  return result.skipped.length === 0
    ? `Built ${String(result.directions.size)} directions. ${steps}`
    : `Built ${String(result.directions.size)} directions; ${String(result.skipped.length)} skipped without a generator. ${steps}`;
}

/**
 * Creates one posed frame from the untouched rig source, inserted after the
 * active frame (or after `options.after`).
 */
export function bakeSkeletonPose(
  store: DocumentStore,
  source: Grid,
  base: Pose,
  target: Pose,
  options: { readonly after?: number } = {},
): string {
  const grid = deformGridByPose(source, base, target);
  const after = (options.after ?? store.activeFrame) + 1;
  store.transaction("Pose with skeleton", () => {
    const frame = store.addFrame({ at: after });
    store.writeRegion(0, 0, grid, { frame });
  });
  return `Created posed frame ${String(after + 1)} locally with the bone rig. No prompt or model call was used.`;
}

export interface SkeletonTemplateOptions {
  /** A corrected skeleton to rig from, instead of a fresh estimate. */
  readonly base?: Pose;
  /** Which way the character faces. Stock cycles are authored facing east. */
  readonly facing?: "east" | "west";
}

/** Applies a stock pose sequence by deterministic flat-sprite bone deformation. */
export function applySkeletonTemplate(
  store: DocumentStore,
  template: string,
  frameCount: number,
  options: SkeletonTemplateOptions = {},
): string {
  const source = store.readComposite(store.activeFrame);
  const base = options.base ?? estimateSkeleton(source);
  if (base === null) throw new Error("The active frame is empty, so it cannot be rigged.");
  const cycle = animateGridWithSkeleton(source, base, poseTemplate(template), frameCount, {
    facing: options.facing,
  });
  const start = store.activeFrame;
  const first = cycle.frames[0];
  if (first === undefined) throw new Error(`The ${template} template produced no frames.`);

  // The cycle follows its source frame rather than landing at the end of the
  // timeline, so a cycle built from frame 1 of a five-frame asset plays as
  // frames 1-4, not as frame 1 and then frames 6-8.
  store.transaction(`Animate with skeleton: ${template}`, () => {
    store.writeRegion(0, 0, first, { frame: start });
    cycle.frames.slice(1).forEach((grid, index) => {
      const frame = store.addFrame({ at: start + index + 1 });
      store.writeRegion(0, 0, grid, { frame });
    });
  });
  store.selectFrame(start);
  return `Built a ${String(frameCount)}-frame ${template} cycle locally from the skeleton, facing ${options.facing ?? "east"}. No prompt or model call was used.`;
}


/**
 * Remaps an asset into a new palette while preserving its structure.
 */
export function recolorAsset(assetId: string, colors: readonly string[], label: string): string {
  if (!session.recolor(assetId, colors)) {
    throw new Error(`No asset '${assetId}' is open.`);
  }
  return `Recoloured to '${label}' (${String(colors.length)} colours) using perceptual nearest-colour matching. The artwork keeps its shape and transparency. One undo restores the previous palette and pixels.`;
}

/** Rotates every frame by a right angle. Exact: no pixel is resampled. */
export function rotateAsset(assetId: string, degrees: QuarterTurn): string {
  const ok = session.reshape(assetId, (frames) => {
    const rotated = frames.map((grid) => rotateGrid(grid, degrees));
    const first = rotated[0];
    if (first === undefined) {
      throw new Error("This asset has no frames to rotate.");
    }
    return { width: first.width, height: first.height, frames: rotated };
  });

  if (!ok) {
    throw new Error(`No asset '${assetId}' is open.`);
  }
  return `Rotated ${String(degrees)}° — exact, every pixel landed on a pixel. Undo history was reset.`;
}

/** Changes the canvas size without resampling: grows with transparency, shrinks by clipping. */
export function resizeAsset(
  assetId: string,
  width: number,
  height: number,
  anchor: Anchor = "center"
): string {
  const ok = session.reshape(assetId, (frames) => ({
    width,
    height,
    frames: frames.map((grid) => resizeCanvas(grid, width, height, anchor)),
  }));

  if (!ok) {
    throw new Error(`No asset '${assetId}' is open.`);
  }
  return `Resized to ${String(width)}×${String(height)}, anchored ${anchor}. Content was not scaled — growing pads with transparency, shrinking clips. Undo history was reset.`;
}

/** Three countable readability failures, not a quality judgement. */
export function readabilityOf(assetId: string): string {
  const store = session.get(assetId);
  if (store === undefined) {
    throw new Error(`No asset '${assetId}' is open.`);
  }

  const report = checkReadability(store.readComposite());
  if (report.problems.length === 0) {
    return `Reads cleanly at 1×: ${(report.coverage * 100).toFixed(0)}% coverage, ${String(report.colorsUsed)} colours, ${String(report.isolatedPixels)} isolated pixels.`;
  }
  return report.problems.join(" ");
}


/**
 * Turns an uploaded image into one editable asset.
 *
 * Distinct from `buildCharacterFromReference`, which runs the whole
 * concept-to-character chain and produces a direction set. Most of the time
 * someone dragging in a PNG wants exactly one sprite they can draw on — the
 * chain is the special case, not the default.
 */
export function importImageAsAsset(
  reference: RasterImage,
  name: string,
  options: { targetWidth?: number; targetHeight?: number; maxColors?: number; type?: AssetType } = {}
): { id: string; summary: string } {
  const result = pixelize(reference, {
    targetWidth: options.targetWidth,
    targetHeight: options.targetHeight,
    maxColors: options.maxColors,
  });

  const id = session.create({
    name,
    type: options.type ?? "tile",
    preset: "tile-32",
    grid: result.grid,
    // The extracted palette, not a preset's: it is the only palette anyone
    // chose for this image, and remapping it would discard the pipeline's work.
    palette: result.palette,
    width: result.grid.width,
    height: result.grid.height,
  });

  placeInOpenProject(id);

  const notes = result.warnings.length > 0 ? ` ${result.warnings.join(" ")}` : "";
  return {
    id,
    summary: `Imported '${name}' as ${String(result.grid.width)}×${String(result.grid.height)} with ${String(result.palette.length)} colours. Input classified '${result.kind}', detected cell size ${String(result.scale)}.${notes}`,
  };
}
