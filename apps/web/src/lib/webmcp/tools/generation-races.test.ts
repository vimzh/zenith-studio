/** Slow generation must retain its edit target, undo state, and destination. */
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { createDocument, createFrame, createGrid, createLayer, createStore, serializeDocument } from "@zenith/core";
import { projects, session } from "@/lib/editor";
import * as pixel from "@/lib/pixelize";
import * as api from "../api";
import * as raster from "../raster";
import { assetNavigation } from "../navigation";
import { activeDerivationSource, deriveFromSource, drawFromPrompt, generateAsset, generateVariationSet, usedPaletteIndices } from "./generation";
import { buildCharacterFromConcept } from "./authoring";

let started: Promise<void>;
let finishModel: () => void;
let colors: string[];
let restore: (() => void)[];

beforeEach(() => {
  for (const asset of session.list()) session.close(asset.id);
  for (const project of projects.listProjects()) projects.deleteProject(project.id);
  assetNavigation.clear();
  colors = ["#000000"];
  let markStarted: () => void;
  started = new Promise<void>((resolve) => { markStarted = resolve; });
  const model = () => new Promise<{ image: string; model: string }>((resolve) => {
    finishModel = () => resolve({ image: "mock", model: "mock" });
    markStarted();
  });
  const image = pixel.createRaster(32, 32);
  for (let y = 4; y < 28; y++) for (let x = 8; x < 24; x++) {
    const offset = (y * 32 + x) * 4;
    image.data.set([180, 40, 30, 255], offset);
  }
  const mocks = [
    spyOn(api, "generateImage").mockImplementation(model),
    spyOn(api, "deriveImage").mockImplementation(model),
    spyOn(raster, "decodeBase64Png").mockResolvedValue(image),
    spyOn(pixel, "pixelizeAsync").mockImplementation(async () => ({ grid: createGrid(32, 32, 0), palette: colors, confidence: 1, scale: 1, kind: "native", warnings: [], alternatives: [] })),
  ];
  restore = mocks.map((mock) => () => mock.mockRestore());
});

afterEach(() => { for (const reset of restore) reset(); });

function target() {
  const id = session.create({ name: "Drawing target", type: "tile", width: 32, height: 32, palette: ["#000000", "#ffffff"] });
  const store = session.get(id)!;
  store.fillRegion({ x: 0, y: 0, width: 32, height: 32 }, 1);
  return { id, store };
}

function destination(name: string) {
  const projectId = projects.createProject(name);
  const folderId = projects.createFolder(projectId, "Assets")!;
  projects.openFolder(folderId);
  return { projectId, folderId };
}

test("variations use the palette captured with the source PNG, not a later recolour", async () => {
  const { store } = target();
  const source = activeDerivationSource();
  const pending = deriveFromSource(source, "a faithful variation", "Variant");
  await started;
  store.setPalette(["#000000", "#aa44cc"]);
  colors = ["#ffffff"];
  finishModel();
  const result = await pending;
  const output = session.get(result.id)!;
  expect(output.palette.colors.map((color) => color.hex)).toEqual(["#000000", "#ffffff"]);
  expect(output.colorAt(0, 0)).toBe(1);
  expect(store.palette.colors[1]?.hex).toBe("#aa44cc");
});

test("a completed variation is requested before the next model call finishes", async () => {
  const { id, store } = target();
  const before = serializeDocument(store.snapshot());
  let signalSecond!: () => void;
  let finishSecond!: () => void;
  const secondStarted = new Promise<void>((resolve) => { signalSecond = resolve; });
  const derive = spyOn(api, "deriveImage")
    .mockResolvedValueOnce({ image: "first", model: "mock" })
    .mockImplementationOnce(() => new Promise((resolve) => {
      finishSecond = () => resolve({ image: "second", model: "mock" });
      signalSecond();
    }));
  const pending = generateVariationSet.execute({ count: 2, concepts: ["Leather", "Metal"] });
  await secondStarted;
  const first = session.list().find((asset) => asset.id !== id)!;
  try {
    expect(first).toBeDefined();
    expect(session.activeId).toBe(first.id);
    expect(assetNavigation.peek()).toBe(first.id);
    expect(derive.mock.calls[1]?.[0]).toBe(derive.mock.calls[0]?.[0]);
    expect(serializeDocument(store.snapshot())).toEqual(before);
  } finally {
    finishSecond();
    await pending;
  }
  expect(assetNavigation.peek()).toBe(session.activeId);
  expect(session.list()).toHaveLength(3);
});

describe("draw_from_prompt target and undo", () => {
  test("palette planning reserves colors used by hidden layers", () => {
    const store = createStore(createDocument({
      width: 32, height: 32, palette: ["#000000", "#ffffff"],
      frames: [createFrame(32, 32, { layers: [
        createLayer(32, 32, { grid: createGrid(32, 32, 0) }),
        createLayer(32, 32, { grid: createGrid(32, 32, 1), visible: false }),
      ] })],
    }));
    expect([...usedPaletteIndices(store)]).toEqual([0, 1]);
  });

  for (const change of ["pixels", "frame", "asset", "palette"] as const) {
    test(`refuses a ${change} change made while generation is pending`, async () => {
      const { id, store } = target();
      const pending = drawFromPrompt.execute({ prompt: "draw stone" });
      await started;
      if (change === "pixels") store.setPixels([{ x: 0, y: 0, index: 0 }]);
      if (change === "frame") { store.addFrame(); store.selectFrame(1); }
      if (change === "asset") session.create({ name: "Another asset", preset: "tile-32" });
      if (change === "palette") session.recolor(id, ["#333333", "#eeeeee"]);
      const before = serializeDocument(session.get(id)!.snapshot());
      const history = session.get(id)!.history();
      finishModel();
      await expect(pending).rejects.toThrow("changed");
      expect(serializeDocument(session.get(id)!.snapshot())).toEqual(before);
      expect(session.get(id)!.history()).toEqual(history);
    });
  }

  test("palette and pixels undo together without replacing the store or prior history", async () => {
    const { id, store } = target();
    store.addFrame();
    store.selectFrame(1);
    store.fillRegion({ x: 0, y: 0, width: 32, height: 32 }, 0);
    const before = serializeDocument(store.snapshot());
    const history = store.history();
    colors = ["#ff0000"];
    const pending = drawFromPrompt.execute({ prompt: "draw a red shield" });
    await started;
    finishModel();
    await pending;
    expect(session.get(id)).toBe(store);
    expect(store.activeFrame).toBe(1);
    expect(store.palette.colors.map((color) => color.hex)).toContain("#ff0000");
    expect(store.history()).toEqual([...history, "draw_from_prompt"]);
    expect(store.undo()).toBe("draw_from_prompt");
    expect(serializeDocument(store.snapshot())).toEqual(before);
    expect(store.history()).toEqual(history);
  });

  test("unchanged artwork does not promise an undo that would remove the preceding edit", async () => {
    const { store } = target();
    colors = ["#ffffff"];
    const history = store.history();
    const revision = store.revision;
    const pending = drawFromPrompt.execute({ prompt: "white block" });
    await started;
    finishModel();
    await expect(pending).rejects.toThrow("No undo entry was created");
    expect(store.history()).toEqual(history);
    expect(store.revision).toBe(revision);
  });
});

describe("new generation destinations", () => {
  for (const kind of ["prompt", "concept"] as const) {
    function run() {
      return kind === "prompt"
        ? generateAsset.execute({ prompt: "stone", name: "Generated stone", type: "tile" })
        : buildCharacterFromConcept({ image: "AA==", name: "Generated hero", direction_set: "cardinal4", base_direction: "south", target_width: 32 });
    }

    test(`${kind} output stays in the project and folder where it started`, async () => {
      const original = destination("Original project");
      const pending = run();
      await started;
      destination("Visited while waiting");
      finishModel();
      await pending;
      const output = session.list()[0];
      expect(output).toBeDefined();
      expect(projects.placementOf(output!.id)).toEqual(original);
    });

    for (const removed of ["project", "folder"] as const) {
      test(`${kind} refuses a deleted destination ${removed} before creating assets`, async () => {
        const original = destination("Deleted destination");
        const pending = run();
        await started;
        if (removed === "project") projects.deleteProject(original.projectId);
        else expect(projects.deleteFolder(original.folderId).ok).toBe(true);
        finishModel();
        await expect(pending).rejects.toThrow("destination");
        expect(session.list()).toHaveLength(0);
      });
    }
  }
});
