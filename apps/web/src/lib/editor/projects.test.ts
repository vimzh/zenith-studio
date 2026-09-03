import { beforeEach, describe, expect, test } from "bun:test";
import { ProjectLibrary, defaultStyle, resetProjectIds } from "./projects";

/**
 * The tree, and the two ways a tree silently loses things.
 *
 * Both failure modes here are invisible when they happen: a folder moved inside
 * itself disappears from the root walk while still holding assets, and a
 * deleted folder takes its contents with it. Neither throws.
 */

let library: ProjectLibrary;

beforeEach(() => {
  resetProjectIds();
  library = new ProjectLibrary();
});

describe("projects", () => {
  test("a new project starts from the default style and becomes active", () => {
    const id = library.createProject("Moss Hollow");
    expect(library.getProject(id)?.name).toBe("Moss Hollow");
    expect(library.getProject(id)?.style).toEqual(defaultStyle());
    expect(library.activeProjectId).toBe(id);
  });

  test("an unnamed project still gets a name", () => {
    const id = library.createProject("   ");
    expect(library.getProject(id)?.name.length).toBeGreaterThan(0);
  });

  test("style edits merge rather than replace", () => {
    const id = library.createProject("game");
    library.setStyle(id, { view: "high top-down", proportions: "chibi" });

    const style = library.getProject(id)?.style;
    expect(style?.view).toBe("high top-down");
    expect(style?.proportions).toBe("chibi");
    // Untouched fields survive — a partial edit is not a reset.
    expect(style?.outline).toBe(defaultStyle().outline);
    expect(style?.canvasSizes.character).toBe(32);
    expect(style?.palette.colors.length).toBe(16);
  });
});

describe("folders", () => {
  test("nest under a parent in the same project", () => {
    const project = library.createProject("game");
    const scene = library.createFolder(project, "Scene 1");
    if (scene === null) throw new Error("no folder");
    const characters = library.createFolder(project, "Characters", scene);

    expect(characters).not.toBeNull();
    expect(library.getFolder(characters as string)?.parentId).toBe(scene);
  });

  test("refuse a parent belonging to another project", () => {
    const a = library.createProject("a");
    const b = library.createProject("b");
    const inA = library.createFolder(a, "folder");
    if (inA === null) throw new Error("no folder");

    expect(library.createFolder(b, "child", inA)).toBeNull();
  });

  test("the tree nests, roots first", () => {
    const project = library.createProject("game");
    const scene = library.createFolder(project, "Scene 1");
    if (scene === null) throw new Error("no folder");
    library.createFolder(project, "Characters", scene);
    library.createFolder(project, "Scene 2");

    const tree = library.tree(project);
    expect(tree.map((node) => node.folder.name)).toEqual(["Scene 1", "Scene 2"]);
    expect(tree[0]?.children.map((node) => node.folder.name)).toEqual(["Characters"]);
  });
});

describe("moveFolder", () => {
  /**
   * The cycle a drag-and-drop tree makes one careless drop away.
   *
   * Dropping a folder onto its own descendant does not error — it detaches the
   * subtree from the root walk, so the folders and every asset in them vanish
   * from the explorer while still existing. Nothing reports it.
   */
  test("refuses to move a folder inside its own descendant", () => {
    const project = library.createProject("game");
    const outer = library.createFolder(project, "outer");
    if (outer === null) throw new Error("no folder");
    const middle = library.createFolder(project, "middle", outer);
    if (middle === null) throw new Error("no folder");
    const inner = library.createFolder(project, "inner", middle);
    if (inner === null) throw new Error("no folder");

    expect(library.moveFolder(outer, inner)).toBe(false);
    expect(library.moveFolder(outer, middle)).toBe(false);
    expect(library.moveFolder(outer, outer)).toBe(false);

    // Still reachable from the root, which is the property that was at risk.
    expect(library.tree(project).map((node) => node.folder.name)).toEqual(["outer"]);
  });

  test("allows any move that does not close a loop", () => {
    const project = library.createProject("game");
    const a = library.createFolder(project, "a");
    const b = library.createFolder(project, "b");
    if (a === null || b === null) throw new Error("no folder");

    expect(library.moveFolder(b, a)).toBe(true);
    expect(library.moveFolder(b, null)).toBe(true);
    expect(library.tree(project)).toHaveLength(2);
  });
});

describe("deleteFolder", () => {
  test("refuses while anything is inside, and says what", () => {
    const project = library.createProject("game");
    const folder = library.createFolder(project, "Characters");
    if (folder === null) throw new Error("no folder");
    library.place("asset_001", project, folder);

    const result = library.deleteFolder(folder);
    expect(result).toEqual({ ok: false, assets: 1, folders: 0 });
    expect(library.getFolder(folder)).toBeDefined();
  });

  test("deletes once emptied", () => {
    const project = library.createProject("game");
    const folder = library.createFolder(project, "Characters");
    if (folder === null) throw new Error("no folder");
    library.place("asset_001", project, folder);
    library.place("asset_001", project, null);

    expect(library.deleteFolder(folder).ok).toBe(true);
  });
});

describe("placement", () => {
  test("an unplaced asset is loose, not broken", () => {
    expect(library.placementOf("asset_999")).toEqual({ projectId: null, folderId: null });
  });

  test("placing into a folder of another project is refused", () => {
    const a = library.createProject("a");
    const b = library.createProject("b");
    const inA = library.createFolder(a, "folder");
    if (inA === null) throw new Error("no folder");

    expect(library.place("asset_001", b, inA)).toBe(false);
  });

  test("assets at a project root are separate from those in folders", () => {
    const project = library.createProject("game");
    const folder = library.createFolder(project, "Characters");
    if (folder === null) throw new Error("no folder");
    library.place("asset_001", project, null);
    library.place("asset_002", project, folder);

    expect(library.assetsIn(project, null)).toEqual(["asset_001"]);
    expect(library.assetsIn(project, folder)).toEqual(["asset_002"]);
    expect(library.assetsInProject(project)).toHaveLength(2);
  });

  /**
   * Deleting a project must not be able to destroy artwork.
   *
   * The tree is where an asset sits, not what it is. Assets return to the loose
   * pool and stay in the library; the session never hears about it.
   */
  test("deleting a project unplaces its assets rather than destroying them", () => {
    const project = library.createProject("game");
    const folder = library.createFolder(project, "Characters");
    if (folder === null) throw new Error("no folder");
    library.place("asset_001", project, folder);
    library.place("asset_002", project, null);

    expect(library.deleteProject(project)).toBe(2);
    expect(library.placementOf("asset_001")).toEqual({ projectId: null, folderId: null });
    expect(library.getProject(project)).toBeUndefined();
  });
});

describe("inherit", () => {
  /**
   * A derived asset belongs beside the one it came from.
   *
   * `place(id, projectId)` defaults `folderId` to null, so every variation,
   * rotation and tileset landed at the project root while its source sat in a
   * folder. Nothing errored: the set was in the project, just not where the
   * human was reading.
   */
  test("puts a derived asset in the source's folder, not the project root", () => {
    const project = library.createProject("Moss Hollow");
    const props = library.createFolder(project, "Props");
    if (props === null) throw new Error("no folder");
    library.place("chest", project, props);

    expect(library.inherit("chest", "chest_gold")).toBe(true);
    expect(library.placementOf("chest_gold")).toEqual({ projectId: project, folderId: props });
    expect(library.assetsIn(project, props)).toEqual(["chest", "chest_gold"]);
    expect(library.assetsIn(project, null)).toEqual([]);
  });

  test("a loose source leaves the derived asset loose, rather than guessing", () => {
    library.createProject("Moss Hollow");
    expect(library.inherit("loose", "loose_variant")).toBe(false);
    expect(library.placementOf("loose_variant")).toEqual({ projectId: null, folderId: null });
  });

  /**
   * The fallback matters more than it looks: a by-product that fails to place
   * is not an error anywhere, it simply vanishes from the project screen.
   */
  test("falls back to the project root when the folder is gone", () => {
    const project = library.createProject("Moss Hollow");
    const props = library.createFolder(project, "Props");
    if (props === null) throw new Error("no folder");
    library.place("chest", project, props);
    library.unplace("chest");
    library.place("chest", project, props);
    library.deleteFolder(props);
    // The folder still holds the source, so deleteFolder refused it; force the
    // stale state the fallback exists for.
    library.restore({
      projects: library.listProjects(),
      folders: [],
      placements: [{ assetId: "chest", projectId: project, folderId: props }],
    });

    expect(library.inherit("chest", "chest_gold")).toBe(true);
    expect(library.placementOf("chest_gold")).toEqual({ projectId: project, folderId: null });
  });
});

describe("the selected folder", () => {
  /**
   * `create_asset` runs outside React, so the explorer's selection has to live
   * where a tool can read it. Without this a new asset landed at the project
   * root while the human had a folder open, and nothing explained why.
   */
  test("is where a new asset lands", () => {
    const project = library.createProject("Moss Hollow");
    const props = library.createFolder(project, "Props");
    if (props === null) throw new Error("no folder");

    expect(library.activeFolderId).toBeNull();
    expect(library.openFolder(props)).toBe(true);
    expect(library.activeFolderId).toBe(props);

    library.place("chest", project, library.activeFolderId);
    expect(library.assetsIn(project, props)).toEqual(["chest"]);

    expect(library.openFolder(null)).toBe(true);
    library.place("loose_chest", project, library.activeFolderId);
    expect(library.assetsIn(project, null)).toEqual(["loose_chest"]);
  });

  /**
   * A folder id from another project would make `place` refuse, and a refused
   * placement leaves the asset loose — present in the library, absent from the
   * project, reported by nothing.
   */
  test("cannot point outside the open project", () => {
    const first = library.createProject("one");
    const folder = library.createFolder(first, "Props");
    if (folder === null) throw new Error("no folder");
    library.openFolder(folder);

    const second = library.createProject("two");
    expect(library.openProject(second)).toBe(true);
    expect(library.activeFolderId).toBeNull();
    expect(library.openFolder(folder)).toBe(false);
  });

  test("clears when the folder it names is deleted", () => {
    const project = library.createProject("Moss Hollow");
    const folder = library.createFolder(project, "Props");
    if (folder === null) throw new Error("no folder");
    library.openFolder(folder);

    expect(library.deleteFolder(folder).ok).toBe(true);
    expect(library.activeFolderId).toBeNull();
  });
});

describe("persistence", () => {
  test("a snapshot round-trips the whole tree", () => {
    const project = library.createProject("Moss Hollow", { view: "side", shading: "flat" });
    const scene = library.createFolder(project, "Scene 1");
    if (scene === null) throw new Error("no folder");
    const characters = library.createFolder(project, "Characters", scene);
    if (characters === null) throw new Error("no folder");
    library.place("asset_001", project, characters);

    const restored = new ProjectLibrary();
    restored.restore(library.snapshot());

    expect(restored.getProject(project)?.name).toBe("Moss Hollow");
    expect(restored.getProject(project)?.style.view).toBe("side");
    expect(restored.getProject(project)?.style.shading).toBe("flat");
    expect(restored.tree(project)[0]?.children[0]?.folder.name).toBe("Characters");
    expect(restored.assetsIn(project, characters)).toEqual(["asset_001"]);
  });

  /**
   * Ids are handed out from a per-process counter, so a restore that does not
   * advance it hands the next new folder an id that already exists — and a Map
   * set silently overwrites the old one.
   */
  test("restoring advances the id counter so new ids do not collide", () => {
    const project = library.createProject("game");
    const first = library.createFolder(project, "one");
    if (first === null) throw new Error("no folder");

    const snapshot = library.snapshot();
    resetProjectIds();
    const restored = new ProjectLibrary();
    restored.restore(snapshot);

    const second = restored.createFolder(project, "two");
    expect(second).not.toBe(first);
    expect(restored.getFolder(first)?.name).toBe("one");
  });

  test("style fields added later default rather than becoming undefined", () => {
    const restored = new ProjectLibrary();
    restored.restore({
      projects: [
        // A record written before `proportions` existed on the profile.
        { id: "project_001", name: "old", order: 1, style: { view: "side" } as never },
      ],
    });
    const style = restored.getProject("project_001")?.style;
    expect(style?.view).toBe("side");
    // Fields the old record never had come back as defaults, not undefined.
    expect(style?.proportions).toBe(defaultStyle().proportions);
    expect(style?.palette.colors.length).toBe(16);
  });

  /**
   * Workspaces were removed from the model, and every existing browser still
   * has their keys sitting in IndexedDB. Restore has to walk past them rather
   * than throw, or the first load after this change loses the whole tree.
   */
  test("a stored tree from before workspaces were removed still restores", () => {
    const restored = new ProjectLibrary();
    restored.restore({
      projects: [{ id: "project_001", name: "old", order: 1, style: defaultStyle() }],
      folders: [{ id: "folder_001", projectId: "project_001", parentId: null, name: "Characters", order: 2 }],
      placements: [{ assetId: "asset_001", projectId: "project_001", folderId: "folder_001" }],
      workspaces: [{ id: "workspace_001", projectId: "project_001", name: "Hero", order: 3 }],
      workspacePlacements: [{ assetId: "asset_001", workspaceId: "workspace_001", x: 12, y: 34 }],
    } as Parameters<ProjectLibrary["restore"]>[0]);

    expect(restored.getProject("project_001")?.name).toBe("old");
    expect(restored.assetsIn("project_001", "folder_001")).toEqual(["asset_001"]);
    expect(restored.snapshot()).not.toHaveProperty("workspaces");
  });
});

describe("style references follow project membership", () => {
  test("shared place removes a departing exemplar in the same notification as its move", () => {
    const source = library.createProject("Source");
    const destination = library.createProject("Destination");
    library.place("hero", source);
    library.setStyle(source, { references: ["hero"] });
    const snapshots: ReturnType<ProjectLibrary["snapshot"]>[] = [];
    const unsubscribe = library.subscribe(() => snapshots.push(library.snapshot()));
    expect(library.place("hero", destination)).toBe(true);
    unsubscribe();
    expect(library.getProject(source)!.style.references).toEqual([]);
    expect(library.getProject(destination)!.style.references).toEqual([]);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]!.projects.find(project => project.id === source)!.style.references).toEqual([]);
  });

  test("folder moves and invalid destinations preserve the reference", () => {
    const project = library.createProject("Source");
    const folder = library.createFolder(project, "Characters")!;
    library.place("hero", project);
    library.setStyle(project, { references: ["hero"] });
    expect(library.place("hero", project, folder)).toBe(true);
    expect(library.getProject(project)!.style.references).toEqual(["hero"]);
    const before = library.snapshot();
    expect(library.place("hero", "missing")).toBe(false);
    expect(library.place("hero", project, "missing")).toBe(false);
    expect(library.snapshot()).toEqual(before);
  });

  test("shared unplace removes an exemplar without altering other references", () => {
    const project = library.createProject("Source");
    library.place("hero", project);
    library.setStyle(project, { references: ["other", "hero"] });
    expect(library.unplace("hero")).toBe(true);
    expect(library.getProject(project)!.style.references).toEqual(["other"]);
  });
});
