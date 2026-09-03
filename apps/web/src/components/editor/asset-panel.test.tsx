/** Direction costs must describe all existing same-project sprites, not one. */
import { beforeEach, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { projects, session } from "@/lib/editor";
import { AssetPanel } from "./asset-panel";
import type { SkeletonController } from "./use-skeleton-rig";

/** No skeleton open: what the panel shows before Estimate is pressed. */
const closedSkeleton: SkeletonController = {
  pose: null,
  base: null,
  type: "bipedal",
  facing: "east",
  estimate: () => "",
  hide: () => {},
  reset: () => {},
  setPose: () => {},
  setFacing: () => {},
  applyTemplatePose: () => {},
  bake: () => "",
  buildCycle: () => "",
};

beforeEach(() => {
  for (const asset of session.list()) session.close(asset.id);
  for (const project of projects.listProjects()) projects.deleteProject(project.id);
});

function panel(directions: readonly string[]): string {
  const projectId = projects.createProject("Directions UI");
  for (const direction of directions) {
    const id = session.create({ name: `Hero ${direction}`, type: "character", preset: "tile-32" });
    projects.place(id, projectId);
  }
  return renderToStaticMarkup(<AssetPanel assetId={session.activeId!} store={session.active!} type="character" selection={null} skeleton={closedSkeleton} />);
}

test("an existing cardinal trio needs only its missing mirror", () => {
  const markup = panel(["south", "north", "east", "north-east"]);
  expect(markup).toContain("1 free by mirroring, 0 need a model");
});

test("a complete set reports completion instead of a model cost", () => {
  const markup = panel(["north", "east", "south", "west"]);
  expect(markup).toContain("cardinal4 is complete");
  expect(markup).not.toContain("need a model");
});
