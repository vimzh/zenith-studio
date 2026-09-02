/**
 * Pixelisation in a Web Worker.
 *
 * Grid detection walks the image several times over a few dozen candidate
 * grids. On a large upload that is long enough to drop frames, and the canvas
 * has a 16ms budget — so the work moves off the main thread. The pipeline has
 * no DOM dependency, which is what makes this possible at all.
 */

import { pixelize, type PixelizeOptions, type PixelizeResult } from "./pipeline";
import type { RasterImage } from "./types";

/**
 * The slice of `DedicatedWorkerGlobalScope` this module uses.
 *
 * Declared locally rather than pulling the `webworker` lib into tsconfig: that
 * library redefines `self`, `postMessage` and friends globally and conflicts
 * with the DOM lib the rest of the app relies on.
 */
export interface WorkerScope {
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<PixelizeRequest>) => void
  ): void;
  postMessage(message: PixelizeResponse): void;
}

export interface PixelizeRequest {
  readonly id: number;
  readonly image: RasterImage;
  readonly options: PixelizeOptions;
}

export type PixelizeResponse =
  | { readonly id: number; readonly ok: true; readonly result: PixelizeResult }
  | { readonly id: number; readonly ok: false; readonly error: string };

/** Registers the worker handler. Called by the worker entry module. */
export function installWorker(scope: WorkerScope): void {
  scope.addEventListener("message", (event: MessageEvent<PixelizeRequest>) => {
    const { id, image, options } = event.data;
    try {
      const result = pixelize(image, options);
      const response: PixelizeResponse = { id, ok: true, result };
      scope.postMessage(response);
    } catch (error) {
      const response: PixelizeResponse = {
        id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
      scope.postMessage(response);
    }
  });
}
