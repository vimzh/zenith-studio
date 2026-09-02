import { gridToPngBlob } from "@/lib/pixel";
import { downloadProject, exportEngine as exportEngineFiles, exportGif, exportPalette as exportPaletteFile, exportSpritesheet, projects } from "@/lib/editor";
import type { Engine, PaletteFormat } from "@/lib/export";
import { readEnum, readInteger } from "../args";
import { ToolError, type ToolDefinition } from "../types";
import { requireActiveAsset } from "./active";

/**
 * Export.
 *
 * PNG at integer scales only, nearest-neighbour, byte-exact against the indexed
 * grid. Every other export format is phase 13.
 */

const VALID_SCALES = [1, 2, 4, 8, 16] as const;

/**
 * Above this the base64 is more tokens than it is worth to an agent, so the
 * download still fires and the result says where the file went instead.
 */
const MAX_INLINE_DATA_URL_CHARS = 8192;

async function blobToDataUrl(blob: Blob): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not encode the PNG as a data URL."));
    reader.readAsDataURL(blob);
  });
}

export const exportPng: ToolDefinition = {
  name: "export_png",
  description:
    "Export the currently open asset as a PNG and start the human's download. Scaling is nearest-neighbour at integer factors only (1, 2, 4, 8, 16) — fractional scaling would resample the art and is not offered. The PNG is byte-exact against the indexed grid: transparent cells stay fully transparent, every other pixel fully opaque. Returns a data URL when the file is small enough to be worth inlining, and the file size either way.",
  inputSchema: {
    type: "object",
    properties: {
      scale: {
        type: "integer",
        enum: [...VALID_SCALES],
        description: "Integer pixel multiplier. Defaults to 1, the canonical size.",
      },
    },
  },
  example: { scale: 1 },
  execute: async (args) => {
    const { name, store } = requireActiveAsset();
    const scale = args["scale"] === undefined ? 1 : readInteger(args, "scale", 1, 16);
    if (!VALID_SCALES.includes(scale as (typeof VALID_SCALES)[number])) {
      throw new ToolError(
        `scale must be one of ${VALID_SCALES.join(", ")}, received ${String(scale)}. Non-integer multiples resample pixel art.`,
      );
    }

    const grid = store.readComposite();
    const palette = store.palette.colors.map((color) => color.hex);

    let blob: Blob;
    try {
      blob = await gridToPngBlob(grid, palette, scale);
    } catch (error) {
      throw new ToolError(
        `PNG export failed: ${error instanceof Error ? error.message : String(error)}. This tool needs a browser canvas and cannot run server-side.`,
      );
    }

    const filename = `${name.replace(/[^a-z0-9_-]+/gi, "-").toLowerCase()}${scale === 1 ? "" : `@${String(scale)}x`}.png`;
    const dataUrl = await blobToDataUrl(blob);

    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = filename;
    link.click();

    const dimensions = `${String(grid.width * scale)}x${String(grid.height * scale)}`;
    const summary = `Exported '${name}' as ${filename} at ${String(scale)}x (${dimensions}, ${String(blob.size)} bytes) and started the download.`;
    return dataUrl.length <= MAX_INLINE_DATA_URL_CHARS
      ? `${summary}\n${dataUrl}`
      : `${summary} The data URL is ${String(dataUrl.length)} characters, too large to inline — the file has been downloaded.`;
  },
};

export const exportAnimation: ToolDefinition = {
  name: "export_animation",
  description: "Export every frame of the open asset as an animated GIF or a spritesheet PNG plus JSON atlas and start the downloads.",
  inputSchema: { type: "object", properties: { format: { type: "string", enum: ["gif", "spritesheet"] }, scale: { type: "integer", minimum: 1, maximum: 16 }, fps: { type: "integer", minimum: 1, maximum: 30 } }, required: ["format"] },
  example: { format: "gif", scale: 4, fps: 8 },
  execute: async (args) => { const { name, store } = requireActiveAsset(); const format = readEnum(args, "format", ["gif", "spritesheet"] as const); if (format === "gif") return exportGif(store, name, args["fps"] === undefined ? undefined : readInteger(args, "fps", 1, 30), args["scale"] === undefined ? 4 : readInteger(args, "scale", 1, 16)); return await exportSpritesheet(store, name); },
};

export const exportForEngineTool: ToolDefinition = {
  name: "export_for_engine", description: "Export a spritesheet plus engine-specific metadata with nearest-neighbour filtering configured.",
  inputSchema: { type: "object", properties: { engine: { type: "string", enum: ["godot", "unity", "phaser", "love"] } }, required: ["engine"] }, example: { engine: "godot" },
  execute: async (args) => { const { name, store } = requireActiveAsset(); return await exportEngineFiles(store, name, readEnum<Engine>(args, "engine", ["godot", "unity", "phaser", "love"] as const)); },
};

export const exportPaletteTool: ToolDefinition = {
  name: "export_palette", description: "Export the open asset palette as GPL, JASC PAL, Adobe ASE, hex list, Paint.NET text, or a PNG strip.",
  inputSchema: { type: "object", properties: { format: { type: "string", enum: ["gpl", "pal", "ase", "hex", "txt", "png-strip"] } }, required: ["format"] }, example: { format: "gpl" },
  execute: (args) => { const { name, store } = requireActiveAsset(); return exportPaletteFile(store, name, readEnum<PaletteFormat>(args, "format", ["gpl", "pal", "ase", "hex", "txt", "png-strip"] as const)); },
};

export const exportProject: ToolDefinition = {
  scope: "always", name: "export_project", description: "Export the open project as one Zenith JSON bundle containing its style, folders, placements and assets, and start the download.",
  inputSchema: { type: "object", properties: {} }, example: {}, execute: () => {
    const id = projects.activeProjectId;
    if (id === null) throw new ToolError("No project is open. Call open_project first.");
    downloadProject(id);
    return `Exported project '${projects.getProject(id)?.name ?? id}' as a Zenith bundle.`;
  },
};
