import { beforeEach, describe, expect, test } from "bun:test";
import { projects, session } from "@/lib/editor";
import { checkStyleConsistencyTool, conformToStyleTool, setStyleProfile } from "./tools/projects";
import { deriveDirectionByMirror } from "./tools/directions";

describe("project style tools end to end", () => {
  beforeEach(() => {
    for (const asset of session.list()) session.close(asset.id);
    for (const project of projects.listProjects()) projects.deleteProject(project.id);
  });

  test("check → conform → re-check fixes palette colours and size", async () => {
    const projectId = projects.createProject("Moss Hollow");
    const id = session.create({ name: "Wrong slime", palette: ["#ff00ff"], width: 8, height: 8 });
    session.active?.fillRegion({ x: 0, y: 0, width: 8, height: 8 }, 0);
    projects.place(id, projectId);

    const before = String(await checkStyleConsistencyTool.execute({}));
    expect(before).toContain("[palette]");
    expect(before).toContain("[size]");
    expect(before).toContain("(0, 0)");

    expect(String(await conformToStyleTool.execute({}))).toContain("1 asset(s)");
    expect(String(await checkStyleConsistencyTool.execute({}))).toContain("conforms to the project style");
    expect(session.active?.width).toBe(32);
  });

  test("changing the palette names every newly violating asset", async () => {
    const projectId = projects.createProject("Moss Hollow");
    const first = session.create({ name: "Hero", preset: "tile-32" });
    session.active?.fillRegion({ x: 0, y: 0, width: 1, height: 1 }, 0);
    projects.place(first, projectId);
    const second = session.create({ name: "Enemy", preset: "tile-32" });
    session.active?.fillRegion({ x: 0, y: 0, width: 1, height: 1 }, 0);
    projects.place(second, projectId);

    const result = String(await setStyleProfile.execute({ colors: ["#ffffff"] }));
    expect(result).toContain(first);
    expect(result).toContain(second);
  });
});

/**
 * Where a by-product lands, asserted through a tool rather than through the model.
 *
 * The mirror is the free, deterministic member of the derived-asset family, so
 * it is the one that can be tested without buying an image — and it was the
 * worst offender: it placed nothing at all, so a mirrored direction left the
 * project entirely for the loose pool while the human watched it appear in the
 * library. Every other derived creator now shares this rule.
 */
describe("derived assets land beside their source", () => {
  beforeEach(() => {
    for (const asset of session.list()) session.close(asset.id);
    for (const project of projects.listProjects()) projects.deleteProject(project.id);
  });

  test("a duplicate lands beside the asset it copied", () => {
    const projectId = projects.createProject("Moss Hollow");
    const folderId = projects.createFolder(projectId, "Props");
    if (folderId === null) throw new Error("no folder");

    const source = session.create({ name: "Chest", type: "item", preset: "tile-32" });
    projects.place(source, projectId, folderId);

    const copy = session.duplicate(source);
    if (copy === null) throw new Error("duplicate made nothing");
    projects.inherit(source, copy);

    expect(projects.placementOf(copy)).toEqual({ projectId, folderId });
  });

  test("a mirrored direction inherits the source's project and folder", async () => {
    const projectId = projects.createProject("Moss Hollow");
    const folderId = projects.createFolder(projectId, "Characters");
    if (folderId === null) throw new Error("no folder");

    const source = session.create({ name: "Hero east", type: "character", preset: "tile-32" });
    session.open(source);
    session.active?.fillRegion({ x: 2, y: 2, width: 6, height: 6 }, 3);
    projects.place(source, projectId, folderId);

    await deriveDirectionByMirror.execute({ from_direction: "east", to_direction: "west" });

    const west = session.list().find((asset) => asset.name === "Hero west");
    if (west === undefined) throw new Error("the mirror created no asset");
    expect(projects.placementOf(west.id)).toEqual({ projectId, folderId });
  });
});
