"use client";

import { useEffect, useRef } from "react";
import { paletteHexes, type DocumentStore } from "@zenith/core";
import { gridToImageData, useStoreSelector } from "@/lib/pixel";

/**
 * The asset repeated 3x3, live.
 *
 * Seams in a tile are invisible on a single canvas and obvious the moment it
 * repeats, so this sits beside the editor rather than behind a check. Drawing
 * *across* the seam — Tiled Mode — is phase 11; this only surfaces the problem.
 */

const selectComposite = (store: DocumentStore) => store.readComposite();
const selectPalette = (store: DocumentStore) => paletteHexes(store.palette);

export function TilePreview({ store, size = 96 }: { store: DocumentStore; size?: number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const grid = useStoreSelector(store, selectComposite);
  const palette = useStoreSelector(store, selectPalette);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) {
      return;
    }
    const context = canvas.getContext("2d");
    if (context === null) {
      return;
    }

    // Rasterise once at 1x, then blit the same bitmap nine times.
    const imageData = gridToImageData(grid, palette, 1);
    const tile = document.createElement("canvas");
    tile.width = grid.width;
    tile.height = grid.height;
    tile.getContext("2d")?.putImageData(imageData, 0, 0);

    const cell = Math.max(1, Math.floor(size / 3));
    canvas.width = cell * 3;
    canvas.height = cell * 3;
    context.imageSmoothingEnabled = false;
    context.clearRect(0, 0, canvas.width, canvas.height);

    for (let y = 0; y < 3; y += 1) {
      for (let x = 0; x < 3; x += 1) {
        context.drawImage(tile, x * cell, y * cell, cell, cell);
      }
    }
  }, [grid, palette, size]);

  return (
    <canvas
      aria-label="Tiling preview, three by three"
      className="border border-border"
      ref={canvasRef}
      style={{ width: size, height: size, imageRendering: "pixelated" }}
    />
  );
}
