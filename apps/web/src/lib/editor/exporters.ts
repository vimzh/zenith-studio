import { paletteHexes, type DocumentStore, type Grid } from "@zenith/core";
import { encodeGif } from "@/lib/animation";
import { downloadBlob } from "@/lib/download";
import { encodeIndexedPng, exportForEngine, toAse, toGpl, toHexList, toPaintNetTxt, toPal, type Engine, type PaletteFormat } from "@/lib/export";
import { downloadPng } from "@/lib/pixel";
import { packSpritesheet, type SheetFrame } from "@/lib/spritesheet";

/**
 * Shared encoders for human downloads and agent-readable export artifacts.
 * The optional sink changes delivery only; both front doors receive identical bytes.
 */

export type ExportSink = (blob: Blob, filename: string) => void;

function saveText(contents: string, filename: string, type = "text/plain", sink: ExportSink = downloadBlob): void {
  sink(new Blob([contents], { type }), filename);
}

function saveBytes(bytes: Uint8Array, filename: string, type: string, sink: ExportSink = downloadBlob): void {
  // Copy into a fresh ArrayBuffer: a Uint8Array view may be a slice of a larger
  // buffer, and Blob would otherwise take the whole thing.
  sink(new Blob([bytes.slice()], { type }), filename);
}

/** Every frame of the open asset, composited. */
export function framesOf(store: DocumentStore): Grid[] {
  return Array.from({ length: store.frameCount }, (_, index) => store.readComposite(index));
}

function sheetFrames(store: DocumentStore, name: string): SheetFrame[] {
  const durations = store.snapshot().frames.map((frame) => frame.durationMs);
  return framesOf(store).map((grid, index) => ({
    name: `${name}_${String(index)}`,
    grid,
    tag: name,
    durationMs: durations[index],
  }));
}

export async function exportPng(store: DocumentStore, name: string, scale = 8): Promise<string> {
  await downloadPng(store.readComposite(), paletteHexes(store.palette), name, scale);
  return `Download ready: ${name}.png at ${String(scale)}x. Use its download notice if no file appeared.`;
}

export function exportIndexedPng(store: DocumentStore, name: string, scale = 1, sink: ExportSink = downloadBlob): string {
  const bytes = encodeIndexedPng(store.readComposite(), paletteHexes(store.palette), { scale });
  saveBytes(bytes, `${name}.png`, "image/png", sink);
  return `Prepared ${name}.png as indexed PNG-8, ${String(bytes.length)} bytes. Palette indices are preserved for runtime palette swapping.`;
}

/**
 * `speed` is a playback multiplier for the file, not a change to the asset.
 *
 * Authored holds are game timing — a jab is over in a third of a second — and a
 * GIF that loops unattended in a chat reads as frantic at that clock. Half
 * speed keeps every frame and every ratio between holds and slows the clock.
 */
export function exportGif(store: DocumentStore, name: string, fps?: number, scale = 4, sink: ExportSink = downloadBlob, speed = 1): string {
  const frames = framesOf(store);
  if (frames.length < 2) {
    throw new Error(
      `'${name}' has ${String(frames.length)} frame(s). An animated GIF needs at least two — add frames first.`
    );
  }
  if (!Number.isFinite(speed) || speed <= 0) throw new Error(`speed must be a positive number, received ${String(speed)}.`);
  const slow = (ms: number): number => Math.max(10, Math.round(ms / speed));
  const bytes = encodeGif(frames, paletteHexes(store.palette), {
    delayMs: fps === undefined ? store.snapshot().frames.map((frame) => slow(frame.durationMs)) : slow(1000 / Math.max(1, fps)),
    scale,
  });
  saveBytes(bytes, `${name}.gif`, "image/gif", sink);
  return `Prepared ${name}.gif — ${String(frames.length)} frames with ${fps === undefined ? "per-frame timing" : `${String(fps)}fps`}${speed === 1 ? "" : ` at ${String(speed)}x speed`}, ${String(scale)}x.`;
}

export async function exportSpritesheet(store: DocumentStore, name: string, sink: ExportSink = downloadBlob): Promise<string> {
  const packed = packSpritesheet(sheetFrames(store, name));
  saveBytes(encodeIndexedPng(packed.sheet, paletteHexes(store.palette)), `${name}.png`, "image/png", sink);
  saveText(`${JSON.stringify(packed.atlas, null, 2)}\n`, `${name}.json`, "application/json", sink);
  return `Prepared ${name}.png (${String(packed.atlas.meta.size.w)}x${String(packed.atlas.meta.size.h)}) and ${name}.json with ${String(packed.atlas.frames.length)} frames.`;
}

export async function exportEngine(
  store: DocumentStore,
  name: string,
  engine: Engine,
  sink: ExportSink = downloadBlob
): Promise<string> {
  const packed = packSpritesheet(sheetFrames(store, name));
  const bundle = exportForEngine(engine, { name, atlas: packed.atlas });

  saveBytes(encodeIndexedPng(packed.sheet, paletteHexes(store.palette)), `${name}.png`, "image/png", sink);
  for (const file of bundle.files) {
    saveText(file.contents, file.path, "text/plain", sink);
  }

  return `Prepared ${String(bundle.files.length + 1)} files for ${engine}: ${name}.png plus ${bundle.files
    .map((file) => file.path)
    .join(", ")}. ${bundle.instructions}`;
}

export function exportPalette(store: DocumentStore, name: string, format: PaletteFormat, sink: ExportSink = downloadBlob): string {
  const colors = paletteHexes(store.palette);

  switch (format) {
    case "gpl":
      saveText(toGpl(colors, name), `${name}.gpl`, "text/plain", sink);
      break;
    case "pal":
      saveText(toPal(colors), `${name}.pal`, "text/plain", sink);
      break;
    case "hex":
      saveText(toHexList(colors), `${name}.hex`, "text/plain", sink);
      break;
    case "txt":
      saveText(toPaintNetTxt(colors), `${name}.txt`, "text/plain", sink);
      break;
    case "ase":
      saveBytes(toAse(colors, name), `${name}.ase`, "application/octet-stream", sink);
      break;
    case "png-strip": {
      const strip: Grid = { width: colors.length, height: 1, cells: Int16Array.from(colors.map((_, i) => i)) };
      saveBytes(encodeIndexedPng(strip, colors, { scale: 8 }), `${name}-palette.png`, "image/png", sink);
      break;
    }
    default: {
      const exhaustive: never = format;
      throw new Error(`Unknown palette format: ${String(exhaustive)}`);
    }
  }

  return `Prepared ${String(colors.length)} colours as ${format}.`;
}
