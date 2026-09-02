/**
 * Decoding a generated PNG into the byte array the pixelisation pipeline takes.
 *
 * Browser-only, and deliberately the single place that is: the pipeline itself
 * is pure TypeScript over `Uint8ClampedArray` so it can run in a worker and be
 * tested headlessly. Keeping the decode here is what preserves that.
 */

import type { RasterImage } from "@/lib/pixelize";
import { ToolError } from "./types";

/** Guards against a model returning something enormous. 4096² RGBA is 64MB. */
const MAX_DIMENSION = 4096;

export async function decodeBase64Png(base64: string): Promise<RasterImage> {
  if (typeof createImageBitmap !== "function" || typeof OffscreenCanvas !== "function") {
    throw new ToolError("Image decoding needs a browser; this tool cannot run server-side.");
  }

  let bitmap: ImageBitmap;
  try {
    const response = await fetch(`data:image/png;base64,${base64}`);
    bitmap = await createImageBitmap(await response.blob());
  } catch (error) {
    throw new ToolError(
      `The generated image could not be decoded: ${error instanceof Error ? error.message : String(error)}.`,
    );
  }

  if (bitmap.width > MAX_DIMENSION || bitmap.height > MAX_DIMENSION) {
    bitmap.close();
    throw new ToolError(
      `The generated image is ${String(bitmap.width)}x${String(bitmap.height)}, over the ${String(MAX_DIMENSION)}px limit.`,
    );
  }

  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext("2d");
  if (context === null) {
    bitmap.close();
    throw new ToolError("Could not acquire a 2D context to decode the generated image.");
  }
  context.drawImage(bitmap, 0, 0);
  const { data, width, height } = context.getImageData(0, 0, bitmap.width, bitmap.height);
  bitmap.close();

  return { width, height, data };
}
