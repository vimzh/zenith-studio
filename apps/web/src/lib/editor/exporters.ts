import { paletteHexes, type DocumentStore, type Grid } from "@zenith/core";
import { encodeGif } from "@/lib/animation";
import { encodeIndexedPng, exportForEngine, toAse, toGpl, toHexList, toPaintNetTxt, toPal, type Engine, type PaletteFormat } from "@/lib/export";
import { downloadPng, gridToPngBlob } from "@/lib/pixel";
import { packSpritesheet, type SheetFrame } from "@/lib/spritesheet";

/**
 * Download plumbing for every export format.
 *
 * Kept in one module so the editor UI and the WebMCP tool layer trigger the
 * same code path. A tool cannot hand an agent a file, so both sides do the same
 * thing: produce the bytes, hand them to the human, and report what happened.
 */

function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function saveText(contents: string, filename: string, type = "text/plain"): void {
  saveBlob(new Blob([contents], { type }), filename);
}

function saveBytes(bytes: Uint8Array, filename: string, type: string): void {
  // Copy into a fresh ArrayBuffer: a Uint8Array view may be a slice of a larger
  // buffer, and Blob would otherwise take the whole thing.
  saveBlob(new Blob([bytes.slice()], { type }), filename);
}

/** Every frame of the open asset, composited. */
export function framesOf(store: DocumentStore): Grid[] {
  return Array.from({ length: store.frameCount }, (_, index) => store.readComposite(index));
}

function sheetFrames(store: DocumentStore, name: string): SheetFrame[] {
  return framesOf(store).map((grid, index) => ({
    name: `${name}_${String(index)}`,
    grid,
    tag: name,
  }));
}

export async function exportPng(store: DocumentStore, name: string, scale = 8): Promise<string> {
  await downloadPng(store.readComposite(), paletteHexes(store.palette), name, scale);
  return `Exported ${name}.png at ${String(scale)}x.`;
}

export function exportIndexedPng(store: DocumentStore, name: string, scale = 1): string {
  const bytes = encodeIndexedPng(store.readComposite(), paletteHexes(store.palette), { scale });
  saveBytes(bytes, `${name}.png`, "image/png");
  return `Exported ${name}.png as indexed PNG-8, ${String(bytes.length)} bytes. Palette indices are preserved, so it supports runtime palette swapping.`;
}

export function exportGif(store: DocumentStore, name: string, fps?: number, scale = 4): string {
  const frames = framesOf(store);
  if (frames.length < 2) {
    throw new Error(
      `'${name}' has ${String(frames.length)} frame(s). An animated GIF needs at least two — add frames first.`
    );
  }
  const bytes = encodeGif(frames, paletteHexes(store.palette), {
    delayMs: fps === undefined ? store.snapshot().frames.map((frame) => frame.durationMs) : Math.round(1000 / Math.max(1, fps)),
    scale,
  });
  saveBytes(bytes, `${name}.gif`, "image/gif");
  return `Exported ${name}.gif — ${String(frames.length)} frames with ${fps === undefined ? "per-frame timing" : `${String(fps)}fps`}, ${String(scale)}x.`;
}

export async function exportSpritesheet(store: DocumentStore, name: string): Promise<string> {
  const packed = packSpritesheet(sheetFrames(store, name));
  const blob = await gridToPngBlob(packed.sheet, paletteHexes(store.palette), 1);
  saveBlob(blob, `${name}.png`);
  saveText(`${JSON.stringify(packed.atlas, null, 2)}\n`, `${name}.json`, "application/json");
  return `Exported ${name}.png (${String(packed.atlas.meta.size.w)}x${String(packed.atlas.meta.size.h)}) and ${name}.json with ${String(packed.atlas.frames.length)} frames.`;
}

export async function exportEngine(
  store: DocumentStore,
  name: string,
  engine: Engine
): Promise<string> {
  const packed = packSpritesheet(sheetFrames(store, name));
  const bundle = exportForEngine(engine, { name, atlas: packed.atlas });

  const blob = await gridToPngBlob(packed.sheet, paletteHexes(store.palette), 1);
  saveBlob(blob, `${name}.png`);
  for (const file of bundle.files) {
    saveText(file.contents, file.path);
  }

  return `Exported ${String(bundle.files.length + 1)} files for ${engine}: ${name}.png plus ${bundle.files
    .map((file) => file.path)
    .join(", ")}. ${bundle.instructions}`;
}

export function exportPalette(store: DocumentStore, name: string, format: PaletteFormat): string {
  const colors = paletteHexes(store.palette);

  switch (format) {
    case "gpl":
      saveText(toGpl(colors, name), `${name}.gpl`);
      break;
    case "pal":
      saveText(toPal(colors), `${name}.pal`);
      break;
    case "hex":
      saveText(toHexList(colors), `${name}.hex`);
      break;
    case "txt":
      saveText(toPaintNetTxt(colors), `${name}.txt`);
      break;
    case "ase":
      saveBytes(toAse(colors, name), `${name}.ase`, "application/octet-stream");
      break;
    case "png-strip": {
      const strip: Grid = { width: colors.length, height: 1, cells: Int8Array.from(colors.map((_, i) => i)) };
      saveBytes(encodeIndexedPng(strip, colors, { scale: 8 }), `${name}-palette.png`, "image/png");
      break;
    }
    default: {
      const exhaustive: never = format;
      throw new Error(`Unknown palette format: ${String(exhaustive)}`);
    }
  }

  return `Exported ${String(colors.length)} colours as ${format}.`;
}
