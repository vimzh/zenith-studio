import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { assetStorage, exportProjectBundle, projects, session, type StorageState } from "@/lib/editor";
import { assetNavigation } from "../navigation";
import { createFolder, flushStorage, getStorageStatus, importProject, listProjectContents, moveAsset, renameProject } from "./project-io";

const restore: (() => void)[] = [];
beforeEach(() => {
  for (const asset of session.list()) session.close(asset.id);
  for (const project of projects.listProjects()) projects.deleteProject(project.id);
  assetNavigation.clear();
});
afterEach(() => { for (const reset of restore.splice(0)) reset(); });

test("external agents can organize and inspect assets without mutating their artwork", async () => {
  const projectId = projects.createProject("Original");
  const id = session.create({ name: "Hero", type: "character" });
  const store = session.get(id)!;
  store.setPixels([{ x: 0, y: 0, index: 1 }]);
  const before = store.snapshot();
  const history = store.history();
  const parent = JSON.parse(await createFolder.execute({ name: "Characters" }));
  const child = JSON.parse(await createFolder.execute({ name: "Merchants", parent_id: parent.id }));
  await moveAsset.execute({ asset_id: id, project_id: projectId, folder_id: child.id });
  await renameProject.execute({ name: "Renamed" });
  const contents = JSON.parse(await listProjectContents.execute({ project_id: projectId }));
  expect(contents.project.name).toBe("Renamed");
  expect(contents.folders).toHaveLength(2);
  expect(contents.assets[0]).toMatchObject({ id, type: "character", projectId, folderId: child.id });
  expect(store.snapshot()).toEqual(before);
  expect(store.history()).toEqual(history);
  expect(assetNavigation.peek()).toBeNull();
});

test("invalid organization requests leave placements and style references unchanged", async () => {
  const projectId = projects.createProject("Source");
  const id = session.create({ name: "Hero" });
  projects.place(id, projectId);
  projects.setStyle(projectId, { references: [id] });
  const another = projects.createProject("Another");
  const wrongFolder = projects.createFolder(another, "Elsewhere")!;
  const before = projects.snapshot();
  expect(() => moveAsset.execute({ asset_id: id, project_id: projectId, folder_id: wrongFolder })).toThrow("Destination");
  expect(() => createFolder.execute({ project_id: projectId, name: "Bad", parent_id: wrongFolder })).toThrow("Parent");
  expect(() => renameProject.execute({ project_id: projectId, name: "  " })).toThrow("non-whitespace");
  expect(projects.snapshot()).toEqual(before);
  const moved = JSON.parse(await moveAsset.execute({ asset_id: id, project_id: null }));
  expect(moved.removed_style_reference_from).toBe(projectId);
  expect(projects.getProject(projectId)!.style.references).toEqual([]);
  expect(projects.placementOf(id)).toEqual({ projectId: null, folderId: null });
});

test("import_project reports in-memory ids and explicitly requests its new project view", async () => {
  const sourceId = projects.createProject("Imported copy");
  const result = JSON.parse(await importProject.execute({ bundle: exportProjectBundle(sourceId) }));
  expect(result.projectId).not.toBe(sourceId);
  expect(result.imported_in_memory).toBe(true);
  expect(result.persistence).toContain("not confirmed");
  expect(assetNavigation.peekProject()).toBe(result.projectId);
});

function mockStorage() {
  let state: StorageState = "ready";
  const previous = Object.getOwnPropertyDescriptor(assetStorage, "state");
  Object.defineProperty(assetStorage, "state", { configurable: true, get: () => state });
  const open = spyOn(assetStorage, "open").mockResolvedValue(true);
  const tree = spyOn(assetStorage, "saveTree").mockResolvedValue();
  const flush = spyOn(assetStorage, "flush").mockResolvedValue();
  restore.push(() => {
    if (previous) Object.defineProperty(assetStorage, "state", previous);
    else Reflect.deleteProperty(assetStorage, "state");
    open.mockRestore(); tree.mockRestore(); flush.mockRestore();
  });
  return { open, tree, flush, setState: (next: StorageState) => { state = next; } };
}

test("storage status is read-only and flush explicitly saves the tree plus queued assets", async () => {
  const { open, tree, flush } = mockStorage();
  expect(JSON.parse(await getStorageStatus.execute({}))).toMatchObject({ state: "ready", browser_local: true });
  expect(open).not.toHaveBeenCalled();
  expect(tree).not.toHaveBeenCalled();
  expect(flush).not.toHaveBeenCalled();
  const result = JSON.parse(await flushStorage.execute({}));
  expect(tree).toHaveBeenCalledWith(projects.snapshot());
  expect(flush).toHaveBeenCalledTimes(1);
  expect(result).toMatchObject({ local_transactions_committed: true, backup_created: false });
});

test("flush fails rather than reporting success for unavailable storage or concurrent changes", async () => {
  const { flush, setState } = mockStorage();
  setState("unavailable");
  await expect(flushStorage.execute({})).rejects.toThrow("Storage unavailable");
  setState("ready");
  flush.mockImplementation(async () => { setState("unavailable"); });
  await expect(flushStorage.execute({})).rejects.toThrow("Storage flush failed");
  setState("ready");
  flush.mockImplementation(async () => { projects.createProject("Changed during flush"); });
  await expect(flushStorage.execute({})).rejects.toThrow("library changed");
});

test("flush rejects strokes during a transaction even though session.revision does not change", async () => {
  const { flush } = mockStorage();
  const id = session.create({ name: "Concurrent stroke" });
  const store = session.get(id)!;
  const revision = session.revision;
  flush.mockImplementation(async () => {
    store.setPixels([{ x: 1, y: 1, index: 1 }]);
    expect(session.revision).toBe(revision);
  });
  await expect(flushStorage.execute({})).rejects.toThrow("library changed");
  expect(store.colorAt(1, 1)).toBe(1);
});

test("flush never confirms local completion while the adapter still reports pending writes", async () => {
  const { flush, setState } = mockStorage();
  flush.mockImplementation(async () => { setState("saving"); });
  await expect(flushStorage.execute({})).rejects.toThrow("pending");
});
