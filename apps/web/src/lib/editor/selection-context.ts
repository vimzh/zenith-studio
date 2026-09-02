import { cropGrid, encodeGrid, paletteHexes, type Region } from "@zenith/core";
import { session } from "./session";

/**
 * The selected region, packaged for an LLM.
 *
 * A selection is the cheapest and most precise context a chat message can
 * carry: instead of "the thing in the top left", the model receives the exact
 * pixels under discussion in the format it already reads from `read_canvas`.
 * A 16x16 selection is roughly 290 tokens where a whole 64x64 canvas is ~1300,
 * and the smaller payload is also the more specific one.
 *
 * The palette travels with it. A grid of indices is meaningless without knowing
 * what 3 and 9 are, and sending a separate `get_palette` on every message would
 * cost a round trip to say something that never changes mid-conversation.
 */

export interface SelectionContext {
  readonly assetId: string;
  readonly region: Region;
  /** One character per pixel: `0`-`F` for a palette index, `.` for transparent. */
  readonly encoded: string;
  /** Index to hex, in order. */
  readonly palette: readonly string[];
  /** A sentence naming the region and its palette, ready to prepend to a prompt. */
  readonly summary: string;
}

/** Distinct palette indices used in a region, in ascending order. */
function indicesUsed(encoded: string): number[] {
  const seen = new Set<number>();
  for (const character of encoded) {
    if (character !== "\n" && character !== ".") {
      seen.add(Number.parseInt(character, 16));
    }
  }
  return [...seen].sort((a, b) => a - b);
}

/**
 * Builds the context for a selection, or null when nothing is selected.
 *
 * Returns null rather than falling back to the whole canvas: "no selection"
 * means the user is talking about the asset generally, and silently substituting
 * the entire grid would make every message expensive and none of them precise.
 */
export function selectionContext(
  assetId: string,
  region: Region | null
): SelectionContext | null {
  if (region === null) {
    return null;
  }

  const store = session.get(assetId);
  if (store === undefined) {
    return null;
  }

  const encoded = encodeGrid(cropGrid(store.readComposite(), region));
  const palette = paletteHexes(store.palette);
  const used = indicesUsed(encoded);

  const legend = used.length === 0
    ? "entirely transparent"
    : `using ${used.map((index) => `${index.toString(16).toUpperCase()}=${palette[index] ?? "?"}`).join(", ")}`;

  return {
    assetId,
    region,
    encoded,
    palette,
    summary:
      `The user has selected a ${String(region.width)}x${String(region.height)} region at ` +
      `(${String(region.x)}, ${String(region.y)}), ${legend}. ` +
      `Coordinates below are relative to that region's top-left; add the offset when writing back.`,
  };
}

/** The same context for the whole canvas, when a message needs everything. */
export function canvasContext(assetId: string): SelectionContext | null {
  const store = session.get(assetId);
  if (store === undefined) {
    return null;
  }
  return selectionContext(assetId, {
    x: 0,
    y: 0,
    width: store.width,
    height: store.height,
  });
}
