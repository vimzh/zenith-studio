"use client";

import type { RasterImage } from "@/lib/pixelize";

/**
 * The one browser-only step of the pipeline: decoding a file into pixels.
 *
 * Isolated here so everything downstream stays headless-testable — the whole
 * pixelisation pipeline runs in `bun test` precisely because it never touches
 * an Image or a canvas.
 */
export async function imageToRaster(file: File): Promise<RasterImage> {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;

    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (context === null) {
      throw new Error("Could not acquire a 2D context to read the image.");
    }

    context.imageSmoothingEnabled = false;
    context.drawImage(bitmap, 0, 0);
    const data = context.getImageData(0, 0, bitmap.width, bitmap.height);
    return { width: data.width, height: data.height, data: data.data };
  } finally {
    bitmap.close();
  }
}
