"use client";

import { pixelize, type PixelizeOptions, type PixelizeResult } from "./pipeline";
import type { RasterImage } from "./types";
import type { PixelizeRequest, PixelizeResponse } from "./worker";

/**
 * Runs the pipeline off the main thread, falling back to running it inline.
 *
 * The fallback matters: workers are unavailable in some embedded browsers, and
 * a blocked frame is a far better outcome than a feature that silently does
 * nothing. Callers get the same promise either way.
 */

let worker: Worker | null = null;
let nextId = 1;
let unavailable = false;

const pending = new Map<
  number,
  { resolve: (result: PixelizeResult) => void; reject: (error: Error) => void }
>();

function ensureWorker(): Worker | null {
  if (unavailable) {
    return null;
  }
  if (worker !== null) {
    return worker;
  }

  try {
    worker = new Worker(new URL("./worker-entry.ts", import.meta.url), { type: "module" });
    worker.addEventListener("message", (event: MessageEvent<PixelizeResponse>) => {
      const entry = pending.get(event.data.id);
      if (entry === undefined) {
        return;
      }
      pending.delete(event.data.id);
      if (event.data.ok) {
        entry.resolve(event.data.result);
      } else {
        entry.reject(new Error(event.data.error));
      }
    });
    worker.addEventListener("error", () => {
      // Reject everything in flight and never try the worker again — retrying a
      // worker that failed to load just stalls every future call.
      unavailable = true;
      worker = null;
      for (const entry of pending.values()) {
        entry.reject(new Error("The pixelisation worker failed to start."));
      }
      pending.clear();
    });
    return worker;
  } catch {
    unavailable = true;
    return null;
  }
}

export async function pixelizeAsync(
  image: RasterImage,
  options: PixelizeOptions = {}
): Promise<PixelizeResult> {
  const active = ensureWorker();
  if (active === null) {
    return pixelize(image, options);
  }

  const id = nextId;
  nextId += 1;

  return await new Promise<PixelizeResult>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    const request: PixelizeRequest = { id, image, options };
    active.postMessage(request);
  });
}
