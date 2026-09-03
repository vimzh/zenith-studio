/** Agent export handoffs reconstruct real product-sized files without DOM downloads. */
import { afterEach, beforeEach, expect, test } from "bun:test";
import { paletteHexes } from "@zenith/core";
import { encodeGif } from "@/lib/animation";
import { projects, session } from "@/lib/editor";
import { encodeIndexedPng } from "@/lib/export";
import { listExportFiles, readExportFile, releaseExportFile, retainExportFiles } from "./artifacts";
import { runTool } from "./run";
import { findTool } from "./tools";
import type { ToolArgs } from "./types";

function clearFiles() { for (const file of listExportFiles()) releaseExportFile(file.artifact_id); }
beforeEach(() => {
  clearFiles();
  for (const asset of session.list()) session.close(asset.id);
  for (const project of projects.listProjects()) projects.deleteProject(project.id);
});
afterEach(clearFiles);

async function call(name: string, args: ToolArgs = {}) {
  const result = await runTool(findTool(name)!, args, "agent");
  if (!result.ok) throw new Error(result.text);
  return JSON.parse(result.text);
}

async function bytes(id: string, length = 49152) {
  const chunks: Buffer[] = [];
  let offset = 0;
  for (;;) {
    const chunk = await call("read_export", { artifact_id: id, offset, length });
    const decoded = Buffer.from(chunk.data, "base64");
    expect(decoded.length).toBe(chunk.bytes_returned);
    chunks.push(decoded);
    offset += decoded.length;
    expect(chunk.next_offset).toBe(offset);
    if (chunk.eof) { expect(offset).toBe(chunk.byte_length); break; }
    expect(decoded.length).toBeGreaterThan(0);
  }
  return Buffer.concat(chunks);
}

test("128px PNG at the UI's 16x scale is retrieved byte-exactly, not truncated above 8192 chars", async () => {
  session.create({ name: "Test hero", preset: "modern-64", width: 128, height: 128, type: "character" });
  const store = session.active!;
  store.fillRegion({ x: 3, y: 7, width: 100, height: 110 }, 1);
  const manifest = await call("export_png", { scale: 16 });
  expect(manifest.browser_download_requested).toBe(false);
  const file = manifest.files[0];
  expect(file.byte_length).toBeGreaterThan(8192);
  const actual = await bytes(file.artifact_id, 10001); // intentionally not divisible by three
  expect(actual).toEqual(Buffer.from(encodeIndexedPng(store.readComposite(), paletteHexes(store.palette), { scale: 16 })));
  expect(actual.readUInt32BE(16)).toBe(2048);
  expect((await call("list_exports")).files).toHaveLength(1);
  await call("release_export", { artifact_id: file.artifact_id });
  await expect(call("read_export", { artifact_id: file.artifact_id })).rejects.toThrow("Unknown export");
  expect(session.active).toBe(store);
});

test("GIF, sheet, every engine and every palette format expose complete bytes and timing", async () => {
  session.create({ name: "Hero", preset: "tile-32", type: "character" });
  const store = session.active!;
  store.fillRegion({ x: 10, y: 10, width: 8, height: 12 }, 2);
  store.addFrame({ copyFrom: 0 });
  store.setFrameDuration(0, 250);
  store.setFrameDuration(1, 350);
  const manifest = await call("export_animation", { format: "gif" });
  const gif = await bytes(manifest.files[0].artifact_id);
  expect(gif).toEqual(Buffer.from(encodeGif([store.readComposite(0), store.readComposite(1)], paletteHexes(store.palette), { scale: 4, delayMs: [250, 350] })));
  clearFiles();
  const sheet = await call("export_animation", { format: "spritesheet" });
  expect(sheet.files).toHaveLength(2);
  const atlas = JSON.parse((await bytes(sheet.files.find((file: { filename: string }) => file.filename.endsWith(".json")).artifact_id)).toString());
  expect(atlas.frames.map((frame: { duration: number }) => frame.duration)).toEqual([250, 350]);
  clearFiles();
  for (const engine of ["godot", "unity", "phaser", "love"]) {
    const output = await call("export_for_engine", { engine });
    expect(output.files.length).toBeGreaterThanOrEqual(2);
    expect(output.details).toContain(engine);
    for (const file of output.files) expect((await bytes(file.artifact_id)).length).toBe(file.byte_length);
    clearFiles();
  }
  for (const format of ["gpl", "pal", "ase", "hex", "txt", "png-strip"]) {
    const output = await call("export_palette", { format });
    expect(output.files).toHaveLength(1);
    expect((await bytes(output.files[0].artifact_id)).length).toBeGreaterThan(0);
    clearFiles();
  }
  await expect(call("export_animation", { format: "spritesheet", fps: 4 })).rejects.toThrow("GIF");
});

test("project output can be read as a complete versioned JSON bundle", async () => {
  const projectId = projects.createProject("Agent project");
  const assetId = session.create({ name: "Hero", preset: "tile-32" });
  projects.place(assetId, projectId);
  const output = await call("export_project");
  const bundle = JSON.parse((await bytes(output.files[0].artifact_id)).toString());
  expect(bundle.format).toBe("zenith.project");
  expect(bundle.assets[0].id).toBe(assetId);
  expect(bundle.placements[0].projectId).toBe(projectId);
});

test("legacy stale references fail before export and can be repaired through the agent style tool", async () => {
  const projectId = projects.createProject("Legacy");
  const assetId = session.create({ name: "Hero", preset: "tile-32" });
  projects.place(assetId, projectId);
  projects.setStyle(projectId, { references: ["deleted_asset"] });
  await expect(call("export_project")).rejects.toThrow("stale style references");
  expect(listExportFiles()).toHaveLength(0);
  const definition = findTool("set_style_profile")!;
  const invalid = await runTool(definition, { reference_asset_ids: ["not_in_project"] }, "agent");
  expect(invalid.ok).toBe(false);
  expect(projects.getProject(projectId)?.style.references).toEqual(["deleted_asset"]);
  expect((await runTool(definition, { reference_asset_ids: [] }, "agent")).ok).toBe(true);
  expect(projects.getProject(projectId)?.style.references).toEqual([]);
  expect((await runTool(definition, { reference_asset_ids: [assetId] }, "agent")).ok).toBe(true);
  const output = await call("export_project");
  expect(JSON.parse((await bytes(output.files[0].artifact_id)).toString()).project.style.references).toEqual([assetId]);
});

test("artifact bounds fail clearly and a full store never retains a partial bundle", async () => {
  const [file] = retainExportFiles([{ filename: "test.bin", blob: new Blob([Uint8Array.from([0, 255, 10])]) }]);
  await expect(readExportFile(file!.artifact_id, -1, 1)).rejects.toThrow("offset");
  await expect(readExportFile(file!.artifact_id, 4, 1)).rejects.toThrow("offset");
  await expect(readExportFile(file!.artifact_id, 0, 49153)).rejects.toThrow("length");
  expect(await readExportFile(file!.artifact_id, 3, 1)).toMatchObject({ eof: true, data: "", bytes_returned: 0 });
  const small = { filename: "small.txt", blob: new Blob(["x"]) };
  retainExportFiles(Array.from({ length: 30 }, () => small));
  expect(() => retainExportFiles([small, small])).toThrow("full");
  expect(listExportFiles()).toHaveLength(31);
  expect(() => retainExportFiles([{ filename: "too-large", blob: new Blob([new Uint8Array(64 * 1024 * 1024)]) }])).toThrow("full");
  expect(listExportFiles()).toHaveLength(31);
});
