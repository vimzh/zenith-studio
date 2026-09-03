import { GRID_OVERLAY_MIN_ZOOM, artToScreen, type Viewport } from "./viewport";
import { TRANSPARENT, peekCell, type Grid } from "@zenith/core";
import { ALL_BONES } from "@/lib/skeleton/model";
import type { Selection } from "./types";

/**
 * Canvas rendering for the pixel editor.
 *
 * Everything here draws whole pixels at integer offsets. `imageSmoothingEnabled`
 * is never turned on, and no path is ever stroked at a fractional coordinate —
 * either would reintroduce the anti-aliasing the document model exists to
 * prevent.
 *
 * Reads go through `peekCell` rather than `getCell`: these loops already iterate
 * in bounds, and per-read validation is measurable at 4096 cells a repaint. See
 * the note on both functions in `@zenith/core`.
 */

/** Transparency checker. Cell size is in ART pixels, so it scales with zoom and doubles as a size reference. */
export const CHECKER_CELL_ART_PIXELS = 8;
export const CHECKER_LIGHT = "#8a8a8a";
export const CHECKER_DARK = "#6e6e6e";
export const GRID_LINE = "rgba(0, 0, 0, 0.28)";
/** Marks where the asset ends. The checker covers only the document, so without this the bounds are ambiguous against the void. */
export const DOCUMENT_BORDER = "rgba(255, 255, 255, 0.22)";

export interface RenderOptions {
  readonly showGrid?: boolean;
  /** Frames ghosted behind the current one, drawn before it. */
  readonly onionSkin?: readonly { grid: Grid; opacity: number }[];
  /** Skeleton joints in art coordinates, drawn over everything. */
  readonly skeleton?: readonly { x: number; y: number; joint: string }[];
  /** The joint under the pointer or being dragged: drawn larger, with its name. */
  readonly skeletonHighlight?: string | null;
  /** Marquee around the active selection. */
  readonly selection?: Selection | null;
  readonly checkerLight?: string;
  readonly checkerDark?: string;
}

/** Draw the two-tone transparency checker across the document's extent. */
export function drawChecker(
  context: CanvasRenderingContext2D,
  grid: Grid,
  viewport: Viewport,
  options: RenderOptions = {}
): void {
  const light = options.checkerLight ?? CHECKER_LIGHT;
  const dark = options.checkerDark ?? CHECKER_DARK;
  const size = CHECKER_CELL_ART_PIXELS;

  for (let y = 0; y < grid.height; y += size) {
    for (let x = 0; x < grid.width; x += size) {
      const isLight = ((x / size) | 0) % 2 === ((y / size) | 0) % 2;
      context.fillStyle = isLight ? light : dark;

      const origin = artToScreen(viewport, x, y);
      const width = Math.min(size, grid.width - x) * viewport.zoom;
      const height = Math.min(size, grid.height - y) * viewport.zoom;
      context.fillRect(Math.round(origin.x), Math.round(origin.y), width, height);
    }
  }
}

/**
 * Draw the grid's cells.
 *
 * Runs of identical cells on a row are coalesced into one `fillRect`. A 64×64
 * document is 4096 cells and pixel art is mostly flat regions, so this typically
 * cuts the draw-call count by an order of magnitude.
 */
export function drawCells(
  context: CanvasRenderingContext2D,
  grid: Grid,
  palette: readonly string[],
  viewport: Viewport
): void {
  const { zoom } = viewport;

  for (let y = 0; y < grid.height; y += 1) {
    let runStart = 0;
    let runCell = peekCell(grid, 0, y);

    for (let x = 1; x <= grid.width; x += 1) {
      const cell = x < grid.width ? peekCell(grid, x, y) : Number.NaN;
      if (cell === runCell) {
        continue;
      }

      if (runCell !== TRANSPARENT) {
        const color = palette[runCell];
        if (color) {
          context.fillStyle = color;
          const origin = artToScreen(viewport, runStart, y);
          context.fillRect(
            Math.round(origin.x),
            Math.round(origin.y),
            (x - runStart) * zoom,
            zoom
          );
        }
      }

      runStart = x;
      runCell = cell;
    }
  }
}

/** 1px lattice, drawn on half-pixel offsets so lines land crisp rather than blurred across two device pixels. */
export function drawGridOverlay(
  context: CanvasRenderingContext2D,
  grid: Grid,
  viewport: Viewport
): void {
  if (viewport.zoom < GRID_OVERLAY_MIN_ZOOM) {
    return;
  }

  context.save();
  context.strokeStyle = GRID_LINE;
  context.lineWidth = 1;
  context.beginPath();

  const start = artToScreen(viewport, 0, 0);
  const end = artToScreen(viewport, grid.width, grid.height);

  for (let x = 0; x <= grid.width; x += 1) {
    const screenX = Math.round(artToScreen(viewport, x, 0).x) + 0.5;
    context.moveTo(screenX, start.y);
    context.lineTo(screenX, end.y);
  }
  for (let y = 0; y <= grid.height; y += 1) {
    const screenY = Math.round(artToScreen(viewport, 0, y).y) + 0.5;
    context.moveTo(start.x, screenY);
    context.lineTo(end.x, screenY);
  }

  context.stroke();
  context.restore();
}

/** 1px outline around the document's extent, on half-pixel offsets so it lands crisp. */
export function drawDocumentBorder(
  context: CanvasRenderingContext2D,
  grid: Grid,
  viewport: Viewport
): void {
  const start = artToScreen(viewport, 0, 0);
  const end = artToScreen(viewport, grid.width, grid.height);

  context.save();
  context.strokeStyle = DOCUMENT_BORDER;
  context.lineWidth = 1;
  context.strokeRect(
    Math.round(start.x) + 0.5,
    Math.round(start.y) + 0.5,
    Math.round(end.x - start.x) - 1,
    Math.round(end.y - start.y) - 1
  );
  context.restore();
}

export function renderDocument(
  context: CanvasRenderingContext2D,
  grid: Grid,
  palette: readonly string[],
  viewport: Viewport,
  options: RenderOptions = {}
): void {
  context.imageSmoothingEnabled = false;
  drawChecker(context, grid, viewport, options);

  // Ghosts first, so the frame being edited draws over them and stays readable.
  for (const skin of options.onionSkin ?? []) {
    context.save();
    context.globalAlpha = skin.opacity;
    drawCells(context, skin.grid, palette, viewport);
    context.restore();
  }

  drawCells(context, grid, palette, viewport);
  if (options.showGrid !== false) {
    drawGridOverlay(context, grid, viewport);
  }
  drawDocumentBorder(context, grid, viewport);

  if (options.selection != null) {
    drawSelection(context, options.selection, viewport);
  }

  if (options.skeleton !== undefined && options.skeleton.length > 0) {
    drawSkeleton(context, options.skeleton, viewport, options.skeletonHighlight ?? null);
  }
}

/**
 * Marching-ants marquee.
 *
 * Drawn as a dashed light line over a solid dark one so the edge stays visible
 * against both a dark sprite and a light one — a single-colour marquee
 * disappears against whichever tone it happens to match.
 */
function drawSelection(
  context: CanvasRenderingContext2D,
  selection: Selection,
  viewport: Viewport
): void {
  const origin = artToScreen(viewport, selection.x, selection.y);
  const x = Math.round(origin.x) + 0.5;
  const y = Math.round(origin.y) + 0.5;
  const width = selection.width * viewport.zoom - 1;
  const height = selection.height * viewport.zoom - 1;

  context.save();
  context.lineWidth = 1;
  context.setLineDash([]);
  context.strokeStyle = "rgba(0, 0, 0, 0.8)";
  context.strokeRect(x, y, width, height);
  context.setLineDash([4, 4]);
  context.strokeStyle = "rgba(255, 255, 255, 0.95)";
  context.strokeRect(x, y, width, height);
  context.restore();
}

/** Left-side joints, right-side joints and the spine each get their own tint, so a crossed leg still reads. */
function jointColour(name: string): string {
  if (name.endsWith("-l")) return "rgba(255, 214, 64, 0.9)";
  if (name.endsWith("-r")) return "rgba(64, 214, 255, 0.9)";
  return "rgba(255, 255, 255, 0.9)";
}

/**
 * Joint markers over the artwork.
 *
 * Drawn as circles at the pixel's centre rather than filled cells: a joint is a
 * position, not a pixel, and drawing it as a pixel would imply it belongs to the
 * art. Scaled with zoom so it stays visible without swamping the sprite. Bones
 * take the colour of their child joint, so each limb is one colour end to end.
 */
function drawSkeleton(
  context: CanvasRenderingContext2D,
  joints: readonly { x: number; y: number; joint: string }[],
  viewport: Viewport,
  highlight: string | null
): void {
  const radius = Math.max(2, Math.min(6, viewport.zoom / 3));
  const byName = new Map(joints.map((joint) => [joint.joint, joint]));
  const centre = (joint: { x: number; y: number }) => {
    const origin = artToScreen(viewport, joint.x, joint.y);
    return { x: origin.x + viewport.zoom / 2, y: origin.y + viewport.zoom / 2 };
  };

  context.save();
  context.lineWidth = Math.max(1, Math.min(3, viewport.zoom / 5));
  for (const [fromName, toName] of ALL_BONES) {
    const from = byName.get(fromName);
    const to = byName.get(toName);
    if (from === undefined || to === undefined) continue;
    const start = centre(from);
    const end = centre(to);
    context.beginPath();
    context.moveTo(start.x, start.y);
    context.lineTo(end.x, end.y);
    context.strokeStyle = jointColour(toName).replace("0.9)", "0.75)");
    context.stroke();
  }

  for (const joint of joints) {
    const at = centre(joint);
    const active = joint.joint === highlight;
    context.beginPath();
    context.arc(at.x, at.y, active ? radius + 2 : radius, 0, Math.PI * 2);
    context.fillStyle = jointColour(joint.joint);
    context.fill();
    context.lineWidth = active ? 2 : 1;
    context.strokeStyle = "rgba(0, 0, 0, 0.75)";
    context.stroke();
  }

  const named = highlight === null ? undefined : byName.get(highlight);
  if (named !== undefined) {
    const at = centre(named);
    const label = named.joint;
    context.font = "11px ui-monospace, monospace";
    const width = context.measureText(label).width + 8;
    const x = Math.round(at.x + radius + 6);
    const y = Math.round(at.y - 9);
    context.fillStyle = "rgba(0, 0, 0, 0.8)";
    context.fillRect(x, y, width, 16);
    context.fillStyle = "rgba(255, 255, 255, 0.95)";
    context.fillText(label, x + 4, y + 12);
  }
  context.restore();
}
