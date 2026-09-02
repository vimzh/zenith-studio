/** Source-aware selected-region image editing with pixel-exact local merging. */

import {
  MAX_PALETTE_SIZE,
  TRANSPARENT,
  createGrid,
  cropGrid,
  normalizeRegion,
  type DocumentStore,
  type Grid,
  type Region,
} from "@zenith/core";
import { session } from "@/lib/editor";
import { encodeIndexedPng } from "@/lib/export";
import { pixelizeAsync } from "@/lib/pixelize";
import { deriveImage } from "../api";
import { readInteger, readString } from "../args";
import { decodeBase64Png } from "../raster";
import { ToolError, type ToolDefinition } from "../types";
import { requireActiveAsset, toToolError } from "./active";
import { conformToPalette, mergePalette, usedPaletteIndices } from "./generation";

/**
 * The colours the model actually put inside the mask.
 *
 * The pixelised result covers the whole canvas, and most of it is the source
 * the model was told to leave alone. Merging its full palette would spend every
 * spare slot re-adding colours the asset already has.
 */
export function regionColors(
  grid: Grid,
  palette: readonly string[],
  region: Region,
): readonly string[] {
  const bounds = normalizeRegion(grid, region);
  const seen = new Set<string>();
  for (let y = bounds.y; y < bounds.y + bounds.height; y += 1) {
    for (let x = bounds.x; x < bounds.x + bounds.width; x += 1) {
      const cell = grid.cells[y * grid.width + x] as number;
      const hex = cell === TRANSPARENT ? undefined : palette[cell];
      if (hex !== undefined) seen.add(hex);
    }
  }
  return [...seen];
}

export function createInpaintMask(grid: Grid, region: Region): Grid {
  const bounds = normalizeRegion(grid, region);
  const mask = createGrid(grid.width, grid.height, 0);
  for (let y = bounds.y; y < bounds.y + bounds.height; y += 1) {
    mask.cells.fill(
      TRANSPARENT,
      y * mask.width + bounds.x,
      y * mask.width + bounds.x + bounds.width,
    );
  }
  return mask;
}

export function encodeInpaintInputs(
  grid: Grid,
  palette: readonly string[],
  region: Region,
): {
  readonly source: Uint8Array;
  readonly mask: Uint8Array;
  readonly region: Region;
} {
  const bounds = normalizeRegion(grid, region);
  const scale = Math.max(1, Math.floor(1024 / Math.max(grid.width, grid.height)));
  return {
    source: encodeIndexedPng(grid, palette, { scale }),
    mask: encodeIndexedPng(createInpaintMask(grid, bounds), ["#ffffff"], {
      scale,
    }),
    region: bounds,
  };
}

export function applyInpaintRegion(
  store: DocumentStore,
  generated: Grid,
  region: Region,
): number {
  if (generated.width !== store.width || generated.height !== store.height) {
    throw new ToolError(
      `The inpaint resolved to ${String(generated.width)}x${String(generated.height)}, not the asset's ${String(store.width)}x${String(store.height)} grid. The asset was not changed.`,
    );
  }
  const bounds = normalizeRegion(generated, region);
  return store.transaction("inpaint_region", () =>
    store.writeRegion(bounds.x, bounds.y, cropGrid(generated, bounds)),
  );
}

/**
 * What the model is told about colour.
 *
 * This used to read "use only this exact existing palette", and it is why red
 * cherries came back orange: the asset's palette held no red, so the model
 * picked the nearest thing it was allowed — and the conformance step would have
 * done the same to any red that survived. Both halves had to change. The
 * palette is now the house style to match, with an explicit budget for colours
 * the edit genuinely needs, and `mergePalette` finds room for them afterwards.
 *
 * `room` is how many new colours the asset can actually take. At zero the old
 * wording is exactly right and comes back, because promising a colour the
 * document cannot hold would produce art that is silently remapped anyway.
 */
export function inpaintInstruction(
  prompt: string,
  palette: readonly string[],
  room = 0,
): string {
  if (room <= 0) {
    return `${prompt}. Use only this exact existing palette in the finished edit: ${palette.join(", ")}.`;
  }
  return (
    `${prompt}. Match this existing palette for everything the edit touches: ${palette.join(", ")}. ` +
    `Where the edit genuinely needs a colour this palette does not contain — a red berry on a green bush — ` +
    `use the correct colour rather than the nearest listed one, and introduce at most ${String(room)} such colours.`
  );
}

export const inpaintRegion: ToolDefinition = {
  network: true,
  name: "inpaint_region",
  description:
    "Edit only a selected rectangle of the currently open asset using the original image as context. Coordinates are asset-local: (0,0) is the top-left pixel, x increases right, and y increases down. The model sees the full source but may edit only the transparent mask rectangle; its result is pixelised and palette-matched before only that grid region is merged. Pixels outside the rectangle remain byte-identical, and one undo restores the whole edit. This makes one slow, paid image-model call.",
  inputSchema: {
    type: "object",
    properties: {
      x: {
        type: "integer",
        minimum: 0,
        description: "Left edge in asset pixels.",
      },
      y: {
        type: "integer",
        minimum: 0,
        description: "Top edge in asset pixels.",
      },
      width: {
        type: "integer",
        minimum: 1,
        description: "Editable width in asset pixels.",
      },
      height: {
        type: "integer",
        minimum: 1,
        description: "Editable height in asset pixels.",
      },
      prompt: {
        type: "string",
        description:
          "What to change inside the rectangle, such as 'replace the helmet with a red hood'.",
      },
    },
    required: ["x", "y", "width", "height", "prompt"],
  },
  example: {
    x: 8,
    y: 2,
    width: 16,
    height: 12,
    prompt: "replace the helmet with a red hood",
  },
  execute: async (args) => {
    const { id, type, store } = requireActiveAsset();
    const requested = {
      x: readInteger(args, "x", 0),
      y: readInteger(args, "y", 0),
      width: readInteger(args, "width", 1),
      height: readInteger(args, "height", 1),
    };
    const prompt = readString(args, "prompt");
    const grid = store.readComposite();
    const palette = store.palette.colors.map((colour) => colour.hex);

    let inputs;
    try {
      inputs = encodeInpaintInputs(grid, palette, requested);
    } catch (error) {
      throw toToolError(error);
    }
    const kind =
      (type === "tile" || type === "texture") && !grid.cells.includes(TRANSPARENT)
        ? "texture"
        : "sprite";
    // Room is counted in *live* colours, not slots: an asset using seven of
    // sixteen has nine to spend, which is the difference between a red cherry
    // and a brown one.
    const used = usedPaletteIndices(store);
    const generated = await deriveImage(
      inputs.source,
      inpaintInstruction(prompt, palette, MAX_PALETTE_SIZE - used.size),
      kind,
      "inpaint",
      inputs.mask,
    );
    const raster = await decodeBase64Png(generated.image);

    let result;
    try {
      result = await pixelizeAsync(raster, {
        targetWidth: store.width,
        maxColors: 16,
      });
    } catch (error) {
      throw toToolError(error);
    }
    if (result.palette.length === 0) {
      throw new ToolError(
        "The inpaint contained no opaque pixels. The asset was not changed.",
      );
    }
    if (result.confidence < 0.5) {
      throw new ToolError(
        `Grid recovery confidence was only ${result.confidence.toFixed(2)}. The asset was not changed; retry with a more specific prompt.`,
      );
    }
    // Only the colours inside the edited rectangle matter here; the rest of the
    // image the model returned is context it was told not to change, and
    // spending palette slots on it would fill the palette with what is already
    // there.
    const merge = mergePalette(palette, regionColors(result.grid, result.palette, inputs.region), used);
    if (merge.added.length > 0) session.recolor(id, [...merge.colors]);
    // Rebuilding the document to widen the palette replaces the store, so the
    // write has to go through the current one.
    const target = session.get(id) ?? store;

    const changed = applyInpaintRegion(
      target,
      conformToPalette(result.grid, result.palette, merge.colors),
      inputs.region,
    );
    const grew =
      merge.added.length === 0
        ? ""
        : ` Added ${merge.added.join(", ")} to the palette (now ${String(merge.colors.length)} colours), which reset this asset's pixel history.`;
    const lost =
      merge.unmatched.length === 0
        ? ""
        : ` The palette is full, so ${merge.unmatched.join(", ")} were matched to their nearest existing shade.`;
    return `Inpainted (${String(inputs.region.x)}, ${String(inputs.region.y)}) ${String(inputs.region.width)}x${String(inputs.region.height)}; ${String(changed)} pixel(s) changed. Pixels outside the selection are unchanged.${grew}${lost}`;
  },
};
