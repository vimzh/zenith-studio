// Project organization, additive interchange, and explicit local persistence for external agents.
import { createPalette, createStyleProfile } from "@zenith/core";
import { assetStorage, projects, session, undoDeleteAsset } from "@/lib/editor";
import { importProjectBundle } from "@/lib/editor/project-import";
import { readOptionalString, readString } from "../args";
import { assetNavigation } from "../navigation";
import { ToolError, type ToolArgs, type ToolDefinition } from "../types";
import { toToolError } from "./active";

function projectId(args: ToolArgs): string {
  const id = readOptionalString(args, "project_id") ?? projects.activeProjectId;
  if (id === null || !projects.getProject(id)) throw new ToolError("No matching project. Call list_projects, then pass project_id or open_project first.");
  return id;
}

function name(args: ToolArgs): string {
  const value = readString(args, "name").trim();
  if (value === "") throw new ToolError("name must contain a non-whitespace character.");
  return value;
}

const optionalProject = { type: "string", description: "Project id; defaults to the open project." };

export const listProjectContents: ToolDefinition = {
  scope: "always", name: "list_project_contents", readOnly: true,
  description: "Read the specified or open project's folders and asset placements, types and dimensions. Returns IDs for organization and open_asset without navigating.",
  inputSchema: { type: "object", properties: { project_id: optionalProject } }, example: {},
  execute: args => {
    const id = projectId(args);
    const project = projects.getProject(id)!;
    return JSON.stringify({
      project: { id, name: project.name, style_references: project.style.references }, folders: projects.listFolders(id),
      assets: session.list().filter(asset => projects.placementOf(asset.id).projectId === id).map(asset => ({ ...asset, ...projects.placementOf(asset.id) })),
    });
  },
};

export const moveAsset: ToolDefinition = {
  scope: "always", name: "move_asset",
  description: "Move an asset to a project/folder, or project_id:null for the loose library. Artwork/history unchanged; no navigation. Departing style references are removed and reported.",
  inputSchema: { type: "object", properties: {
    asset_id: { type: "string" }, project_id: { type: ["string", "null"] }, folder_id: { type: ["string", "null"], description: "Destination folder; omit or null for the project root." },
  }, required: ["asset_id", "project_id"] }, example: { asset_id: "asset_001", project_id: "project_001" },
  execute: args => {
    const assetId = readString(args, "asset_id");
    if (!session.has(assetId)) throw new ToolError(`No asset '${assetId}'. Call list_assets first.`);
    const destination = args["project_id"] === null ? null : readString(args, "project_id");
    const folderId = args["folder_id"] === null ? null : readOptionalString(args, "folder_id") ?? null;
    const source = projects.placementOf(assetId);
    const removedReference = source.projectId !== null && source.projectId !== destination && projects.getProject(source.projectId)?.style.references.includes(assetId)
      ? source.projectId : null;
    if (destination === null) {
      if (folderId !== null) throw new ToolError("A loose asset cannot have a folder. Pass folder_id:null or omit it.");
      projects.unplace(assetId);
    } else if (!projects.place(assetId, destination, folderId)) {
      throw new ToolError("Destination project or folder does not exist, or the folder belongs to another project. Call list_project_contents first.");
    }
    return JSON.stringify({ asset_id: assetId, ...projects.placementOf(assetId), removed_style_reference_from: removedReference, artwork_unchanged: true });
  },
};

export const createFolder: ToolDefinition = {
  scope: "always", name: "create_folder",
  description: "Create a folder in the specified or open project, optionally under parent_id. Returns its ID; selection and assets are unchanged. Invalid parents fail before creation.",
  inputSchema: { type: "object", properties: { project_id: optionalProject, name: { type: "string" }, parent_id: { type: ["string", "null"] } }, required: ["name"] }, example: { name: "Characters" },
  execute: args => {
    const id = projectId(args);
    const parentId = args["parent_id"] === null ? null : readOptionalString(args, "parent_id") ?? null;
    const folderId = projects.createFolder(id, name(args), parentId);
    if (folderId === null) throw new ToolError("Parent folder does not exist in this project. Call list_project_contents for valid ids.");
    return JSON.stringify(projects.getFolder(folderId));
  },
};

export const renameProject: ToolDefinition = {
  scope: "always", name: "rename_project",
  description: "Rename the specified or open project with a non-empty name. ID, style, folders and artwork remain unchanged; no navigation or duplicate project.",
  inputSchema: { type: "object", properties: { project_id: optionalProject, name: { type: "string" } }, required: ["name"] }, example: { name: "Moss Hollow" },
  execute: args => {
    const id = projectId(args);
    projects.renameProject(id, name(args));
    return JSON.stringify({ project_id: id, name: projects.getProject(id)!.name });
  },
};

export const renameFolder: ToolDefinition = {
  scope: "library", name: "rename_folder",
  description: "Rename a folder in the open project with a non-empty name. Its ID, parent, contents and every asset placement are unchanged. Library screen only; folders are structure, not artwork.",
  inputSchema: { type: "object", properties: { folder_id: { type: "string" }, name: { type: "string" } }, required: ["folder_id", "name"] }, example: { folder_id: "folder_001", name: "Enemies" },
  execute: args => {
    const folderId = readString(args, "folder_id");
    if (!projects.renameFolder(folderId, name(args))) {
      throw new ToolError(`No folder '${folderId}'. Call list_project_contents for valid ids.`);
    }
    return JSON.stringify(projects.getFolder(folderId));
  },
};

export const deleteFolder: ToolDefinition = {
  scope: "library", name: "delete_folder",
  description: "Delete an empty folder. Refuses while it holds assets or subfolders and reports how many of each, because a recursive delete would need one undo entry per asset and the session holds one. Move the contents with move_asset first.",
  inputSchema: { type: "object", properties: { folder_id: { type: "string" } }, required: ["folder_id"] }, example: { folder_id: "folder_001" },
  execute: args => {
    const folderId = readString(args, "folder_id");
    const outcome = projects.deleteFolder(folderId);
    if (outcome.ok) return JSON.stringify({ folder_id: folderId, deleted: true });
    if (outcome.assets === 0 && outcome.folders === 0) {
      throw new ToolError(`No folder '${folderId}'. Call list_project_contents for valid ids.`);
    }
    throw new ToolError(
      `Folder '${folderId}' still holds ${String(outcome.assets)} asset(s) and ${String(outcome.folders)} subfolder(s). ` +
        `Move them with move_asset, or delete them, then retry.`,
    );
  },
};

export const deleteProject: ToolDefinition = {
  scope: "library", name: "delete_project",
  description: "Delete a project and its folders. Artwork is never destroyed: every asset inside returns to the loose pool and stays in the library, so this removes structure only. Returns how many assets were unplaced. Not undoable, unlike delete_asset.",
  inputSchema: { type: "object", properties: { project_id: optionalProject }, required: [] }, example: {},
  execute: args => {
    const id = projectId(args);
    const unplaced = projects.deleteProject(id);
    return JSON.stringify({ project_id: id, deleted: true, assets_unplaced: unplaced, artwork_destroyed: false });
  },
};

export const undoDelete: ToolDefinition = {
  scope: "library", name: "undo_delete",
  description: "Restore the most recently deleted asset, putting it back in the folder it came from. Only the last deletion is recoverable, and only until another one replaces it. This is the undo delete_asset points at, so an agent can reverse its own mistake.",
  inputSchema: { type: "object", properties: {}, required: [] }, example: {},
  execute: () => {
    const id = undoDeleteAsset();
    if (id === null) throw new ToolError("Nothing to restore: no asset has been deleted, or the last deletion was already restored.");
    const summary = session.list().find(asset => asset.id === id);
    return JSON.stringify({ asset_id: id, name: summary?.name ?? id, ...projects.placementOf(id) });
  },
};

export const importProject: ToolDefinition = {
  scope: "always", name: "import_project",
  description: "Import a complete zenith.project v1 bundle. Fully validate before adding fresh project/asset/folder IDs; never overwrite. Returns ID mappings and opens the project route. In-memory success only; call flush_storage separately.",
  inputSchema: { type: "object", properties: { bundle: { type: "object", description: "The complete exported zenith.project JSON object, not a URL or path." } }, required: ["bundle"] },
  example: { bundle: { format: "zenith.project", version: 1, project: { id: "project_001", name: "Example", style: createStyleProfile(createPalette({ colors: ["#000000", "#ffffff"] })) }, folders: [], assets: [], placements: [] } },
  execute: args => {
    try {
      const result = importProjectBundle(args["bundle"]);
      assetNavigation.requestProject(result.projectId);
      return JSON.stringify({ ...result, imported_in_memory: true, persistence: "not confirmed; call flush_storage" });
    } catch (error) { throw toToolError(error); }
  },
};

export const getStorageStatus: ToolDefinition = {
  scope: "always", name: "get_storage_status", readOnly: true,
  description: "Read local IndexedDB state/reason without writes: unknown=not opened, saving=pending, unavailable=memory-only. Ready is current adapter status, not a backup or cross-browser access.",
  inputSchema: { type: "object", properties: {} }, example: {},
  execute: () => JSON.stringify({ backend: "IndexedDB", state: assetStorage.state, reason: assetStorage.reason, browser_local: true }),
};

export const flushStorage: ToolDefinition = {
  scope: "always", name: "flush_storage",
  description: "Save the project tree and await queued/in-flight asset writes to local IndexedDB. Fails if unavailable or edits occur during flush; retry after editing stops. Confirms local transactions, not backups or cloud sync.",
  inputSchema: { type: "object", properties: {} }, example: {},
  execute: async () => {
    if (assetStorage.state === "unavailable" || !(await assetStorage.open())) throw new ToolError(`Storage unavailable: ${assetStorage.reason ?? "IndexedDB could not open"}. Work remains in memory; export a project backup.`);
    const sessionRevision = session.revision;
    const projectRevision = projects.revision;
    const artwork = session.list().map(({ id }) => {
      const store = session.get(id)!;
      return { id, store, revision: store.revision };
    });
    await assetStorage.saveTree(projects.snapshot());
    await assetStorage.flush();
    if ((assetStorage.state as string) === "unavailable") throw new ToolError(`Storage flush failed: ${assetStorage.reason ?? "local writes did not commit"}. Work remains in memory.`);
    if (session.revision !== sessionRevision || projects.revision !== projectRevision || artwork.some(({ id, store, revision }) => session.get(id) !== store || store.revision !== revision)) {
      throw new ToolError("The library changed while storage was flushing. Some writes may remain; call flush_storage again after edits finish.");
    }
    if (assetStorage.state !== "ready") throw new ToolError("Storage still reports pending writes. Call flush_storage again after edits finish.");
    return JSON.stringify({ state: assetStorage.state, local_transactions_committed: true, backup_created: false });
  },
};
