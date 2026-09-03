// Re-pixelisation creates a correctly indexed copy without touching source history.
import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { createDocument, createFrame, createGrid, createLayer } from "@zenith/core";
import { projects, session } from "@/lib/editor";
import * as pixel from "@/lib/pixelize";
import { assetNavigation } from "../navigation";
import { pixelizeCanvas } from "./generation";

let result: pixel.PixelizeResult;
let duringPixelize: () => void;
let restore: () => void;

beforeEach(() => {
  for (const asset of session.list()) session.close(asset.id);
  for (const project of projects.listProjects()) projects.deleteProject(project.id);
  assetNavigation.clear();
  duringPixelize = () => {};
  const mock = spyOn(pixel, "pixelizeAsync").mockImplementation(async (image, options) => {
    result = pixel.pixelize(image, options);
    duringPixelize();
    return result;
  });
  restore = () => mock.mockRestore();
});

afterEach(() => restore());

function fixture() {
  const base = createGrid(64, 64, 0);
  const overlay = createGrid(64, 64);
  for (let y = 16; y < 48; y++) for (let x = 16; x < 48; x++) {
    overlay.cells[y * 64 + x] = 1;
  }
  const id = session.adopt(createDocument({
    name: "Merchant", width: 64, height: 64,
    palette: ["#ffffff", "#000000", "#ff0000"],
    frames: [
      createFrame(64, 64, { layers: [createLayer(64, 64, { grid: createGrid(64, 64, 2) })] }),
      createFrame(64, 64, { layers: [
        createLayer(64, 64, { grid: base }),
        createLayer(64, 64, { grid: overlay }),
        createLayer(64, 64, { grid: createGrid(64, 64, 2), visible: false }),
      ] }),
    ],
  }), { type: "character" });
  const store = session.get(id)!;
  store.selectFrame(1);
  store.setPixels([{ x: 0, y: 0, index: 1 }]);
  store.selectLayer(1);
  const projectId = projects.createProject("Source project");
  const folderId = projects.createFolder(projectId, "Characters")!;
  projects.place(id, projectId, folderId);
  return { id, store, projectId, folderId };
}

for (const targetWidth of [32, 64, 128]) {
  test(`pixelize creates a ${targetWidth}px copy using the selected frame composite and extracted palette`, async () => {
    const { id, store, projectId, folderId } = fixture();
    const before = store.snapshot();
    const history = store.history();
    const revision = store.revision;
    const message = await pixelizeCanvas.execute({ target_width: targetWidth, max_colors: 12 });
    const outputId = session.activeId!;
    expect(outputId).not.toBe(id);
    const output = session.get(outputId)!;
    expect([output.width, output.height, output.frameCount, output.layerCount]).toEqual([targetWidth, targetWidth, 1, 1]);
    expect(output.readComposite()).toEqual(result.grid);
    expect(output.palette.colors.map(color => color.hex)).toEqual([...result.palette]);
    expect(result.palette).toHaveLength(2);
    expect(result.palette[output.colorAt(targetWidth / 2, targetWidth / 2)]).toBe("#000000");
    expect(result.palette[output.colorAt(targetWidth - 1, targetWidth - 1)]).toBe("#ffffff");
    expect(Array.from(output.readComposite().cells).every(index => index === -1 || (index >= 0 && index < result.palette.length))).toBe(true);
    expect(session.list().find(asset => asset.id === outputId)?.type).toBe("character");
    expect(projects.placementOf(outputId)).toEqual({ projectId, folderId });
    expect(assetNavigation.peek()).toBe(outputId);
    expect(session.get(id)).toBe(store);
    expect(store.snapshot()).toEqual(before);
    expect(store.history()).toEqual(history);
    expect(store.revision).toBe(revision);
    expect([store.activeFrame, store.activeLayer]).toEqual([1, 1]);
    expect(message).toContain("copy");
    expect(message).not.toContain("undo");
  });
}

test("pixelize honors a tighter palette cap", async () => {
  const { store } = fixture();
  store.selectLayer(0);
  store.fillRegion({ x: 0, y: 0, width: 16, height: 64 }, 2);
  await pixelizeCanvas.execute({ target_width: 32, max_colors: 2 });
  expect(session.active!.palette.colors).toHaveLength(2);
  expect(session.active!.readComposite()).toEqual(result.grid);
});

test("pixelize retains the captured source placement when another project opens", async () => {
  const { projectId, folderId } = fixture();
  duringPixelize = () => projects.openProject(projects.createProject("Another project"));
  await pixelizeCanvas.execute({ target_width: 32 });
  expect(projects.placementOf(session.activeId!)).toEqual({ projectId, folderId });
});

test("pixelize refuses a deleted destination without creating a loose asset", async () => {
  const { projectId } = fixture();
  duringPixelize = () => { projects.deleteProject(projectId); };
  await expect(pixelizeCanvas.execute({ target_width: 32 })).rejects.toThrow("destination project was deleted");
  expect(session.list()).toHaveLength(1);
  expect(assetNavigation.peek()).toBeNull();
});

test("pixelize does not apply a stale worker result after the source changes", async () => {
  const { store } = fixture();
  duringPixelize = () => { store.setPixels([{ x: 1, y: 1, index: 1 }]); };
  await expect(pixelizeCanvas.execute({ target_width: 32 })).rejects.toThrow("changed");
  expect(session.list()).toHaveLength(1);
  expect(store.colorAt(1, 1)).toBe(1);
  expect(assetNavigation.peek()).toBeNull();
});

test("pixelize rejects an empty selected frame without creating an asset", async () => {
  session.create({ name: "Empty", preset: "modern-64" });
  await expect(pixelizeCanvas.execute({ target_width: 32 })).rejects.toThrow("no opaque pixels");
  expect(session.list()).toHaveLength(1);
  expect(assetNavigation.peek()).toBeNull();
});
