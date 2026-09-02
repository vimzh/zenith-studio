import { describe, expect, test } from "bun:test";
import { createRaster } from "@/lib/pixelize";
import { session } from "./session";
import { applySkeletonTemplate, buildCharacterFromReference, generateDirections, generateTileset } from "./generators";

/**
 * The generators create assets as a by-product, and `session.create()` moves
 * `activeId` every time. These pin that the active asset survives.
 *
 * This reached the browser. Asking the chat to "swap this tile to Game Boy and
 * derive the 47-tile set" ran both tools successfully, and then the agent panel
 * dropped from 66 tools to 14 and the composer read "No asset is open, so there
 * is nothing to edit yet." Nothing threw. `readScopeContext` returns
 * `EMPTY_SCOPE` when `session.activeId` and the route disagree — which is the
 * correct, careful behaviour from AGENTS.md, and it fired because the tileset
 * sheet had quietly become the active asset while the route stayed on the tile.
 *
 * The failure is invisible from inside a generator, so it is asserted here.
 */

function reset(): void {
  for (const asset of session.list()) session.close(asset.id);
}

/** A tile with real content, so the derivations have something to work from. */
function paintedTile(name: string): string {
  const id = session.create({ name, type: "tile", preset: "tile-32" });
  const store = session.get(id);
  if (store === undefined) throw new Error("fixture missing");
  store.transaction("paint", () => {
    const pixels = [];
    for (let y = 4; y < 28; y += 1) {
      for (let x = 4; x < 28; x += 1) pixels.push({ x, y, index: ((x ^ y) % 3) as 0 | 1 | 2 });
    }
    store.setPixels(pixels);
  });
  return id;
}

describe("generators leave the active asset where they found it", () => {
  test("generate_tileset creates the sheet without stealing focus", () => {
    reset();
    const tile = paintedTile("terrain");
    session.open(tile);

    const summary = generateTileset(tile);

    expect(summary).toContain("47");
    // The sheet exists...
    expect(session.list().some((asset) => asset.type === "tileset")).toBe(true);
    // ...and the human is still on their tile.
    expect(session.activeId).toBe(tile);
  });

  test("generateDirections creates directions without stealing focus", () => {
    reset();
    const character = session.create({ name: "hero", type: "character", preset: "tile-32" });
    const store = session.get(character);
    if (store === undefined) throw new Error("fixture missing");
    store.transaction("paint", () => {
      store.setPixels([
        { x: 10, y: 10, index: 1 },
        { x: 20, y: 10, index: 2 },
      ]);
    });
    session.open(character);

    generateDirections(character, "cardinal4");

    expect(session.activeId).toBe(character);
  });

  /**
   * The guard restores only an asset that still exists. Restoring a deleted id
   * would resurrect a dangling `activeId`, which is the failure this is meant
   * to prevent, pointed the other way.
   */
  test("a generator run with nothing open leaves nothing open", () => {
    reset();
    const tile = paintedTile("orphan");
    session.close(tile);

    const other = paintedTile("still here");
    session.open(other);
    generateTileset(other);

    expect(session.activeId).toBe(other);
  });
});

describe("character reference preparation", () => {
  test("isolates and frames the cleaned character before pixelising it", async () => {
    reset();
    const reference = createRaster(100, 100);
    for (let y = 0; y < 100; y += 1) {
      for (let x = 0; x < 100; x += 1) {
        const offset = (y * 100 + x) * 4;
        const character = x >= 40 && x < 60 && y >= 10 && y < 90;
        reference.data[offset] = character ? 180 : 255;
        reference.data[offset + 1] = character ? 40 : 255;
        reference.data[offset + 2] = character ? 30 : 255;
        reference.data[offset + 3] = 255;
      }
    }

    const summary = await buildCharacterFromReference(reference, "hero", {
      directionSet: "side2",
      targetWidth: 32,
    });
    const created = session.list().find((asset) => asset.name === "hero east");

    expect(summary).toContain("prepare_reference");
    expect(summary).toContain("scaled to fill the canvas");
    expect(created).toMatchObject({ width: 32, height: 32, type: "character" });
  });
});

describe("local skeleton animation", () => {
  test("builds a stock cycle as one undoable indexed edit without a model", () => {
    reset();
    const character = session.create({ name: "rigged hero", type: "character", preset: "tile-32" });
    const store = session.get(character);
    if (store === undefined) throw new Error("fixture missing");
    store.fillRegion({ x: 10, y: 4, width: 12, height: 20 }, 1);
    store.clearHistory();
    const before = store.encode();

    expect(applySkeletonTemplate(store, "walk", 4)).toContain("No prompt or model call");
    expect(store.frameCount).toBe(4);
    expect(store.history()).toEqual(["Animate with skeleton: walk"]);
    expect(Array.from({ length: 4 }, (_, frame) => [...store.readComposite(frame).cells].every((cell) => cell === -1 || cell === 1))).toEqual([true, true, true, true]);
    expect(store.undo()).toBe("Animate with skeleton: walk");
    expect(store.frameCount).toBe(1);
    expect(store.encode()).toBe(before);
  });
});
