import { describe, expect, test } from "bun:test";
import {
  builtinPalette,
  createDocument,
  createGrid,
  createStore,
  decodeGrid,
  deserializeDocument,
  encodeGrid,
  parseHex,
  PixelError,
  scaleGrid,
  serializeDocument,
  TRANSPARENT,
  type PixelErrorCode,
} from "../src/index";

function makeStore(width = 8, height = 8) {
  return createStore(
    createDocument({ name: "invariants", width, height, palette: builtinPalette("gb-dmg") }),
  );
}

/** Asserts the store *rejects* rather than silently correcting, and names the reason. */
function expectRejection(code: PixelErrorCode, run: () => unknown): PixelError {
  let caught: unknown;
  try {
    run();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(PixelError);
  const error = caught as PixelError;
  expect(error.code).toBe(code);
  expect(error.message.length).toBeGreaterThan(20);
  return error;
}

describe("invariant 1 — every pixel is a valid palette index or transparent", () => {
  test("rejects an index past the palette", () => {
    const store = makeStore();
    // gb-dmg has 4 colours, so 7 is a legal *cell* but not a legal index here.
    expectRejection("invalid_index", () => store.setPixels([{ x: 0, y: 0, index: 7 }]));
    expect(store.encode()).toBe(encodeGrid(createGrid(8, 8)));
  });

  test("rejects an index past the 255-colour cap", () => {
    const store = makeStore();
    expectRejection("invalid_index", () => store.setPixels([{ x: 0, y: 0, index: 255 }]));
  });

  test("rejects a negative index that is not the transparent sentinel", () => {
    const store = makeStore();
    expectRejection("invalid_index", () => store.setPixels([{ x: 0, y: 0, index: -2 }]));
  });

  test("rejects a fractional index", () => {
    const store = makeStore();
    expectRejection("invalid_index", () => store.setPixels([{ x: 0, y: 0, index: 1.5 }]));
  });

  test("rejects a character the encoding does not define", () => {
    expectRejection("invalid_encoding", () => decodeGrid("01G3"));
    expectRejection("invalid_encoding", () => decodeGrid("01 3"));
  });

  test("rejects an out-of-palette cell arriving through deserialisation", () => {
    const document = createDocument({ width: 2, height: 2, palette: builtinPalette("gb-dmg") });
    const raw = JSON.parse(JSON.stringify(serializeDocument(document))) as {
      frames: { layers: { grid: string }[] }[];
    };
    // Index 9 is a legal cell character but gb-dmg only defines indices 0-3.
    (raw.frames[0] as { layers: { grid: string }[] }).layers[0] = {
      ...((raw.frames[0] as { layers: { grid: string }[] }).layers[0] as { grid: string }),
      grid: "9.\n..",
    };
    const error = expectRejection("invalid_index", () => deserializeDocument(raw));
    expect(error.message).toContain("(0, 0)");
  });

  test("leaves the document untouched when a batch is rejected", () => {
    const store = makeStore();
    store.setPixels([{ x: 1, y: 1, index: 2 }]);
    const before = store.encode();
    expectRejection("invalid_index", () =>
      store.setPixels([
        { x: 2, y: 2, index: 1 },
        { x: 3, y: 3, index: 9 },
      ]),
    );
    expect(store.encode()).toBe(before);
  });
});

describe("invariant 2 — every pixel is fully opaque or fully transparent", () => {
  test("rejects a palette colour carrying partial alpha", () => {
    expectRejection("alpha_not_binary", () => parseHex("#ff000080"));
    expectRejection("alpha_not_binary", () => parseHex("#00000000"));
  });

  test("accepts an explicitly opaque 8-digit hex", () => {
    expect(parseHex("#3366ccff")).toEqual({ r: 0x33, g: 0x66, b: 0xcc });
  });

  test("there is no partial value between opaque and transparent", () => {
    const store = makeStore();
    store.setPixels([{ x: 0, y: 0, index: 2 }]);
    expect(store.colorAt(0, 0)).toBe(2);
    store.setPixels([{ x: 0, y: 0, index: TRANSPARENT }]);
    expect(store.colorAt(0, 0)).toBe(TRANSPARENT);
  });
});

describe("invariant 3 — dimensions are immutable except via explicit resize", () => {
  test("rejects a write that would extend past the canvas", () => {
    const store = makeStore(8, 8);
    const error = expectRejection("out_of_bounds", () => store.writeRegion(6, 6, "0000\n0000\n0000\n0000"));
    expect(error.message).toContain("(4, 4)");
  });

  test("rejects a ragged grid rather than padding it", () => {
    expectRejection("dimension_mismatch", () => decodeGrid("0123\n012"));
  });

  test("rejects a layer whose grid disagrees with the document", () => {
    expectRejection("dimension_mismatch", () =>
      createDocument({
        width: 4,
        height: 4,
        palette: builtinPalette("gb-dmg"),
        frames: [{ id: "f", durationMs: 100, layers: [{ id: "l", name: "L", visible: true, grid: createGrid(2, 2) }] }],
      }),
    );
  });

  test("the store exposes no way to change width or height", () => {
    const store = makeStore(8, 8);
    const surface = new Set<string>();
    let proto: object | null = Object.getPrototypeOf(store) as object | null;
    while (proto !== null && proto !== Object.prototype) {
      for (const key of Object.getOwnPropertyNames(proto)) surface.add(key);
      proto = Object.getPrototypeOf(proto) as object | null;
    }
    expect([...surface].filter((key) => /resize|setWidth|setHeight|setSize/i.test(key))).toEqual([]);
    expect(store.width).toBe(8);
    expect(store.height).toBe(8);
  });
});

describe("invariant 4 — integer nearest-neighbour rasterisation only", () => {
  test("rejects fractional coordinates", () => {
    const store = makeStore();
    expectRejection("non_integer", () => store.setPixels([{ x: 1.5, y: 0, index: 1 }]));
    expectRejection("non_integer", () => store.shift(0.5, 0));
  });

  test("rejects a fractional scale factor rather than rounding it", () => {
    expectRejection("non_integer", () => scaleGrid(decodeGrid("01\n23"), 1.5));
  });

  test("rejects non-integer dimensions", () => {
    expectRejection("non_integer", () => createGrid(8.5, 8));
  });

  test("scaling introduces no new values", () => {
    const scaled = scaleGrid(decodeGrid("01\n23"), 3);
    expect(new Set(scaled.cells)).toEqual(new Set([0, 1, 2, 3]));
  });
});

describe("invariant 5 — all frames of an asset share dimensions and palette", () => {
  test("rejects a document whose frames disagree on size", () => {
    expectRejection("dimension_mismatch", () =>
      createDocument({
        width: 4,
        height: 4,
        palette: builtinPalette("gb-dmg"),
        frames: [
          { id: "f0", durationMs: 100, layers: [{ id: "a", name: "A", visible: true, grid: createGrid(4, 4) }] },
          { id: "f1", durationMs: 100, layers: [{ id: "b", name: "B", visible: true, grid: createGrid(4, 8) }] },
        ],
      }),
    );
  });

  test("rejects a serialised frame that decodes to another size", () => {
    const document = createDocument({ width: 2, height: 2, palette: builtinPalette("gb-dmg"), frameCount: 2 });
    const raw = JSON.parse(JSON.stringify(serializeDocument(document))) as {
      frames: { layers: { grid: string }[] }[];
    };
    (raw.frames[1] as { layers: { grid: string }[] }).layers[0] = {
      ...((raw.frames[1] as { layers: { grid: string }[] }).layers[0] as { grid: string }),
      grid: "...\n...\n...",
    };
    expectRejection("frame_mismatch", () => deserializeDocument(raw));
  });

  test("one palette serves every frame", () => {
    const store = createStore(
      createDocument({ width: 4, height: 4, palette: builtinPalette("gb-dmg"), frameCount: 3 }),
    );
    store.selectFrame(2);
    expectRejection("invalid_index", () => store.setPixels([{ x: 0, y: 0, index: 5 }]));
    expect(store.palette.colors).toHaveLength(4);
  });

  test("rejects a palette over the 255-colour cap", () => {
    expectRejection("palette_overflow", () =>
      createDocument({
        width: 2,
        height: 2,
        palette: Array.from({ length: 256 }, (_, i) => `#${i.toString(16).padStart(6, "0")}`),
      }),
    );
  });
});

describe("enforcement lives at the boundary", () => {
  test("snapshots are copies, so external writes cannot reach store state", () => {
    const store = makeStore(4, 4);
    store.setPixels([{ x: 0, y: 0, index: 1 }]);

    const snapshot = store.snapshot();
    snapshot.frames[0]?.layers[0]?.grid.cells.fill(3);
    expect(store.colorAt(0, 0)).toBe(1);
    expect(store.colorAt(1, 1)).toBe(TRANSPARENT);

    const layer = store.readLayer();
    layer.cells.fill(2);
    expect(store.colorAt(0, 0)).toBe(1);
  });

  test("the document handed to the constructor is not shared with the store", () => {
    const document = createDocument({ width: 4, height: 4, palette: builtinPalette("gb-dmg") });
    const store = createStore(document);
    document.frames[0]?.layers[0]?.grid.cells.fill(2);
    expect(store.colorAt(0, 0)).toBe(TRANSPARENT);
  });

  test("private state is not reachable by name", () => {
    const store = makeStore();
    expect(Object.keys(store)).toEqual([]);
    expect(Object.getOwnPropertyNames(store)).toEqual([]);
    expect(JSON.parse(JSON.stringify(store)) as unknown).toEqual({});
  });
});
