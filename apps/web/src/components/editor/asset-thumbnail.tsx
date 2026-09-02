"use client";

import { useEffect, useRef } from "react";
import { paletteHexes, type DocumentStore } from "@zenith/core";
import { gridToImageData, useStoreSelector } from "@/lib/pixel";
import { CHECKER_DARK, CHECKER_LIGHT } from "@/lib/pixel";

/**
 * A small preview of an asset, for library cards.
 *
 * Rasterises at 1x and scales with `drawImage` at an integer factor — a card is
 * still pixel art, and a bilinear thumbnail of a sprite looks wrong in a way
 * this audience notices immediately.
 */

const selectComposite = (store: DocumentStore) => store.readComposite();
const selectPalette = (store: DocumentStore) => paletteHexes(store.palette);

export function AssetThumbnail({ store, size = 96 }: { store: DocumentStore; size?: number }) {
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

    // Largest integer scale that fits, so the preview never resamples.
    const scale = Math.max(1, Math.floor(size / Math.max(grid.width, grid.height)));
    const width = grid.width * scale;
    const height = grid.height * scale;

    canvas.width = width;
    canvas.height = height;
    context.imageSmoothingEnabled = false;

    const checker = Math.max(4, scale * 4);
    for (let y = 0; y < height; y += checker) {
      for (let x = 0; x < width; x += checker) {
        const isLight = ((x / checker) | 0) % 2 === ((y / checker) | 0) % 2;
        context.fillStyle = isLight ? CHECKER_LIGHT : CHECKER_DARK;
        context.fillRect(x, y, checker, checker);
      }
    }

    const source = document.createElement("canvas");
    source.width = grid.width;
    source.height = grid.height;
    source.getContext("2d")?.putImageData(gridToImageData(grid, palette, 1), 0, 0);
    context.drawImage(source, 0, 0, width, height);
  }, [grid, palette, size]);

  return <canvas className="block" ref={canvasRef} style={{ imageRendering: "pixelated" }} />;
}
