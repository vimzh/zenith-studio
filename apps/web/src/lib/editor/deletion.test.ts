import { beforeEach, describe, expect, test } from "bun:test";
import { deleteAsset, undoDeleteAsset } from "./deletion";
import { projects } from "./projects";
import { session } from "./session";

/**
 * The document and the placement have to move together.
 *
 * `session.close` knows nothing about the tree, so deleting through it alone
 * left a placement pointing at a document that no longer exists — and that is
 * not inert: the explorer renders one row per id in a folder and falls back to
 * the raw id when the name is gone, so a deleted asset returned as a row
 * reading `asset_007` and the project kept counting it.
 */

beforeEach(() => {
  for (const asset of session.list()) session.close(asset.id);
  for (const project of projects.listProjects()) projects.deleteProject(project.id);
});

describe("deleting an asset", () => {
  test("removes the placement, and undo puts it back in the same folder", () => {
    const projectId = projects.createProject("Moss Hollow");
    const folderId = projects.createFolder(projectId, "Props");
    if (folderId === null) throw new Error("no folder");

    const id = session.create({ name: "Chest", preset: "tile-32" });
    projects.place(id, projectId, folderId);
    expect(projects.assetsIn(projectId, folderId)).toEqual([id]);

    expect(deleteAsset(id)).toBe(true);
    expect(session.get(id)).toBeUndefined();
    expect(projects.assetsIn(projectId, folderId)).toEqual([]);
    expect(projects.placementOf(id)).toEqual({ projectId: null, folderId: null });

    expect(undoDeleteAsset()).toBe(id);
    expect(session.get(id)).toBeDefined();
    expect(projects.assetsIn(projectId, folderId)).toEqual([id]);
  });

  /** A folder deleted meanwhile must not send the restored asset to the loose pool. */
  test("falls back to the project root when the folder is gone", () => {
    const projectId = projects.createProject("Moss Hollow");
    const folderId = projects.createFolder(projectId, "Props");
    if (folderId === null) throw new Error("no folder");

    const id = session.create({ name: "Chest", preset: "tile-32" });
    projects.place(id, projectId, folderId);
    deleteAsset(id);
    expect(projects.deleteFolder(folderId).ok).toBe(true);

    expect(undoDeleteAsset()).toBe(id);
    expect(projects.placementOf(id)).toEqual({ projectId, folderId: null });
  });

  test("a loose asset deletes and restores without a placement", () => {
    const id = session.create({ name: "Loose", preset: "tile-32" });
    expect(deleteAsset(id)).toBe(true);
    expect(undoDeleteAsset()).toBe(id);
    expect(projects.placementOf(id)).toEqual({ projectId: null, folderId: null });
  });

  test("deleting an id that is not in the session changes nothing", () => {
    expect(deleteAsset("asset_missing")).toBe(false);
  });
});
