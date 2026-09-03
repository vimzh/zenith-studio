// Project imports validate the complete bundle before adding new ids to the live library.
import { beforeEach, expect, test } from "bun:test";
import { session } from "./session";
import { projects } from "./projects";
import { exportProjectBundle } from "./transfer";
import { importProjectBundle } from "./project-import";

beforeEach(() => {
  for (const asset of session.list()) session.close(asset.id);
  for (const project of projects.listProjects()) projects.deleteProject(project.id);
});

function fixture() {
  const projectId = projects.createProject("Moss Hollow", { notes: "Damp forest" });
  const parent = projects.createFolder(projectId, "Characters")!;
  const child = projects.createFolder(projectId, "Merchants", parent)!;
  const assetId = session.create({ name: "Merchant", type: "character", preset: "tile-32" });
  const store = session.get(assetId)!;
  store.setPixels([{ x: 2, y: 3, index: 1 }]);
  store.addFrame();
  store.setFrameDuration(1, 350);
  projects.place(assetId, projectId, child);
  projects.setStyle(projectId, { references: [assetId] });
  return { projectId, assetId, store, parent, child, bundle: exportProjectBundle(projectId) };
}

test("project roundtrip preserves documents, hierarchy and mapped style references without overwrites", () => {
  const { projectId, assetId, store, parent, child, bundle } = fixture();
  const before = store.snapshot();
  const history = store.history();
  const imported = importProjectBundle(bundle);
  expect(imported.projectId).not.toBe(projectId);
  expect(imported.assetIds[assetId]).not.toBe(assetId);
  expect(projects.getFolder(imported.folderIds[child]!)?.parentId).toBe(imported.folderIds[parent]!);
  expect(projects.placementOf(imported.assetIds[assetId]!)).toEqual({ projectId: imported.projectId, folderId: imported.folderIds[child]! });
  expect(projects.getProject(imported.projectId)?.style).toEqual({ ...bundle.project.style, references: [imported.assetIds[assetId]!] });
  expect(session.get(imported.assetIds[assetId]!)!.snapshot()).toEqual({ ...before, id: imported.assetIds[assetId]! });
  expect(session.get(assetId)).toBe(store);
  expect(store.snapshot()).toEqual(before);
  expect(store.history()).toEqual(history);
  expect(projects.listProjects()).toHaveLength(2);
});

for (const failure of ["last document", "duplicate asset", "folder cycle", "missing folder", "missing reference", "invalid style"] as const) {
  test(`invalid ${failure} rejects the whole import without a partial project`, () => {
    const { bundle } = fixture();
    const raw = JSON.parse(JSON.stringify(bundle));
    if (failure === "last document") raw.assets.push({ ...raw.assets[0], id: "bad", document: { ...raw.assets[0].document, width: -1 } });
    if (failure === "duplicate asset") raw.assets.push(raw.assets[0]);
    if (failure === "folder cycle") raw.folders[0].parentId = raw.folders[1].id;
    if (failure === "missing folder") raw.placements[0].folderId = "missing";
    if (failure === "missing reference") raw.project.style.references = ["missing"];
    if (failure === "invalid style") raw.project.style.canvasSizes.character = 0;
    const tree = projects.snapshot();
    const assets = session.list();
    const active = session.activeId;
    expect(() => importProjectBundle(raw)).toThrow();
    expect(projects.snapshot()).toEqual(tree);
    expect(session.list()).toEqual(assets);
    expect(session.activeId).toBe(active);
  });
}

test("empty projects import with their complete style contract", () => {
  const id = projects.createProject("Empty");
  const imported = importProjectBundle(exportProjectBundle(id));
  expect(projects.getProject(imported.projectId)?.style).toEqual(projects.getProject(id)?.style);
  expect(imported.assetIds).toEqual({});
  expect(imported.folderIds).toEqual({});
});
