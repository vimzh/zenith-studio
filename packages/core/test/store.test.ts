import { describe, expect, test } from "bun:test";
import {
  builtinPalette,
  createDocument,
  createStore,
  decodeGrid,
  encodeGrid,
  TRANSPARENT,
  type DocumentStore,
} from "../src/index";

function makeStore(width = 4, height = 4): DocumentStore {
  return createStore(
    createDocument({ name: "mutations", width, height, palette: builtinPalette("pico-8") }),
  );
}

describe("mutations", () => {
  test("setPixels writes only the cells that change", () => {
    const store = makeStore();
    expect(store.setPixels([{ x: 1, y: 2, index: 5 }])).toBe(1);
    expect(store.setPixels([{ x: 1, y: 2, index: 5 }])).toBe(0);
    expect(store.colorAt(1, 2)).toBe(5);
  });

  test("setPixels applies the last write when a cell is listed twice", () => {
    const store = makeStore();
    store.setPixels([
      { x: 0, y: 0, index: 3 },
      { x: 0, y: 0, index: 7 },
    ]);
    expect(store.colorAt(0, 0)).toBe(7);
  });

  test("writeRegion stamps a sub-grid at an offset", () => {
    const store = makeStore();
    expect(store.writeRegion(1, 1, "12\n34")).toBe(4);
    expect(store.encode()).toBe("....\n.12.\n.34.\n....");
  });

  test("writeRegion accepts a decoded grid as well as text", () => {
    const store = makeStore();
    store.writeRegion(0, 0, decodeGrid("11\n11"));
    expect(store.encode()).toBe("11..\n11..\n....\n....");
  });

  test("fillRegion clips to the canvas", () => {
    const store = makeStore();
    expect(store.fillRegion({ x: 2, y: 2, width: 10, height: 10 }, 9)).toBe(4);
    expect(store.encode()).toBe("....\n....\n..99\n..99");
  });

  test("bucketFill floods the connected run only", () => {
    const store = makeStore();
    store.writeRegion(0, 0, "0010\n0010\n1110\n0000");
    // The column of 1s isolates the right-hand zeros from the top-left run.
    expect(store.bucketFill(0, 0, 4)).toBe(4);
    expect(store.encode()).toBe("4410\n4410\n1110\n0000");
  });

  test("bucketFill with contiguous:false replaces every matching cell", () => {
    const store = makeStore();
    store.writeRegion(0, 0, "0010\n0010\n1110\n0000");
    expect(store.bucketFill(0, 0, 4, { contiguous: false })).toBe(11);
    expect(store.encode()).toBe("4414\n4414\n1114\n4444");
  });

  test("bucketFill on a cell that already holds the target is a no-op", () => {
    const store = makeStore();
    expect(store.bucketFill(0, 0, TRANSPARENT)).toBe(0);
    expect(store.canUndo).toBe(false);
  });

  test("replaceColor reports the count replaced", () => {
    const store = makeStore();
    store.writeRegion(0, 0, "1122\n1122\n3344\n3344");
    expect(store.replaceColor(1, 5)).toBe(4);
    expect(store.encode()).toBe("5522\n5522\n3344\n3344");
  });

  test("clearRegion sets transparent", () => {
    const store = makeStore();
    store.fillRegion({ x: 0, y: 0, width: 4, height: 4 }, 2);
    expect(store.clearRegion({ x: 1, y: 1, width: 2, height: 2 })).toBe(4);
    expect(store.encode()).toBe("2222\n2..2\n2..2\n2222");
  });

  test("shift vacates with transparency", () => {
    const store = makeStore();
    store.writeRegion(0, 0, "1234\n5678\n9ABC\nDEF0");
    store.shift(1, 0);
    expect(store.encode()).toBe(".123\n.567\n.9AB\n.DEF");
  });

  test("shift with wrap preserves every cell — the tile-seam check", () => {
    const store = makeStore();
    const before = "1234\n5678\n9ABC\nDEF0";
    store.writeRegion(0, 0, before);
    store.shift(2, 2, { wrap: true });
    expect(store.encode()).toBe("BC9A\nF0DE\n3412\n7856");
    store.shift(-2, -2, { wrap: true });
    expect(store.encode()).toBe(before);
  });

  test("mirror flips the whole grid or a region", () => {
    const store = makeStore();
    store.writeRegion(0, 0, "1200\n3400\n0000\n0000");
    store.mirror("horizontal");
    expect(store.encode()).toBe("0021\n0043\n0000\n0000");
    store.mirror("vertical", { x: 2, y: 0, width: 2, height: 2 });
    expect(store.encode()).toBe("0043\n0021\n0000\n0000");
  });

  test("mirror twice is the identity", () => {
    const store = makeStore();
    store.writeRegion(0, 0, "1234\n5678\n9ABC\nDEF0");
    const before = store.encode();
    store.mirror("horizontal");
    store.mirror("horizontal");
    expect(store.encode()).toBe(before);
  });
});

describe("perception", () => {
  test("encode returns the composited frame in the text format", () => {
    const store = makeStore(2, 2);
    store.setPixels([{ x: 0, y: 0, index: 1 }]);
    expect(store.encode()).toBe("1.\n..");
  });

  test("stats reports coverage and per-index usage", () => {
    const store = makeStore(2, 2);
    store.setPixels([
      { x: 0, y: 0, index: 1 },
      { x: 1, y: 1, index: 1 },
    ]);
    const stats = store.stats();
    expect(stats.opaque).toBe(2);
    expect(stats.transparent).toBe(2);
    expect(stats.coverage).toBe(0.5);
    expect(stats.usage.get(1)).toBe(2);
    expect(stats.usage.get(TRANSPARENT)).toBe(2);
  });

  test("colorAt rejects coordinates outside the canvas", () => {
    const store = makeStore(2, 2);
    expect(() => store.colorAt(2, 0)).toThrow(/outside the 2x2 canvas/);
  });
});

describe("targets", () => {
  test("mutations default to the active frame and follow selection", () => {
    const store = createStore(
      createDocument({ width: 2, height: 2, palette: builtinPalette("pico-8"), frameCount: 3 }),
    );
    store.setPixels([{ x: 0, y: 0, index: 1 }]);
    store.selectFrame(2);
    store.setPixels([{ x: 1, y: 1, index: 2 }]);

    expect(store.encode(0)).toBe("1.\n..");
    expect(store.encode(1)).toBe("..\n..");
    expect(store.encode(2)).toBe("..\n.2");
    expect(store.activeFrame).toBe(2);
  });

  test("an explicit target overrides the selection without moving it", () => {
    const store = createStore(
      createDocument({ width: 2, height: 2, palette: builtinPalette("pico-8"), frameCount: 2 }),
    );
    store.setPixels([{ x: 0, y: 0, index: 3 }], { frame: 1 });
    expect(store.activeFrame).toBe(0);
    expect(store.encode(1)).toBe("3.\n..");
  });

  test("an unknown frame is rejected with the valid range", () => {
    const store = makeStore();
    expect(() => store.selectFrame(4)).toThrow(/indices 0-0/);
  });
});

describe("composite", () => {
  test("visible layers overwrite what is beneath them", () => {
    const store = createStore(
      createDocument({
        width: 2,
        height: 2,
        palette: builtinPalette("pico-8"),
        frames: [
          {
            id: "f0",
            durationMs: 100,
            layers: [
              { id: "base", name: "Base", visible: true, grid: decodeGrid("11\n11") },
              { id: "top", name: "Top", visible: true, grid: decodeGrid("2.\n..") },
            ],
          },
        ],
      }),
    );
    expect(store.encode()).toBe("21\n11");
    expect(encodeGrid(store.readLayer({ layer: 0 }))).toBe("11\n11");
  });

  test("a hidden layer contributes nothing", () => {
    const store = createStore(
      createDocument({
        width: 2,
        height: 2,
        palette: builtinPalette("pico-8"),
        frames: [
          {
            id: "f0",
            durationMs: 100,
            layers: [
              { id: "base", name: "Base", visible: true, grid: decodeGrid("11\n11") },
              { id: "top", name: "Top", visible: false, grid: decodeGrid("22\n22") },
            ],
          },
        ],
      }),
    );
    expect(store.encode()).toBe("11\n11");
  });
});

describe("subscription", () => {
  test("listeners fire on change and stop after unsubscribe", () => {
    const store = makeStore();
    let calls = 0;
    const unsubscribe = store.subscribe(() => {
      calls += 1;
    });
    store.setPixels([{ x: 0, y: 0, index: 1 }]);
    expect(calls).toBe(1);
    expect(store.revision).toBe(1);
    unsubscribe();
    store.setPixels([{ x: 1, y: 1, index: 1 }]);
    expect(calls).toBe(1);
    expect(store.revision).toBe(2);
  });
});
