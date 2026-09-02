import type { Point } from "./types";

/**
 * Viewport maths for the pixel canvas.
 *
 * Zoom is restricted to whole-number scale factors. Fractional zoom resamples
 * the art and is the single most common reason pixel art looks wrong on screen,
 * so it is not representable here rather than merely discouraged.
 *
 * The ladder is finer than powers of two — roughly 1.5x between neighbours
 * instead of 2x — because doubling on every step is a jarring jump mid-edit.
 * Every entry is still an integer, so pixels stay crisp at each stop.
 */

export const ZOOM_LEVELS = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32] as const;

/**
 * Accumulated wheel delta needed to move one zoom step.
 *
 * A trackpad pinch or two-finger swipe emits many small wheel events per
 * gesture; stepping on each one rockets through the whole range. A mouse wheel
 * notch is ~100, so it still steps once per click.
 */
export const ZOOM_WHEEL_THRESHOLD = 60;

export type ZoomLevel = (typeof ZOOM_LEVELS)[number];

/** Above this zoom the 1px grid overlay is legible; below it the lines outweigh the art. */
export const GRID_OVERLAY_MIN_ZOOM = 8;

export interface Viewport {
  /** Art-space coordinate rendered at the viewport's top-left corner. */
  readonly originX: number;
  readonly originY: number;
  readonly zoom: ZoomLevel;
}

export const INITIAL_VIEWPORT: Viewport = { originX: 0, originY: 0, zoom: 8 };

function clampZoomIndex(index: number): number {
  return Math.min(Math.max(index, 0), ZOOM_LEVELS.length - 1);
}

export function nextZoom(zoom: ZoomLevel, direction: 1 | -1): ZoomLevel {
  const index = ZOOM_LEVELS.indexOf(zoom);
  return ZOOM_LEVELS[clampZoomIndex(index + direction)] as ZoomLevel;
}

/** Screen (canvas element) coordinates → art-space pixel coordinates. */
export function screenToArt(
  viewport: Viewport,
  screenX: number,
  screenY: number
): Point {
  return {
    x: Math.floor(screenX / viewport.zoom + viewport.originX),
    y: Math.floor(screenY / viewport.zoom + viewport.originY),
  };
}

/** Art-space pixel coordinates → screen coordinates of that pixel's top-left. */
export function artToScreen(
  viewport: Viewport,
  artX: number,
  artY: number
): Point {
  return {
    x: (artX - viewport.originX) * viewport.zoom,
    y: (artY - viewport.originY) * viewport.zoom,
  };
}

/**
 * Zoom one step while holding the art pixel under the cursor in place — the
 * behaviour that makes zooming feel like the canvas rather than the window moved.
 */
export function zoomAtPoint(
  viewport: Viewport,
  direction: 1 | -1,
  screenX: number,
  screenY: number
): Viewport {
  const zoom = nextZoom(viewport.zoom, direction);
  if (zoom === viewport.zoom) {
    return viewport;
  }

  // Solve for the origin that keeps the pre-zoom art point at the same screen
  // position: screen/zoom + origin must stay constant.
  return {
    zoom,
    originX: viewport.originX + screenX / viewport.zoom - screenX / zoom,
    originY: viewport.originY + screenY / viewport.zoom - screenY / zoom,
  };
}

export function pan(viewport: Viewport, dxScreen: number, dyScreen: number): Viewport {
  return {
    ...viewport,
    originX: viewport.originX - dxScreen / viewport.zoom,
    originY: viewport.originY - dyScreen / viewport.zoom,
  };
}

/** Largest integer zoom at which the whole document fits, then centre it. */
export function fitToViewport(
  documentWidth: number,
  documentHeight: number,
  viewportWidth: number,
  viewportHeight: number,
  padding = 32
): Viewport {
  const availableWidth = Math.max(viewportWidth - padding * 2, 1);
  const availableHeight = Math.max(viewportHeight - padding * 2, 1);

  let zoom: ZoomLevel = ZOOM_LEVELS[0] as ZoomLevel;
  for (const level of ZOOM_LEVELS) {
    if (documentWidth * level <= availableWidth && documentHeight * level <= availableHeight) {
      zoom = level;
    }
  }

  return {
    zoom,
    originX: (documentWidth - viewportWidth / zoom) / 2,
    originY: (documentHeight - viewportHeight / zoom) / 2,
  };
}
