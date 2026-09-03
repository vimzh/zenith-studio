// Validate a complete exported project before importing it additively under fresh ids.
import {
  createPalette, deserializeDocument, DIRECTION_SETS, OUTLINES, PROJECTIONS,
  PROPORTIONS, SHADINGS, VIEWS, type StyleProfile,
} from "@zenith/core";
import { projects, type Folder } from "./projects";
import { session, type AssetType } from "./session";

const ASSET_TYPES: readonly AssetType[] = ["character", "tile", "texture", "tileset", "item", "ui"];

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${path} must be an object.`);
  return value as Record<string, unknown>;
}

function text(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${path} must be a non-empty string.`);
  return value;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array.`);
  return value;
}

function integer(value: unknown, path: string, minimum = 0): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) throw new Error(`${path} must be an integer at least ${String(minimum)}.`);
  return value;
}

function choice<T extends string>(value: unknown, allowed: readonly T[], path: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) throw new Error(`${path} must be one of ${allowed.join(", ")}.`);
  return value as T;
}

function readStyle(value: unknown): StyleProfile {
  const style = record(value, "project.style");
  const palette = record(style["palette"], "project.style.palette");
  const sizes = record(style["canvasSizes"], "project.style.canvasSizes");
  const size = (key: string) => {
    const value = integer(sizes[key], `project.style.canvasSizes.${key}`, 4);
    if (value > 256) throw new Error(`project.style.canvasSizes.${key} must not exceed 256.`);
    return value;
  };
  if (style["notes"] !== undefined && typeof style["notes"] !== "string") throw new Error("project.style.notes must be a string.");
  return {
    palette: createPalette({
      id: text(palette["id"], "project.style.palette.id"),
      name: text(palette["name"], "project.style.palette.name"),
      colors: array(palette["colors"], "project.style.palette.colors").map((color, index) =>
        text(record(color, `palette.colors[${String(index)}]`)["hex"], "palette color hex")),
    }),
    canvasSizes: { character: size("character"), tile: size("tile"), texture: size("texture"), item: size("item"), ui: size("ui") },
    view: choice(style["view"], VIEWS, "project.style.view"),
    projection: choice(style["projection"], PROJECTIONS, "project.style.projection"),
    directionSet: choice(style["directionSet"], DIRECTION_SETS, "project.style.directionSet"),
    outline: choice(style["outline"], OUTLINES, "project.style.outline"),
    shading: choice(style["shading"], SHADINGS, "project.style.shading"),
    proportions: choice(style["proportions"], PROPORTIONS, "project.style.proportions"),
    references: array(style["references"], "project.style.references").map(value => text(value, "style reference id")),
    ...(style["notes"] === undefined ? {} : { notes: style["notes"] as string }),
  };
}

export function importProjectBundle(raw: unknown): {
  projectId: string; assetIds: Record<string, string>; folderIds: Record<string, string>;
} {
  const bundle = record(raw, "Project bundle");
  if (bundle["format"] !== "zenith.project" || bundle["version"] !== 1) throw new Error("Expected a zenith.project bundle with version 1, as produced by export_project.");
  const project = record(bundle["project"], "project");
  const sourceProjectId = text(project["id"], "project.id");
  const name = text(project["name"], "project.name");
  const style = readStyle(project["style"]);

  const assets = array(bundle["assets"], "assets").map((value, index) => {
    const path = `assets[${String(index)}]`;
    const asset = record(value, path);
    const id = text(asset["id"], `${path}.id`);
    const document = deserializeDocument(asset["document"]);
    if (id !== document.id) throw new Error(`${path}.id does not match its document id.`);
    return { id, document, name: text(asset["name"], `${path}.name`), type: choice(asset["type"], ASSET_TYPES, `${path}.type`) };
  });
  const assetSet = new Set(assets.map(asset => asset.id));
  if (assetSet.size !== assets.length) throw new Error("Duplicate asset id in project bundle.");

  const folders = array(bundle["folders"], "folders").map((value, index): Folder => {
    const path = `folders[${String(index)}]`;
    const folder = record(value, path);
    if (folder["projectId"] !== sourceProjectId) throw new Error(`${path} belongs to another project.`);
    return {
      id: text(folder["id"], `${path}.id`), projectId: sourceProjectId,
      parentId: folder["parentId"] === null ? null : text(folder["parentId"], `${path}.parentId`),
      name: text(folder["name"], `${path}.name`), order: integer(folder["order"], `${path}.order`),
    };
  }).sort((a, b) => a.order - b.order);
  const folderMap = new Map(folders.map(folder => [folder.id, folder]));
  if (folderMap.size !== folders.length) throw new Error("Duplicate folder id in project bundle.");
  for (const folder of folders) {
    const seen = new Set<string>([folder.id]);
    let parentId = folder.parentId;
    while (parentId !== null) {
      if (seen.has(parentId)) throw new Error(`Folder cycle involving '${folder.id}'.`);
      seen.add(parentId);
      const parent = folderMap.get(parentId);
      if (!parent) throw new Error(`Folder '${folder.id}' has missing parent '${parentId}'.`);
      parentId = parent.parentId;
    }
  }

  const placements = array(bundle["placements"], "placements").map((value, index) => {
    const path = `placements[${String(index)}]`;
    const placement = record(value, path);
    const assetId = text(placement["assetId"], `${path}.assetId`);
    const folderId = placement["folderId"] === null ? null : text(placement["folderId"], `${path}.folderId`);
    if (placement["projectId"] !== sourceProjectId || !assetSet.has(assetId) || (folderId !== null && !folderMap.has(folderId))) {
      throw new Error(`${path} points to an asset, folder or project outside this bundle.`);
    }
    return { assetId, folderId };
  });
  if (placements.length !== assets.length || new Set(placements.map(placement => placement.assetId)).size !== assets.length) {
    throw new Error("Each imported asset must have exactly one placement in its project.");
  }
  for (const reference of style.references) if (!assetSet.has(reference)) throw new Error(`Style reference '${reference}' is not included in this bundle.`);

  // Every fallible input check precedes the synchronous commit. Persistence is
  // separate: callers must inspect/flush storage, never infer disk durability here.
  const projectId = projects.createProject(name, { ...style, references: [] });
  projects.openProject(projectId);
  const folderIds = new Map<string, string>();
  // Iterative parent-first insertion also accepts deeply nested valid bundles.
  while (folderIds.size < folders.length) for (const folder of folders) {
    if (folderIds.has(folder.id) || (folder.parentId !== null && !folderIds.has(folder.parentId))) continue;
    const parentId = folder.parentId === null ? null : folderIds.get(folder.parentId)!;
    folderIds.set(folder.id, projects.createFolder(projectId, folder.name, parentId)!);
  }
  const assetIds = new Map(assets.map(asset => [asset.id, session.adopt(asset.document, { name: asset.name, type: asset.type })]));
  for (const placement of placements) projects.place(assetIds.get(placement.assetId)!, projectId, placement.folderId === null ? null : folderIds.get(placement.folderId)!);
  projects.setStyle(projectId, { references: style.references.map(id => assetIds.get(id)!) });
  return { projectId, assetIds: Object.fromEntries(assetIds), folderIds: Object.fromEntries(folderIds) };
}
