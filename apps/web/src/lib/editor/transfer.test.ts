import { beforeEach, describe, expect, test } from "bun:test";
import { projects, resetProjectIds } from "./projects";
import { session } from "./session";
import { exportProjectBundle } from "./transfer";

describe("project export", () => {
  beforeEach(() => {
    for (const asset of session.list()) session.close(asset.id);
    for (const project of projects.listProjects()) projects.deleteProject(project.id);
    resetProjectIds();
  });

  test("contains only the selected project's assets and its hierarchy", () => {
    const projectId = projects.createProject("Moss Hollow");
    const folderId = projects.createFolder(projectId, "Characters") as string;
    const included = session.create({ name: "Hero" });
    const excluded = session.create({ name: "Loose" });
    projects.place(included, projectId, folderId);

    const bundle = exportProjectBundle(projectId);
    expect(bundle.assets.map((asset) => asset.id)).toEqual([included]);
    expect(bundle.assets.some((asset) => asset.id === excluded)).toBe(false);
    expect(bundle.folders.map((folder) => folder.id)).toEqual([folderId]);
    expect(bundle.placements).toEqual([{ assetId: included, projectId, folderId }]);
    expect(bundle.project.style.palette.colors).toHaveLength(16);
  });
});
