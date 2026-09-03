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
import { encodeIndexedPng } from "@/lib/export";
import { pixelizeAsync } from "@/lib/pixelize";
import { deriveImage } from "../api";
import { readBoolean, readInteger, readString } from "../args";
import { decodeBase64Png } from "../raster";
import { ToolError, type ToolDefinition } from "../types";
import { assertEditTarget, captureEditTarget, requireActiveAsset, toToolError, type EditTarget } from "./active";
import { conformToPalette, mergePalette } from "./generation";

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
  allowRemoval = false,
): number {
  validateInpaintRegion(store.readComposite(), generated, region, allowRemoval);
  const bounds = normalizeRegion(generated, region);
  return store.transaction("inpaint_region", () =>
    store.writeRegion(bounds.x, bounds.y, cropGrid(generated, bounds)),
  );
}

/** A mask is permission to edit, not permission to silently erase the subject. */
export function validateInpaintRegion(source: Grid, generated: Grid, region: Region, allowRemoval = false): void {
  if (generated.width !== source.width || generated.height !== source.height) {
    throw new ToolError(
      `The inpaint resolved to ${String(generated.width)}x${String(generated.height)}, not the asset's ${String(source.width)}x${String(source.height)} grid. The asset was not changed.`,
    );
  }
  const bounds = normalizeRegion(generated, region);
  let opaque = 0;
  let removed = 0;
  for (let y = bounds.y; y < bounds.y + bounds.height; y++) {
    for (let x = bounds.x; x < bounds.x + bounds.width; x++) {
      const offset = y * source.width + x;
      if (source.cells[offset] === TRANSPARENT) continue;
      opaque++;
      if (generated.cells[offset] === TRANSPARENT) removed++;
    }
  }
  // A quarter of the selected subject disappearing is destructive, even when
  // the total output still has plenty of opaque pixels and a confident grid.
  // Explicit removal can opt out; this is not an anatomy-quality classifier.
  if (!allowRemoval && removed > opaque * 0.25) {
    throw new ToolError(`The model removed ${String(removed)} of ${String(opaque)} subject pixels inside the selection. The asset was not changed. Use a tighter selection; set allow_removal only when erasing part of the subject is intended.`);
  }
}

/** Colours used outside the replaced layer region cannot be repurposed. */
export function protectedInpaintColors(store: DocumentStore, region: Region): ReadonlySet<number> {
  const used = new Set<number>();
  const snapshot = store.snapshot();
  snapshot.frames.forEach((frame, fi) => frame.layers.forEach((layer, li) => {
    layer.grid.cells.forEach((cell, offset) => {
      const x = offset % store.width;
      const y = Math.floor(offset / store.width);
      const replaced = fi === store.activeFrame && li === store.activeLayer &&
        x >= region.x && x < region.x + region.width && y >= region.y && y < region.y + region.height;
      if (!replaced && cell !== TRANSPARENT) used.add(cell);
    });
  }));
  return used;
}

/** Commit only against the unchanged source; a slow edit must never win a race. */
export function commitInpaintResult(target: EditTarget, grid: Grid, palette: readonly string[], region: Region, allowRemoval = false): number {
  assertEditTarget(target);
  const { store, revision } = target;
  validateInpaintRegion(store.readComposite(), grid, region, allowRemoval);
  const changed = store.transaction("inpaint_region", () => {
    store.setPalette(palette);
    return store.writeRegion(region.x, region.y, cropGrid(grid, region));
  });
  if (store.revision === revision) {
    throw new ToolError("The model made no pixel or palette changes. No undo entry was created; the existing artwork and history are unchanged.");
  }
  return changed;
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
    "Edit a rectangle of the open square, single-layer frame via one slow, paid model call. Asset-local (0,0) top-left; +x right, +y down. Outside pixels stay identical; one undo restores the edit. No change creates no undo. Erasing over 25% of the selected subject is refused unless allow_removal is explicitly enabled.",
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
      allow_removal: {
        type: "boolean",
        description: "Defaults to false: refuse an edit that erases more than a quarter of the selected subject. Set true only when the user explicitly wants part of the subject removed, never for recolouring or rotation.",
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
    const allowRemoval = readBoolean(args, "allow_removal", false);
    const target = captureEditTarget({ id, store });
    if (store.width !== store.height || store.layerCount !== 1) {
      throw new ToolError("Masked image editing currently needs a square, single-layer frame. No model call was made and the asset was not changed.");
    }
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
    // Only colours used outside this layer's mask must stay reserved. Colours
    // used solely inside it can be replaced unless the result still needs them.
    const used = protectedInpaintColors(store, inputs.region);
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
        targetHeight: store.height,
        maxColors: Math.max(16, palette.length),
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
    if (merge.unmatched.length > 0) {
      throw new ToolError(`The edit needs colours that cannot fit without changing pixels outside the selection: ${merge.unmatched.join(", ")}. The asset was not changed. Free palette colours or simplify the requested edit.`);
    }
    const changed = commitInpaintResult(
      target,
      conformToPalette(result.grid, result.palette, merge.colors),
      merge.colors,
      inputs.region,
      allowRemoval,
    );
    const grew =
      merge.added.length === 0
        ? ""
        : ` Added ${merge.added.join(", ")} to the palette (now ${String(merge.colors.length)} colours).`;
    return `Inpainted (${String(inputs.region.x)}, ${String(inputs.region.y)}) ${String(inputs.region.width)}x${String(inputs.region.height)}; ${String(changed)} pixel(s) changed. Pixels outside the selection are unchanged. One undo restores the pixels and palette.${grew} Inspect the result; grid validation does not verify visual quality.`;
  },
};
