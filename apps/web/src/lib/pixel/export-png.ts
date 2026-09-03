import { TRANSPARENT, type Grid } from "@zenith/core";
import { downloadBlob } from "@/lib/download";
import { requireIntegerScale } from "./scale";

/**
 * PNG export.
 *
 * Scaling is nearest-neighbour at integer factors only, written by repeating
 * cells into the pixel buffer directly. Going through `drawImage` would invite
 * the browser's smoothing and is exactly the blur this whole pipeline avoids.
 */

function hexToRgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/** Render a grid into RGBA bytes at `scale`. Every pixel ends fully opaque or fully transparent. */
export function gridToImageData(
  grid: Grid,
  palette: readonly string[],
  scale = 1
): ImageData {
  requireIntegerScale(scale);

  const width = grid.width * scale;
  const height = grid.height * scale;
  const bytes = new Uint8ClampedArray(width * height * 4);
  const rgb = palette.map(hexToRgb);

  for (let y = 0; y < grid.height; y += 1) {
    for (let x = 0; x < grid.width; x += 1) {
      const cell = grid.cells[y * grid.width + x] ?? TRANSPARENT;
      if (cell === TRANSPARENT) {
        continue;
      }
      const color = rgb[cell];
      if (!color) {
        continue;
      }

      for (let dy = 0; dy < scale; dy += 1) {
        for (let dx = 0; dx < scale; dx += 1) {
          const offset = ((y * scale + dy) * width + (x * scale + dx)) * 4;
          bytes[offset] = color[0];
          bytes[offset + 1] = color[1];
          bytes[offset + 2] = color[2];
          bytes[offset + 3] = 255;
        }
      }
    }
  }

  return new ImageData(bytes, width, height);
}

export async function gridToPngBlob(
  grid: Grid,
  palette: readonly string[],
  scale = 1
): Promise<Blob> {
  const imageData = gridToImageData(grid, palette, scale);
  const canvas = document.createElement("canvas");
  canvas.width = imageData.width;
  canvas.height = imageData.height;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Could not acquire a 2D context for PNG export.");
  }
  context.putImageData(imageData, 0, 0);

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error("Canvas produced no PNG blob."));
      }
    }, "image/png");
  });
}

export async function downloadPng(
  grid: Grid,
  palette: readonly string[],
  filename: string,
  scale = 1
): Promise<void> {
  const blob = await gridToPngBlob(grid, palette, scale);
  downloadBlob(blob, filename.endsWith(".png") ? filename : `${filename}.png`);
}
