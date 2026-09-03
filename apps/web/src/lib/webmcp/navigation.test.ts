import { beforeEach, expect, test } from "bun:test";
import { projects } from "@/lib/editor";
import { assetNavigation, routeForRequestedAsset, routeForRequestedProject } from "./navigation";
import { createProject, openProject } from "./tools/projects";

beforeEach(() => assetNavigation.clear());

test("explicit asset navigation works from a project view", () => {
  expect(routeForRequestedAsset("/project/project_001", "asset_001")).toBe("/asset/asset_001");
});

test("creating and opening a project request its visible route", async () => {
  await createProject.execute({ name: "Visible project" });
  const id = projects.activeProjectId!;
  expect(assetNavigation.peekProject()).toBe(id);
  expect(routeForRequestedProject("/asset/asset_001", id)).toBe(`/project/${id}`);
  assetNavigation.clear();
  await openProject.execute({ project_id: id });
  expect(assetNavigation.peekProject()).toBe(id);
});

test("latest explicit navigation wins and settings never moves by inference", () => {
  assetNavigation.request("asset_001");
  assetNavigation.requestProject("project_001");
  expect(assetNavigation.peek()).toBeNull();
  expect(assetNavigation.peekProject()).toBe("project_001");
  assetNavigation.request("asset_002");
  expect(assetNavigation.peekProject()).toBeNull();
  expect(assetNavigation.peek()).toBe("asset_002");
  expect(routeForRequestedProject("/settings", "project_001")).toBeNull();
  expect(routeForRequestedProject("/project/project_001", "project_001")).toBeNull();
  expect(routeForRequestedProject("/home", null)).toBeNull();
});
