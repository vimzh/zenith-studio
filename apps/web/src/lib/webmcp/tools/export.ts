/** Exports share the UI encoders, with complete file retrieval for external agents. */
import { downloadBlob } from "@/lib/download";
import { projects } from "@/lib/editor";
import { exportEngine, exportGif, exportIndexedPng, exportPalette, exportSpritesheet, type ExportSink } from "@/lib/editor/exporters";
import { exportProjectBundle } from "@/lib/editor/transfer";
import { readEnum, readInteger, readString } from "../args";
import { listExportFiles, MAX_CHUNK_BYTES, readExportFile, releaseExportFile, retainExportFiles, type ExportFile } from "../artifacts";
import { ToolError, type ToolArgs, type ToolDefinition } from "../types";
import { requireActiveAsset } from "./active";

const VALID_SCALES = [1, 2, 4, 8, 16] as const;
const deliverySchema = {
  type: "string", enum: ["artifact", "download", "both"],
  description: "Default artifact: read_export bytes. download: browser only. both: both; disk save unconfirmed.",
};

function safeName(name: string): string {
  return name.replace(/[^a-z0-9_-]+/gi, "-").toLowerCase() || "asset";
}

async function deliver(args: ToolArgs, encode: (sink: ExportSink) => unknown): Promise<string> {
  const delivery = readEnum(args, "delivery", ["artifact", "download", "both"] as const, "artifact");
  const files: ExportFile[] = [];
  const details = await encode((blob, filename) => { files.push({ blob, filename }); });
  const artifacts = delivery === "download" ? [] : retainExportFiles(files);
  if (delivery !== "artifact") for (const file of files) downloadBlob(file.blob, file.filename);
  return JSON.stringify({
    ...(typeof details === "string" ? { details } : {}),
    delivery, files: delivery === "download" ? files.map((file) => ({ filename: file.filename, mime_type: file.blob.type, byte_length: file.blob.size })) : artifacts,
    retrieval: delivery === "download" ? "Browser downloads requested; saving to disk is not confirmed." : "Call read_export with artifact_id, offset=0 and length<=49152. Decode each base64 chunk separately and append bytes until eof=true. Release after saving. Files expire on page reload.",
    browser_download_requested: delivery !== "artifact",
  });
}

export const exportPng: ToolDefinition = {
  name: "export_png",
  description: "Export the open asset's active composite as indexed PNG with exact palette/transparency. Scales 1/2/4/8/16 only. Returns complete-file IDs for read_export, not inline bytes. Files expire on release or page reload.",
  inputSchema: { type: "object", properties: { scale: { type: "integer", enum: [...VALID_SCALES], description: "Integer multiplier; defaults to canonical 1x." }, delivery: deliverySchema } },
  example: { scale: 1 },
  execute: (args) => {
    const { name, store } = requireActiveAsset();
    const scale = args["scale"] === undefined ? 1 : readInteger(args, "scale", 1, 16);
    if (!VALID_SCALES.includes(scale as (typeof VALID_SCALES)[number])) throw new ToolError(`scale must be one of ${VALID_SCALES.join(", ")}. Non-integer multiples resample pixel art.`);
    return deliver(args, (sink) => exportIndexedPng(store, `${safeName(name)}${scale === 1 ? "" : `@${String(scale)}x`}`, scale, sink));
  },
};

export const exportAnimation: ToolDefinition = {
  name: "export_animation",
  description: "Export all open-asset frames as GIF or spritesheet PNG+JSON; retrieve files with read_export. GIF defaults to 4x and authored timing unless fps is supplied; speed 0.25-4 scales playback (0.5 for a chat). Spritesheets use 1x/authored timing and reject scale/fps/speed. Page-session files only.",
  inputSchema: { type: "object", properties: { format: { type: "string", enum: ["gif", "spritesheet"] }, scale: { type: "integer", minimum: 1, maximum: 16 }, fps: { type: "integer", minimum: 1, maximum: 30 }, speed: { type: "number", minimum: 0.25, maximum: 4 }, delivery: deliverySchema }, required: ["format"] },
  example: { format: "gif", scale: 4, fps: 4 },
  execute: (args) => {
    const { name, store } = requireActiveAsset();
    const format = readEnum(args, "format", ["gif", "spritesheet"] as const);
    if (format === "spritesheet" && (args["scale"] !== undefined || args["fps"] !== undefined || args["speed"] !== undefined)) throw new ToolError("scale, fps and speed apply only to GIF. Omit them for a canonical spritesheet with authored frame durations.");
    const speed = args["speed"] === undefined ? 1 : args["speed"];
    if (typeof speed !== "number" || !Number.isFinite(speed) || speed < 0.25 || speed > 4) throw new ToolError("speed must be a number between 0.25 and 4; 1 is authored timing, 0.5 is half speed.");
    return deliver(args, (sink) => format === "gif"
      ? exportGif(store, safeName(name), args["fps"] === undefined ? undefined : readInteger(args, "fps", 1, 30), args["scale"] === undefined ? 4 : readInteger(args, "scale", 1, 16), sink, speed)
      : exportSpritesheet(store, safeName(name), sink));
  },
};

export const exportForEngineTool: ToolDefinition = {
  name: "export_for_engine",
  description: "Export the open asset as spritesheet and Godot/Unity/Phaser/LÖVE metadata with authored timing and nearest-neighbour settings. Returns every file ID plus import instructions; retrieve bytes with read_export before page reload.",
  inputSchema: { type: "object", properties: { engine: { type: "string", enum: ["godot", "unity", "phaser", "love"] }, delivery: deliverySchema }, required: ["engine"] }, example: { engine: "godot" },
  execute: (args) => { const { name, store } = requireActiveAsset(); return deliver(args, (sink) => exportEngine(store, safeName(name), readEnum(args, "engine", ["godot", "unity", "phaser", "love"] as const), sink)); },
};

export const exportPaletteTool: ToolDefinition = {
  name: "export_palette",
  description: "Export the open asset palette as GPL, PAL, ASE, hex, Paint.NET text or PNG strip. Returns a complete-file ID for read_export. Files expire on release or page reload.",
  inputSchema: { type: "object", properties: { format: { type: "string", enum: ["gpl", "pal", "ase", "hex", "txt", "png-strip"] }, delivery: deliverySchema }, required: ["format"] }, example: { format: "gpl" },
  execute: (args) => { const { name, store } = requireActiveAsset(); return deliver(args, (sink) => exportPalette(store, safeName(name), readEnum(args, "format", ["gpl", "pal", "ase", "hex", "txt", "png-strip"] as const), sink)); },
};

export const exportProject: ToolDefinition = {
  scope: "always", name: "export_project",
  description: "Export the open project's style, folders, placements and documents as a restorable Zenith JSON bundle. Retrieve bytes with read_export before reload; restore with import_project. Export is not IndexedDB durability confirmation.",
  inputSchema: { type: "object", properties: { delivery: deliverySchema } }, example: {},
  execute: (args) => {
    const id = projects.activeProjectId;
    if (id === null) throw new ToolError("No project is open. Call open_project first.");
    return deliver(args, (sink) => sink(new Blob([JSON.stringify(exportProjectBundle(id))], { type: "application/json" }), `${safeName(projects.getProject(id)?.name ?? id)}.zenith.json`));
  },
};

export const listExports: ToolDefinition = {
  scope: "always", name: "list_exports", readOnly: true,
  description: "List this page session's retained output IDs, filenames, MIME types and byte lengths. Read with read_export; free with release_export. Reload discards files. Limit: 32 files / 64 MiB; no silent eviction.",
  inputSchema: { type: "object", properties: {} }, example: {},
  execute: () => JSON.stringify({ files: listExportFiles(), max_files: 32, max_bytes: 64 * 1024 * 1024 }),
};

export const readExport: ToolDefinition = {
  scope: "always", name: "read_export", readOnly: true,
  description: "Read page-session file bytes as base64. offset counts BYTES from zero (default 0); length 1–49152 (default 12288). Decode each chunk separately, append bytes and use next_offset until eof=true. Repeated reads are safe.",
  inputSchema: { type: "object", properties: { artifact_id: { type: "string" }, offset: { type: "integer", minimum: 0 }, length: { type: "integer", minimum: 1, maximum: MAX_CHUNK_BYTES } }, required: ["artifact_id"] },
  example: { artifact_id: "export_id", offset: 0, length: 12288 },
  execute: async (args) => JSON.stringify(await readExportFile(readString(args, "artifact_id"), args["offset"] === undefined ? 0 : readInteger(args, "offset", 0), args["length"] === undefined ? 12288 : readInteger(args, "length", 1, MAX_CHUNK_BYTES))),
};

export const releaseExport: ToolDefinition = {
  scope: "always", name: "release_export",
  description: "Release temporary export bytes after saving them. Never deletes editable artwork, projects or downloaded files. Later read_export calls for this ID fail; re-export if needed.",
  inputSchema: { type: "object", properties: { artifact_id: { type: "string" } }, required: ["artifact_id"] }, example: { artifact_id: "export_id" },
  execute: (args) => { const id = readString(args, "artifact_id"); releaseExportFile(id); return JSON.stringify({ released: id }); },
};
