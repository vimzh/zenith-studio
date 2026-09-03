/** Direction tools must keep the human's asset, source, and project aligned. */
import { afterEach, beforeEach, describe, expect, spyOn, test, type Mock } from "bun:test";
import { encodeGrid, gridFromRows } from "@zenith/core";
import { projects, session } from "@/lib/editor";
import { DIRECTION_SETS } from "@/lib/directions";
import { assetNavigation } from "../navigation";
import * as generation from "./generation";
import { deriveDirectionByMirror, generateDirectionSet, getDirections, rotateCharacter, selectDirection } from "./directions";

let derive: Mock<typeof generation.deriveFromSource>;
let deriveBatch: Mock<typeof generation.deriveFromSources>;

function character(name: string, projectId?: string): string {
  const id = session.create({ name, type: "character", width: 2, height: 2, palette: ["#000000", "#ffffff"], grid: gridFromRows(["01", ".."]) });
  if (projectId !== undefined) projects.place(id, projectId);
  return id;
}

beforeEach(() => {
  derive = spyOn(generation, "deriveFromSource");
  // The set buys its views as one batch; in tests each request goes through
  // the single-derivation mock in order, so call counts and once-only
  // implementations keep their meaning.
  deriveBatch = spyOn(generation, "deriveFromSources").mockImplementation(async (requests) => {
    const results: PromiseSettledResult<Awaited<ReturnType<typeof generation.deriveFromSource>>>[] = [];
    for (const request of requests) {
      try {
        results.push({ status: "fulfilled", value: await derive(request.source, request.instruction, request.name, request.mode) });
      } catch (reason) {
        results.push({ status: "rejected", reason });
      }
    }
    return results;
  });
  for (const asset of session.list()) session.close(asset.id);
  for (const project of projects.listProjects()) projects.deleteProject(project.id);
  assetNavigation.clear();
  derive.mockImplementation(async (source, _instruction, name) => {
    const id = session.create({ name, type: source.summary.type, width: source.store.width, height: source.store.height, palette: source.store.palette.colors.map((color) => color.hex), grid: source.store.readComposite() });
    projects.inherit(source.id, id);
    return { id, name, message: `Created ${id}.` };
  });
  derive.mockClear();
  deriveBatch.mockClear();
});

afterEach(() => { derive.mockRestore(); });

describe("direction lookup", () => {
  test("listing and selection never borrow a same-named direction from another project", () => {
    const other = projects.createProject("Other game");
    character("Hero east", other);
    const current = projects.createProject("Current game");
    const south = character("Hero south", current);
    expect(getDirections.execute({ set: "side2" })).toContain("Directions for 'Hero': none.");
    expect(() => selectDirection.execute({ direction: "east" })).toThrow("No east direction");
    expect(session.activeId).toBe(south);
  });

  test("mirroring reads the current project's source and keeps its placement", () => {
    const other = projects.createProject("Other game");
    const foreign = character("Hero east", other);
    session.get(foreign)?.fillRegion({ x: 0, y: 0, width: 2, height: 2 }, 1);
    const current = projects.createProject("Current game");
    const east = character("Hero east", current);
    deriveDirectionByMirror.execute({ from_direction: "east", to_direction: "west" });
    expect(session.active?.encode()).toBe("10\n..");
    expect(projects.placementOf(session.activeId!)).toEqual(projects.placementOf(east));
    expect(assetNavigation.peek()).toBe(session.activeId);
  });
});

describe("rotation source and navigation", () => {
  test("a failed rotation leaves the currently viewed direction open", async () => {
    const south = character("Hero south");
    const east = character("Hero east");
    derive.mockImplementation(async (source) => {
      expect(source.id).toBe(south);
      throw new Error("generation failed");
    });
    await expect(rotateCharacter.execute({ from_direction: "south", to_direction: "north" })).rejects.toThrow("generation failed");
    expect(session.activeId).toBe(east);
    expect(assetNavigation.peek()).toBeNull();
  });

  test("successful rotation requests the created asset and tells the model both views", async () => {
    character("Hero south");
    await rotateCharacter.execute({ from_direction: "south", from_view: "high top-down", to_direction: "east", to_view: "side" });
    expect(derive).toHaveBeenCalledTimes(1);
    expect(derive.mock.calls[0]?.[1]).toContain("high top-down");
    expect(derive.mock.calls[0]?.[1]).toContain("side");
    expect(derive.mock.calls[0]?.[1]).toContain("screen-right");
    expect(derive.mock.calls[0]?.[3]).toBe("rotate");
    expect(assetNavigation.peek()).toBe(session.activeId);
    expect(session.list().find((asset) => asset.id === session.activeId)?.name).toBe("Hero east");
  });

  test("successful rotation requests navigation even when no view arguments are supplied", async () => {
    character("Hero south");
    await rotateCharacter.execute({ from_direction: "south", to_direction: "west" });
    expect(assetNavigation.peek()).toBe(session.activeId);
    expect(derive.mock.calls[0]?.[1]).toContain("screen-left");
  });

  test("invalid source views fail before any generation", async () => {
    character("Hero south");
    await expect(rotateCharacter.execute({ from_direction: "south", from_view: "overhead-ish", to_direction: "east" })).rejects.toThrow("from_view");
    expect(derive).not.toHaveBeenCalled();
  });

  test("a direction-labelled asset cannot silently stand in for a missing source", async () => {
    character("Hero east");
    await expect(rotateCharacter.execute({ from_direction: "south", to_direction: "north" })).rejects.toThrow("No south source");
    expect(derive).not.toHaveBeenCalled();
  });
});

describe("complete direction sets", () => {
  test("a named east-facing base completes side2 without paying for a new base", async () => {
    character("Hero east");
    expect(await generateDirectionSet.execute({ set: "side2" })).toContain("west (mirror)");
    expect(await generateDirectionSet.execute({ set: "side2" })).toBe("The side2 set is already complete.");
    expect(derive).not.toHaveBeenCalled();
  });

  for (const set of ["side2", "cardinal4", "ordinal8"] as const) {
    test(`${set} produces every direction, keeps its palette, and prefers exact mirrors`, async () => {
      const projectId = projects.createProject("Current game");
      const source = character("Hero", projectId);
      await generateDirectionSet.execute({ set, base_direction: "south", view: "side" });
      expect(derive).toHaveBeenCalledTimes(set === "side2" ? 1 : set === "cardinal4" ? 2 : 4);
      for (const direction of DIRECTION_SETS[set]) {
        const asset = session.list().find((item) => item.name === `Hero ${direction}`);
        expect(asset).toBeDefined();
        expect(projects.placementOf(asset!.id)).toEqual(projects.placementOf(source));
        expect(session.get(asset!.id)?.palette.colors.map((color) => color.hex)).toEqual(["#000000", "#ffffff"]);
      }
      const east = session.list().find((item) => item.name === "Hero east")!;
      const west = session.list().find((item) => item.name === "Hero west")!;
      expect(encodeGrid(session.get(west.id)!.readComposite())).toBe("10\n..");
      expect(session.get(east.id)?.encode()).toBe("01\n..");
      expect(assetNavigation.peek()).toBe(session.activeId);
    });
  }

  test("a failed view is reported after the others are generated and mirrored, and the last created stays visible", async () => {
    character("Hero south");
    character("Hero east");
    const original = derive.getMockImplementation()!;
    derive.mockImplementationOnce(original).mockImplementationOnce(async () => { throw new Error("second generation failed"); });
    await expect(generateDirectionSet.execute({ set: "ordinal8", base_direction: "south" })).rejects.toThrow("north-east: second generation failed");
    // One batch: north, north-east and south-east were requested together; west mirrored from east, south-west from south-east.
    expect(deriveBatch).toHaveBeenCalledTimes(1);
    expect(deriveBatch.mock.calls[0]?.[0].map((request) => request.name)).toEqual(["Hero north", "Hero north-east", "Hero south-east"]);
    const names = session.list().map((asset) => asset.name);
    for (const name of ["Hero north", "Hero south-east", "Hero west", "Hero south-west"]) expect(names).toContain(name);
    expect(names).not.toContain("Hero north-east");
    expect(names).not.toContain("Hero north-west");
    expect(session.list().find((asset) => asset.id === session.activeId)?.name).toBe("Hero south-west");
    expect(assetNavigation.peek()).toBe(session.activeId);
  });

  test("the views of a set are bought as one batch, not one after another", async () => {
    character("Hero south");
    await generateDirectionSet.execute({ set: "cardinal4", base_direction: "south" });
    expect(deriveBatch).toHaveBeenCalledTimes(1);
    expect(deriveBatch.mock.calls[0]?.[0].map((request) => [request.name, request.mode])).toEqual([["Hero north", "rotate"], ["Hero east", "rotate"]]);
  });
});
