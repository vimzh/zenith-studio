/** Page-session export bytes, retained until explicitly released or the page reloads. */
import { ToolError } from "./types";

export interface ExportFile {
  readonly filename: string;
  readonly blob: Blob;
}

const files = new Map<string, ExportFile>();
const MAX_FILES = 32;
const MAX_BYTES = 64 * 1024 * 1024;
export const MAX_CHUNK_BYTES = 49152;

function metadata(id: string, file: ExportFile) {
  return { artifact_id: id, filename: file.filename, mime_type: file.blob.type, byte_length: file.blob.size };
}

export function listExportFiles() {
  return Array.from(files, ([id, file]) => metadata(id, file));
}

/** Check the whole bundle before retaining any file; never silently evict agent output. */
export function retainExportFiles(bundle: readonly ExportFile[]) {
  const bytes = [...files.values(), ...bundle].reduce((sum, file) => sum + file.blob.size, 0);
  if (files.size + bundle.length > MAX_FILES || bytes > MAX_BYTES) {
    throw new ToolError("Export storage is full (32 files / 64 MiB per page session). Use list_exports and release_export after saving files, then export again.");
  }
  return bundle.map((file) => {
    const id = `export_${crypto.randomUUID()}`;
    files.set(id, file);
    return metadata(id, file);
  });
}

export async function readExportFile(id: string, offset: number, length: number) {
  const file = files.get(id);
  if (file === undefined) throw new ToolError(`Unknown export '${id}'. Call list_exports; released files and files from a previous page session cannot be read.`);
  if (!Number.isInteger(offset) || offset < 0 || offset > file.blob.size) throw new ToolError(`offset must be an integer from 0 to ${String(file.blob.size)}.`);
  if (!Number.isInteger(length) || length < 1 || length > MAX_CHUNK_BYTES) throw new ToolError(`length must be an integer from 1 to ${String(MAX_CHUNK_BYTES)}.`);
  const bytes = new Uint8Array(await file.blob.slice(offset, offset + length).arrayBuffer());
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const next = offset + bytes.length;
  return { ...metadata(id, file), encoding: "base64", offset, bytes_returned: bytes.length, next_offset: next, eof: next === file.blob.size, data: btoa(binary) };
}

export function releaseExportFile(id: string): void {
  if (!files.delete(id)) throw new ToolError(`Unknown export '${id}'. Call list_exports to find retained files.`);
}
