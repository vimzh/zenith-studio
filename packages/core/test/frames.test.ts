import { describe, expect, test } from "bun:test";
import { builtinPalette, createDocument, createStore, type DocumentStore } from "../src/index";
import { createRandom, randomInt } from "./random";

function makeStore(frameCount = 1): DocumentStore {
  return createStore(
    createDocument({ width: 4, height: 4, palette: builtinPalette("pico-8"), frameCount }),
  );
}

describe("addFrame", () => {
  test("new frames default to 4 fps while copied custom timing is preserved", () => {
    const store = makeStore();
    expect(store.snapshot().frames[0]?.durationMs).toBe(250);
    store.setFrameDuration(0, 80);
    store.addFrame();
    store.addFrame({ copyFrom: 0 });
    expect(store.snapshot().frames.map((frame) => frame.durationMs)).toEqual([80, 250, 80]);
  });
  test("appends a blank frame and selects it", () => {
    const store = makeStore();
    store.fillRegion({ x: 0, y: 0, width: 4, height: 4 }, 1);

    expect(store.addFrame()).toBe(1);
    expect(store.frameCount).toBe(2);
    expect(store.activeFrame).toBe(1);
    expect(store.encode(1)).toBe("....\n....\n....\n....");
    expect(store.encode(0)).toBe("1111\n1111\n1111\n1111");
  });

  test("copies a frame's pixels and duration", () => {
    const store = makeStore();
    store.writeRegion(0, 0, "0123\n4567\n89AB\nCDEF");
    store.setFrameDuration(0, 250);

    store.addFrame({ copyFrom: 0 });
    expect(store.encode(1)).toBe(store.encode(0));
    expect(store.snapshot().frames[1]?.durationMs).toBe(250);
  });

  test("a copied frame owns its pixels", () => {
    const store = makeStore();
    store.fillRegion({ x: 0, y: 0, width: 4, height: 4 }, 2);
    store.addFrame({ copyFrom: 0 });

    store.setPixels([{ x: 0, y: 0, index: 5 }], { frame: 1 });
    expect(store.colorAt(0, 0, 1)).toBe(5);
    expect(store.colorAt(0, 0, 0)).toBe(2);
  });

  test("a copied frame gets its own layer ids", () => {
    const store = makeStore();
    store.addFrame({ copyFrom: 0 });
    const frames = store.snapshot().frames;
    expect(frames[1]?.layers[0]?.id).not.toBe(frames[0]?.layers[0]?.id);
  });

  test("inserts at a position", () => {
    const store = makeStore();
    store.fillRegion({ x: 0, y: 0, width: 4, height: 4 }, 1);
    store.addFrame();
    store.fillRegion({ x: 0, y: 0, width: 4, height: 4 }, 2, { frame: 1 });

    expect(store.addFrame({ at: 1 })).toBe(1);
    expect(store.encode(0)).toContain("1");
    expect(store.encode(1)).toBe("....\n....\n....\n....");
    expect(store.encode(2)).toContain("2");
  });

  test("rejects an out-of-range position and an unknown source", () => {
    const store = makeStore();
    expect(() => store.addFrame({ at: 5 })).toThrow(/Valid positions are 0-1/);
    expect(() => store.addFrame({ copyFrom: 3 })).toThrow(/does not exist/);
  });

  test("every added frame keeps the document's dimensions and palette", () => {
    const store = makeStore();
    store.addFrame();
    store.addFrame({ copyFrom: 1 });

    const document = store.snapshot();
    for (const frame of document.frames) {
      for (const layer of frame.layers) {
        expect(layer.grid.width).toBe(document.width);
        expect(layer.grid.height).toBe(document.height);
      }
    }
    expect(document.palette.colors).toHaveLength(16);
  });
});

describe("deleteFrame", () => {
  test("removes a frame and keeps the selection in range", () => {
    const store = makeStore(3);
    store.selectFrame(2);
    store.deleteFrame(2);

    expect(store.frameCount).toBe(2);
    expect(store.activeFrame).toBe(1);
  });

  test("refuses to remove the only frame", () => {
    const store = makeStore();
    expect(() => store.deleteFrame(0)).toThrow(/only frame/);
    expect(store.frameCount).toBe(1);
  });

  test("rejects an unknown index with the valid range", () => {
    const store = makeStore(2);
    expect(() => store.deleteFrame(7)).toThrow(/indices 0-1/);
  });

  test("undo restores the frame's pixels exactly", () => {
    const store = makeStore(2);
    store.writeRegion(0, 0, "0123\n4567\n89AB\nCDEF", { frame: 1 });
    const before = store.encode(1);

    store.deleteFrame(1);
    expect(store.frameCount).toBe(1);

    expect(store.undo()).toBe("Delete frame");
    expect(store.frameCount).toBe(2);
    expect(store.encode(1)).toBe(before);
  });
});

describe("reorderFrames", () => {
  test("reorders and follows the selected frame", () => {
    const store = makeStore(3);
    for (let frame = 0; frame < 3; frame += 1) {
      store.fillRegion({ x: 0, y: 0, width: 4, height: 4 }, frame + 1, { frame });
    }
    store.selectFrame(0);

    store.reorderFrames([2, 0, 1]);
    expect(store.encode(0)).toContain("3");
    expect(store.encode(1)).toContain("1");
    expect(store.encode(2)).toContain("2");
    // The frame that was selected is now at index 1.
    expect(store.activeFrame).toBe(1);
  });

  test("rejects anything that is not a permutation", () => {
    const store = makeStore(3);
    expect(() => store.reorderFrames([0, 1])).toThrow(/lists 2 frame\(s\) but the document has 3/);
    expect(() => store.reorderFrames([0, 1, 1])).toThrow(/more than once/);
    expect(() => store.reorderFrames([0, 1, 5])).toThrow(/not a frame index/);
    expect(() => store.reorderFrames([0, 1, 1.5])).toThrow(/not a frame index/);
  });

  test("an identity order records no history", () => {
    const store = makeStore(3);
    store.reorderFrames([0, 1, 2]);
    expect(store.history()).toEqual([]);
  });

  test("undo restores the original order", () => {
    const store = makeStore(3);
    for (let frame = 0; frame < 3; frame += 1) {
      store.fillRegion({ x: 0, y: 0, width: 4, height: 4 }, frame + 1, { frame });
    }
    const before = [0, 1, 2].map((frame) => store.encode(frame));

    store.reorderFrames([2, 0, 1]);
    expect(store.undo()).toBe("Reorder frames");
    expect([0, 1, 2].map((frame) => store.encode(frame))).toEqual(before);
  });
});

describe("setFrameDuration", () => {
  test("sets and undoes a duration", () => {
    const store = makeStore();
    expect(store.snapshot().frames[0]?.durationMs).toBe(250);

    store.setFrameDuration(0, 100);
    expect(store.snapshot().frames[0]?.durationMs).toBe(100);

    store.undo();
    expect(store.snapshot().frames[0]?.durationMs).toBe(250);
  });

  test("keeps the frame's pixels", () => {
    const store = makeStore();
    store.writeRegion(0, 0, "0123\n4567\n89AB\nCDEF");
    const before = store.encode();
    store.setFrameDuration(0, 40);
    expect(store.encode()).toBe(before);
  });

  test("rejects a non-positive or fractional duration", () => {
    const store = makeStore();
    expect(() => store.setFrameDuration(0, 0)).toThrow(/greater than 0/);
    expect(() => store.setFrameDuration(0, -5)).toThrow(/greater than 0/);
    expect(() => store.setFrameDuration(0, 33.5)).toThrow(/must be an integer/);
  });

  test("setting the same duration records no history", () => {
    const store = makeStore();
    store.setFrameDuration(0, 250);
    expect(store.history()).toEqual([]);
  });
});

describe("frame changes on the shared undo stack", () => {
  test("each is one entry", () => {
    const store = makeStore();
    store.addFrame();
    store.setFrameDuration(1, 80);
    store.addFrame({ copyFrom: 0 });
    store.reorderFrames([2, 1, 0]);
    store.deleteFrame(0);

    expect(store.history()).toEqual([
      "Add frame",
      "Set frame duration",
      "Add frame",
      "Reorder frames",
      "Delete frame",
    ]);
  });

  test("adding a frame undoes as one press, not pixel by pixel", () => {
    const store = makeStore();
    store.fillRegion({ x: 0, y: 0, width: 4, height: 4 }, 3);
    store.addFrame({ copyFrom: 0 });

    expect(store.undo()).toBe("Add frame");
    expect(store.frameCount).toBe(1);
  });

  /**
   * The wart this replaced: a six-frame procedural cycle was six undo presses,
   * because structural changes could not join a transaction at all.
   */
  test("a transaction spanning frames and pixels is one entry", () => {
    const store = makeStore();
    store.transaction("Animate bob", () => {
      for (let frame = 1; frame <= 5; frame += 1) {
        store.addFrame({ copyFrom: 0 });
        store.fillRegion({ x: 0, y: 0, width: 4, height: frame }, frame, { frame });
      }
    });

    expect(store.frameCount).toBe(6);
    expect(store.history()).toEqual(["Animate bob"]);

    expect(store.undo()).toBe("Animate bob");
    expect(store.frameCount).toBe(1);
    expect(store.canUndo).toBe(false);

    expect(store.redo()).toBe("Animate bob");
    expect(store.frameCount).toBe(6);
    expect(store.encode(5)).toBe("5555\n5555\n5555\n5555");
  });

  test("drag strokes still coalesce, and a frame change splits them", () => {
    const store = makeStore();
    store.transaction("Stroke, frame, stroke", () => {
      store.setPixels([{ x: 0, y: 0, index: 1 }]);
      store.setPixels([{ x: 1, y: 0, index: 1 }]);
      store.addFrame();
      store.setPixels([{ x: 2, y: 2, index: 2 }], { frame: 1 });
    });

    expect(store.history()).toEqual(["Stroke, frame, stroke"]);
    store.undo();
    expect(store.frameCount).toBe(1);
    expect(store.encode(0)).toBe("....\n....\n....\n....");
  });

  test("a failing compound transaction rolls back frames as well as pixels", () => {
    const store = makeStore();
    store.fillRegion({ x: 0, y: 0, width: 4, height: 4 }, 1);
    const before = store.encode();

    expect(() =>
      store.transaction("Bad cycle", () => {
        store.addFrame({ copyFrom: 0 });
        store.setPixels([{ x: 0, y: 0, index: 2 }], { frame: 1 });
        store.setPixels([{ x: 0, y: 0, index: 99 }], { frame: 1 });
      }),
    ).toThrow();

    expect(store.frameCount).toBe(1);
    expect(store.encode()).toBe(before);
    expect(store.history()).toEqual(["Fill region"]);
  });

  test("undo and redo are still refused while a transaction is open", () => {
    const store = makeStore();
    store.begin("Stroke");
    expect(() => store.undo()).toThrow(/commit\(\) or abort\(\)/);
    expect(() => store.redo()).toThrow(/commit\(\) or abort\(\)/);
    store.commit();
  });

  /**
   * Pixel patches address frames by index, and structural changes move those
   * indices. That is only safe because the stack is strictly LIFO — this fuzz
   * asserts it, mixing both kinds and walking the whole history down and back.
   */
  test("mixed pixel and frame operations undo and redo with no divergence", () => {
    const random = createRandom(0xf00d);
    const store = createStore(
      createDocument({ width: 8, height: 8, palette: builtinPalette("pico-8") }),
      { historyLimit: 1000 },
    );

    const snapshot = (): string => {
      const document = store.snapshot();
      return document.frames
        .map((_, index) => `${store.encode(index)}@${String(document.frames[index]?.durationMs ?? 0)}`)
        .join("\n--\n");
    };

    const states: string[] = [snapshot()];
    const labels: string[] = [];

    for (let step = 0; step < 300; step += 1) {
      const entries = store.history().length;
      const frames = store.frameCount;

      // Every few steps, wrap a run of mixed operations in one transaction, so
      // the compound path is fuzzed as hard as the plain one.
      const compound = random() < 0.25;
      if (compound) store.begin("Compound");

      switch (randomInt(random, 0, 5)) {
        case 0:
          store.addFrame(random() < 0.5 ? {} : { copyFrom: randomInt(random, 0, frames - 1) });
          break;
        case 1:
          if (frames > 1) store.deleteFrame(randomInt(random, 0, frames - 1));
          break;
        case 2: {
          const order = [...Array(frames).keys()];
          for (let i = order.length - 1; i > 0; i -= 1) {
            const j = randomInt(random, 0, i);
            [order[i], order[j]] = [order[j] as number, order[i] as number];
          }
          store.reorderFrames(order);
          break;
        }
        case 3:
          store.setFrameDuration(randomInt(random, 0, frames - 1), randomInt(random, 20, 400));
          break;
        default:
          store.fillRegion(
            { x: randomInt(random, 0, 7), y: randomInt(random, 0, 7), width: randomInt(random, 1, 4), height: randomInt(random, 1, 4) },
            randomInt(random, 0, 15),
            { frame: randomInt(random, 0, frames - 1) },
          );
      }

      if (compound) {
        // A second, differently-shaped operation inside the same entry.
        const live = store.frameCount;
        if (random() < 0.5) store.addFrame({ copyFrom: randomInt(random, 0, live - 1) });
        store.fillRegion(
          { x: 0, y: 0, width: randomInt(random, 1, 8), height: randomInt(random, 1, 8) },
          randomInt(random, 0, 15),
          { frame: randomInt(random, 0, store.frameCount - 1) },
        );
        store.commit();
      }

      if (store.history().length === entries) continue;
      states.push(snapshot());
      labels.push(store.history()[store.history().length - 1] as string);
    }

    expect(states.length).toBeGreaterThan(100);

    for (let i = states.length - 1; i > 0; i -= 1) {
      expect(snapshot()).toBe(states[i] as string);
      expect(store.undo()).toBe(labels[i - 1] as string);
    }
    expect(snapshot()).toBe(states[0] as string);

    for (let i = 1; i < states.length; i += 1) {
      expect(store.redo()).toBe(labels[i - 1] as string);
      expect(snapshot()).toBe(states[i] as string);
    }
  });
});
