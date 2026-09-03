// Asset routes reconcile both hydrated stores without navigating or reviving an obsolete route.
import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { assetNavigation } from "@/lib/webmcp/navigation";
import * as projectModule from "./projects";
import { projects } from "./projects";
import { session } from "./session";
import { activateAssetRoute } from "./activate-asset-route";

const restore: (() => void)[] = [];
beforeEach(() => {
  for (const asset of session.list()) session.close(asset.id);
  for (const project of projects.listProjects()) projects.deleteProject(project.id);
  assetNavigation.clear();
  const assets = spyOn(session, "hydrate").mockResolvedValue();
  const tree = spyOn(projectModule, "hydrateProjects").mockResolvedValue();
  restore.push(() => assets.mockRestore(), () => tree.mockRestore());
});
afterEach(() => { for (const reset of restore.splice(0)) reset(); });

function fixture() {
  const firstProject = projects.createProject("First stored project");
  const firstAsset = session.create({ name: "First asset" });
  projects.place(firstAsset, firstProject);
  const secondProject = projects.createProject("Deep linked project");
  const folder = projects.createFolder(secondProject, "Characters")!;
  const secondAsset = session.create({ name: "Deep linked asset" });
  projects.place(secondAsset, secondProject, folder);
  projects.openProject(firstProject);
  session.open(firstAsset);
  return { firstProject, firstAsset, secondProject, secondAsset, folder };
}

function pending() {
  let resolve!: () => void;
  return { promise: new Promise<void>(done => { resolve = done; }), resolve: () => resolve() };
}

test("deep link waits for both hydrations, then selects the asset's project instead of restore's first project", async () => {
  const { firstProject, firstAsset, secondProject, secondAsset } = fixture();
  const tree = projects.snapshot();
  const assetsReady = pending();
  const projectsReady = pending();
  spyOn(session, "hydrate").mockImplementation(() => assetsReady.promise);
  spyOn(projectModule, "hydrateProjects").mockImplementation(async () => { await projectsReady.promise; projects.restore(tree); });
  const activation = activateAssetRoute(secondAsset, () => true);
  assetsReady.resolve();
  await Promise.resolve();
  expect(session.activeId).toBe(firstAsset);
  projectsReady.resolve();
  expect(await activation).toBe(true);
  expect(firstProject).not.toBe(secondProject);
  expect(projects.activeProjectId).toBe(secondProject);
  expect(session.activeId).toBe(secondAsset);
  expect(assetNavigation.peek()).toBeNull();
  expect(assetNavigation.peekProject()).toBeNull();
});

test("a cancelled hydration callback cannot reopen the route being left", async () => {
  const { firstAsset, secondAsset, secondProject } = fixture();
  const tree = projects.snapshot();
  const ready = pending();
  const hydration = ready.promise.then(() => { projects.restore(tree); });
  spyOn(projectModule, "hydrateProjects").mockImplementation(() => hydration);
  let current = true;
  const obsolete = activateAssetRoute(firstAsset, () => current);
  current = false;
  const latest = activateAssetRoute(secondAsset, () => true);
  ready.resolve();
  expect(await obsolete).toBe(false);
  expect(await latest).toBe(true);
  expect(session.activeId).toBe(secondAsset);
  expect(projects.activeProjectId).toBe(secondProject);
});

test("same-project activation preserves the selected folder", async () => {
  const { secondProject, secondAsset, folder } = fixture();
  projects.openProject(secondProject);
  projects.openFolder(folder);
  await activateAssetRoute(secondAsset, () => true);
  expect(projects.activeFolderId).toBe(folder);
});

test("a loose asset explicitly clears unrelated project and folder context", async () => {
  const { secondProject, folder } = fixture();
  projects.openProject(secondProject);
  projects.openFolder(folder);
  const loose = session.create({ name: "Loose asset" });
  await activateAssetRoute(loose, () => true);
  expect(session.activeId).toBe(loose);
  expect(projects.activeProjectId).toBeNull();
  expect(projects.activeFolderId).toBeNull();
});

test("missing assets do not replace the currently active context", async () => {
  const { firstAsset, firstProject } = fixture();
  expect(await activateAssetRoute("missing", () => true)).toBe(false);
  expect(session.activeId).toBe(firstAsset);
  expect(projects.activeProjectId).toBe(firstProject);
});
