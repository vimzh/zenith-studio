import { describe, expect, test } from "bun:test";
import {
  builtinPalette,
  createDocument,
  createStore,
  PixelError,
  TRANSPARENT,
  type DocumentStore,
} from "../src/index";
import { createRandom, randomInt } from "./random";

function makeStore(width = 4, height = 4, frameCount = 1): DocumentStore {
  return createStore(
    createDocument({ name: "history", width, height, palette: builtinPalette("pico-8"), frameCount }),
  );
}

describe("undo and redo", () => {
  test("one logical operation is one entry", () => {
    const store = makeStore();
    store.fillRegion({ x: 0, y: 0, width: 4, height: 4 }, 1);
    store.setPixels([{ x: 0, y: 0, index: 2 }]);
    expect(store.history()).toEqual(["Fill region", "Set pixels"]);

    expect(store.undo()).toBe("Set pixels");
    expect(store.colorAt(0, 0)).toBe(1);
    expect(store.undo()).toBe("Fill region");
    expect(store.encode()).toBe("....\n....\n....\n....");
    expect(store.undo()).toBeNull();
  });

  test("redo replays in order and stops at the top", () => {
    const store = makeStore();
    store.setPixels([{ x: 0, y: 0, index: 1 }]);
    store.setPixels([{ x: 1, y: 1, index: 2 }]);
    store.undo();
    store.undo();

    expect(store.redo()).toBe("Set pixels");
    expect(store.colorAt(0, 0)).toBe(1);
    expect(store.colorAt(1, 1)).toBe(TRANSPARENT);
    expect(store.redo()).toBe("Set pixels");
    expect(store.colorAt(1, 1)).toBe(2);
    expect(store.redo()).toBeNull();
  });

  test("a new mutation clears the redo stack", () => {
    const store = makeStore();
    store.setPixels([{ x: 0, y: 0, index: 1 }]);
    store.undo();
    expect(store.canRedo).toBe(true);
    store.setPixels([{ x: 2, y: 2, index: 3 }]);
    expect(store.canRedo).toBe(false);
  });

  test("a no-op mutation records no entry", () => {
    const store = makeStore();
    store.setPixels([{ x: 0, y: 0, index: 1 }]);
    expect(store.setPixels([{ x: 0, y: 0, index: 1 }])).toBe(0);
    expect(store.history()).toEqual(["Set pixels"]);
  });

  test("undo spans frames", () => {
    const store = makeStore(2, 2, 2);
    store.setPixels([{ x: 0, y: 0, index: 1 }], { frame: 1 });
    expect(store.encode(1)).toBe("1.\n..");
    store.undo();
    expect(store.encode(1)).toBe("..\n..");
  });

  test("history is capped and drops oldest first", () => {
    const store = createStore(
      createDocument({ width: 2, height: 2, palette: builtinPalette("pico-8") }),
      { historyLimit: 3 },
    );
    for (let i = 1; i <= 5; i += 1) store.setPixels([{ x: 0, y: 0, index: i }]);
    expect(store.history()).toHaveLength(3);
    while (store.canUndo) store.undo();
    // The two dropped entries cannot be undone, so index 2 is as far back as it goes.
    expect(store.colorAt(0, 0)).toBe(2);
  });
});

describe("transactions", () => {
  test("a drag stroke coalesces into one entry", () => {
    const store = makeStore(8, 8);
    store.transaction("Pencil stroke", () => {
      for (let x = 0; x < 8; x += 1) store.setPixels([{ x, y: x, index: 3 }]);
    });

    expect(store.history()).toEqual(["Pencil stroke"]);
    store.undo();
    expect(store.encode()).toBe(Array.from({ length: 8 }, () => "........").join("\n"));
  });

  test("a cell touched repeatedly in one stroke keeps its original value for undo", () => {
    const store = makeStore(2, 2);
    store.setPixels([{ x: 0, y: 0, index: 1 }]);
    store.transaction("Pencil stroke", () => {
      store.setPixels([{ x: 0, y: 0, index: 2 }]);
      store.setPixels([{ x: 0, y: 0, index: 3 }]);
      store.setPixels([{ x: 0, y: 0, index: 4 }]);
    });
    expect(store.colorAt(0, 0)).toBe(4);
    store.undo();
    expect(store.colorAt(0, 0)).toBe(1);
    store.redo();
    expect(store.colorAt(0, 0)).toBe(4);
  });

  test("a transaction that changes nothing records no entry", () => {
    const store = makeStore(2, 2);
    store.setPixels([{ x: 0, y: 0, index: 1 }]);
    store.transaction("Pencil stroke", () => {
      store.setPixels([{ x: 0, y: 0, index: 2 }]);
      store.setPixels([{ x: 0, y: 0, index: 1 }]);
    });
    expect(store.history()).toEqual(["Set pixels"]);
  });

  test("a throwing transaction rolls back and rethrows", () => {
    const store = makeStore(4, 4);
    store.setPixels([{ x: 0, y: 0, index: 1 }]);
    const before = store.encode();

    expect(() =>
      store.transaction("Bad stroke", () => {
        store.setPixels([{ x: 1, y: 1, index: 2 }]);
        store.setPixels([{ x: 2, y: 2, index: 99 }]);
      }),
    ).toThrow(PixelError);

    expect(store.encode()).toBe(before);
    expect(store.history()).toEqual(["Set pixels"]);
    expect(store.inTransaction).toBe(false);
  });

  test("nested transactions join the outer one", () => {
    const store = makeStore(4, 4);
    store.transaction("Outer", () => {
      store.setPixels([{ x: 0, y: 0, index: 1 }]);
      store.transaction("Inner", () => {
        store.setPixels([{ x: 1, y: 1, index: 2 }]);
      });
      expect(store.inTransaction).toBe(true);
    });
    expect(store.history()).toEqual(["Outer"]);
  });

  test("undo is refused while a transaction is open", () => {
    const store = makeStore();
    store.begin("Pencil stroke");
    expect(() => store.undo()).toThrow(/commit\(\) or abort\(\)/);
    store.commit();
  });

  test("commit and abort without a transaction are rejected", () => {
    const store = makeStore();
    expect(() => store.commit()).toThrow(/no open transaction/);
    expect(() => store.abort()).toThrow(/no open transaction/);
  });
});

/**
 * Exit criterion: undo/redo survives a 500-operation fuzz sequence with no state
 * divergence. Every state on the way up is recorded, then walked back down and
 * up again; any drift in the patch bookkeeping shows as a mismatch.
 */
describe("fuzz", () => {
  test("500 random operations undo and redo with no divergence", () => {
    const random = createRandom(0xc0ffee);
    const store = createStore(
      createDocument({ width: 16, height: 16, palette: builtinPalette("pico-8"), frameCount: 3 }),
      { historyLimit: 1000 },
    );
    const palette = store.palette.colors.length;

    const states: string[] = [snapshotOf(store)];
    const labels: string[] = [];

    for (let step = 0; step < 500; step += 1) {
      const before = snapshotOf(store);
      const entriesBefore = store.history().length;
      applyRandomOperation(store, random, palette);
      // An operation counts only when it actually produced an undo entry.
      if (store.history().length === entriesBefore) continue;

      const after = snapshotOf(store);
      expect(after).not.toBe(before);
      states.push(after);
      labels.push(store.history()[store.history().length - 1] as string);
    }

    expect(states.length).toBeGreaterThan(100);

    for (let i = states.length - 1; i > 0; i -= 1) {
      expect(snapshotOf(store)).toBe(states[i] as string);
      expect(store.undo()).toBe(labels[i - 1] as string);
    }
    expect(snapshotOf(store)).toBe(states[0] as string);
    expect(store.canUndo).toBe(false);

    for (let i = 1; i < states.length; i += 1) {
      expect(store.redo()).toBe(labels[i - 1] as string);
      expect(snapshotOf(store)).toBe(states[i] as string);
    }
    expect(store.canRedo).toBe(false);
  });
});

function snapshotOf(store: DocumentStore): string {
  const frames: string[] = [];
  for (let frame = 0; frame < store.frameCount; frame += 1) frames.push(store.encode(frame));
  return frames.join("\n--\n");
}

function applyRandomOperation(store: DocumentStore, random: () => number, palette: number): void {
  const frame = randomInt(random, 0, store.frameCount - 1);
  const index = random() < 0.2 ? TRANSPARENT : randomInt(random, 0, palette - 1);
  const x = randomInt(random, 0, store.width - 1);
  const y = randomInt(random, 0, store.height - 1);
  const target = { frame };

  switch (randomInt(random, 0, 7)) {
    case 0:
      store.setPixels([{ x, y, index }], target);
      return;
    case 1:
      store.fillRegion(
        { x, y, width: randomInt(random, 1, store.width - x), height: randomInt(random, 1, store.height - y) },
        index,
        target,
      );
      return;
    case 2:
      store.bucketFill(x, y, index, { contiguous: random() < 0.7 }, target);
      return;
    case 3:
      store.replaceColor(randomInt(random, 0, palette - 1), index, target);
      return;
    case 4:
      store.clearRegion(
        { x, y, width: randomInt(random, 1, store.width - x), height: randomInt(random, 1, store.height - y) },
        target,
      );
      return;
    case 5:
      store.shift(randomInt(random, -3, 3), randomInt(random, -3, 3), { wrap: random() < 0.5 }, target);
      return;
    case 6:
      store.mirror(random() < 0.5 ? "horizontal" : "vertical", undefined, target);
      return;
    default:
      // A multi-mutation stroke, so coalescing is exercised inside the fuzz too.
      store.transaction("Pencil stroke", () => {
        for (let i = 0; i < randomInt(random, 1, 6); i += 1) {
          store.setPixels(
            [{ x: randomInt(random, 0, store.width - 1), y: randomInt(random, 0, store.height - 1), index }],
            target,
          );
        }
      });
  }
}
