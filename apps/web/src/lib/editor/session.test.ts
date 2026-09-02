import { describe, expect, test } from "bun:test";
import { createPalette, createStyleProfile } from "@zenith/core";
import { EditorSession } from "./session";

/**
 * These cover the two bugs that reached the browser, both of which were silent:
 * the library looked right while the data underneath was wrong.
 */

describe("hydrate", () => {
  test("concurrent calls share one in-flight promise", () => {
    // React Strict Mode invokes effects twice in development. When hydrate
    // returned early on the second call, the caller saw an empty session while
    // the first load was still running, seeded on top of it, and resurrected
    // deleted assets under their original ids.
    const session = new EditorSession();
    expect(session.hydrate()).toBe(session.hydrate());
  });

  test("is not reported as hydrated until loading finishes", async () => {
    const session = new EditorSession();
    const pending = session.hydrate();
    expect(session.hydrated).toBe(false);
    await pending;
    expect(session.hydrated).toBe(true);
  });
});

describe("deletion", () => {
  test("close retains the asset so the deletion can be undone", () => {
    const session = new EditorSession();
    const id = session.create({ name: "Cobblestone", preset: "tile-32" });

    expect(session.close(id)).toBe(true);
    expect(session.has(id)).toBe(false);
    expect(session.lastDeleted?.name).toBe("Cobblestone");

    expect(session.undoDelete()).toBe(id);
    expect(session.has(id)).toBe(true);
    expect(session.lastDeleted).toBeNull();
  });

  test("undoing a deletion restores the pixels, not just the name", () => {
    const session = new EditorSession();
    const id = session.create({ name: "Tile", preset: "tile-32" });
    session.get(id)?.fillRegion({ x: 0, y: 0, width: 4, height: 4 }, 3);
    const before = session.get(id)?.encode();

    session.close(id);
    session.undoDelete();

    expect(session.get(id)?.encode()).toBe(before as string);
  });

  test("closing the active asset moves active to a survivor", () => {
    const session = new EditorSession();
    const first = session.create({ name: "One", preset: "tile-32" });
    const second = session.create({ name: "Two", preset: "tile-32" });

    expect(session.activeId).toBe(second);
    session.close(second);
    expect(session.activeId).toBe(first);
  });

  test("closing an unknown id is a no-op rather than an error", () => {
    const session = new EditorSession();
    expect(session.close("asset_missing")).toBe(false);
  });
});

describe("duplicate", () => {
  test("copies the pixels and leaves the original untouched", () => {
    const session = new EditorSession();
    const id = session.create({ name: "Source", preset: "tile-32" });
    session.get(id)?.fillRegion({ x: 0, y: 0, width: 8, height: 8 }, 5);

    const copyId = session.duplicate(id);
    expect(copyId).not.toBeNull();
    expect(session.get(copyId as string)?.encode()).toBe(session.get(id)?.encode() as string);

    // Editing the copy must not reach the original.
    session.get(copyId as string)?.fillRegion({ x: 0, y: 0, width: 8, height: 8 }, 2);
    expect(session.get(copyId as string)?.encode()).not.toBe(session.get(id)?.encode() as string);
  });

  test("returns null for an unknown id", () => {
    const session = new EditorSession();
    expect(session.duplicate("asset_missing")).toBeNull();
  });
});

describe("recolor", () => {
  test("remaps used indices when the selected palette is smaller", () => {
    const session = new EditorSession();
    const id = session.create({
      name: "Five colours",
      palette: ["#000000", "#ffffff", "#ff0000", "#00ff00", "#0000ff"],
      width: 8,
      height: 8,
    });
    session.get(id)?.setPixels([{ x: 0, y: 0, index: 4 }]);

    expect(session.recolor(id, ["#000000", "#ffffff", "#0000ff"])).toBe(true);
    expect(session.get(id)?.palette.colors).toHaveLength(3);
    expect(session.get(id)?.readComposite().cells[0]).toBe(2);
  });
});

describe("conformStyle", () => {
  test("recolours and resizes in one deterministic replacement", () => {
    const session = new EditorSession();
    const id = session.create({ name: "Off style", palette: ["#ff0000"], width: 2, height: 2 });
    session.get(id)?.fillRegion({ x: 0, y: 0, width: 2, height: 2 }, 0);
    const style = createStyleProfile(createPalette({ colors: ["#000000", "#ffffff"] }), {
      canvasSizes: { character: 4, tile: 4, texture: 4, item: 4, ui: 4 },
    });

    expect(session.conformStyle(id, style, "tile")).toEqual({ changed: 4, resized: true });
    expect(session.get(id)?.width).toBe(4);
    expect(session.get(id)?.palette.colors.map((colour) => colour.hex)).toEqual(["#000000", "#ffffff"]);
    expect(session.conformStyle(id, style, "tile")).toEqual({ changed: 0, resized: false });
  });
});

describe("list", () => {
  test("is ordered by insertion, not by Map iteration after deletes", () => {
    const session = new EditorSession();
    const a = session.create({ name: "A", preset: "tile-32" });
    const b = session.create({ name: "B", preset: "tile-32" });
    session.create({ name: "C", preset: "tile-32" });

    session.close(b);
    session.undoDelete();

    expect(session.list().map((asset) => asset.name)).toEqual(["A", "B", "C"]);
    expect(session.has(a)).toBe(true);
  });
});
