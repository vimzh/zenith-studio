/**
 * The channel between the tool layer and the canvas viewport.
 *
 * The viewport is `useState` inside the editor's controller, so a tool can
 * neither read nor move it directly — tool handlers run outside the render tree.
 * The editor reports its viewport here; `focus_viewport` raises a request the
 * editor consumes.
 *
 * Same direction of control as `navigation.ts`, and for the same reason: the
 * component owns the state, the tool asks explicitly, and nothing infers.
 *
 * If the editor is not wired to this channel, both tools say so rather than
 * reporting a success that moved nothing. A tool that lies about what it did is
 * worse than a tool that is missing.
 */

import { ZOOM_LEVELS, type Region, type ZoomLevel } from "@/lib/pixel";

/** What the editor reports: its viewport, plus the canvas size it is drawn into. */
export interface ViewportSnapshot {
  /** Art-space coordinate at the canvas's top-left corner. */
  readonly originX: number;
  readonly originY: number;
  readonly zoom: number;
  /** Canvas element size in screen pixels. */
  readonly viewWidth: number;
  readonly viewHeight: number;
}

/** Assignable straight to the editor's `Viewport`, zoom included. */
export interface ViewportPlacement {
  readonly originX: number;
  readonly originY: number;
  readonly zoom: ZoomLevel;
}

/** The part of the asset currently on screen, in asset-local pixels, clamped to the asset. */
export function visibleRegion(
  snapshot: ViewportSnapshot,
  assetWidth: number,
  assetHeight: number,
): Region {
  const x = Math.max(0, Math.floor(snapshot.originX));
  const y = Math.max(0, Math.floor(snapshot.originY));
  const right = Math.min(assetWidth, Math.ceil(snapshot.originX + snapshot.viewWidth / snapshot.zoom));
  const bottom = Math.min(assetHeight, Math.ceil(snapshot.originY + snapshot.viewHeight / snapshot.zoom));
  return { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) };
}

/**
 * The viewport that frames `region`, at the largest integer zoom that fits it.
 *
 * Integer zoom only — a fractional step to make a region fit exactly would
 * resample the art, which is the one thing this pipeline never does.
 */
export function viewportForRegion(
  region: Region,
  viewWidth: number,
  viewHeight: number,
  padding = 16,
): ViewportPlacement {
  const availableWidth = Math.max(viewWidth - padding * 2, 1);
  const availableHeight = Math.max(viewHeight - padding * 2, 1);

  let zoom = ZOOM_LEVELS[0] as ZoomLevel;
  for (const level of ZOOM_LEVELS) {
    if (region.width * level <= availableWidth && region.height * level <= availableHeight) {
      zoom = level;
    }
  }

  // Centre the region rather than aligning it, so the agent's "look here" puts
  // the subject in the middle of the human's view.
  return {
    zoom,
    originX: region.x + region.width / 2 - viewWidth / (2 * zoom),
    originY: region.y + region.height / 2 - viewHeight / (2 * zoom),
  };
}

class ViewportChannel {
  #snapshot: ViewportSnapshot | null = null;
  #request: Region | null = null;
  readonly #listeners = new Set<() => void>();

  /** True once the editor is wired to this channel. */
  get connected(): boolean {
    return this.#listeners.size > 0;
  }

  report(snapshot: ViewportSnapshot): void {
    this.#snapshot = snapshot;
  }

  peekSnapshot(): ViewportSnapshot | null {
    return this.#snapshot;
  }

  /** Asks the editor to bring a region of the asset into view. */
  request(region: Region): void {
    this.#request = region;
    this.#notify();
  }

  peekRequest(): Region | null {
    return this.#request;
  }

  clearRequest(): void {
    this.#request = null;
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /** Test seam. The editor's unmount already clears the listener. */
  reset(): void {
    this.#snapshot = null;
    this.#request = null;
  }

  #notify(): void {
    for (const listener of this.#listeners) listener();
  }
}

export const viewportChannel = new ViewportChannel();
