import { describe, expect, test } from "bun:test";
import {
  builtinPalette,
  createDocument,
  createStore,
  decodeGrid,
  deserializeDocument,
  documentFromJSON,
  documentToJSON,
  serializeDocument,
  TRANSPARENT,
} from "../src/index";
import { createRandom, randomInt, randomPaletteColors } from "./random";

describe("document serialisation", () => {
  test("round-trips 200 random documents through JSON without loss", () => {
    const random = createRandom(0xbeef);

    for (let sample = 0; sample < 200; sample += 1) {
      const width = randomInt(random, 1, 32);
      const height = randomInt(random, 1, 32);
      const colors = randomPaletteColors(random, randomInt(random, 1, 16));
      const frameCount = randomInt(random, 1, 4);

      const document = createDocument({
        name: `sample-${String(sample)}`,
        width,
        height,
        palette: colors,
        frameCount,
      });
      const store = createStore(document);
      for (let frame = 0; frame < frameCount; frame += 1) {
        for (let i = 0; i < 20; i += 1) {
          store.setPixels(
            [
              {
                x: randomInt(random, 0, width - 1),
                y: randomInt(random, 0, height - 1),
                index: random() < 0.2 ? TRANSPARENT : randomInt(random, 0, colors.length - 1),
              },
            ],
            { frame },
          );
        }
      }

      const original = store.snapshot();
      const json = documentToJSON(original);
      const restored = documentFromJSON(json);

      expect(documentToJSON(restored)).toBe(json);
      expect(restored.width).toBe(width);
      expect(restored.height).toBe(height);
      expect(restored.frames).toHaveLength(frameCount);
      for (let frame = 0; frame < frameCount; frame += 1) {
        expect(restored.frames[frame]?.layers[0]?.grid.cells).toEqual(
          original.frames[frame]?.layers[0]?.grid.cells as Int8Array,
        );
      }
    }
  });

  test("stores grids as the indexed text format, not as number arrays", () => {
    const store = createStore(
      createDocument({ width: 2, height: 2, palette: builtinPalette("gb-dmg") }),
    );
    store.writeRegion(0, 0, "01\n2.");
    expect(serializeDocument(store.snapshot()).frames[0]?.layers[0]?.grid).toBe("01\n2.");
  });

  test("carries palette, metadata and frame durations", () => {
    const document = createDocument({
      name: "cobble_01",
      width: 2,
      height: 2,
      palette: builtinPalette("gb-dmg"),
      metadata: { createdAt: "2026-09-02T00:00:00.000Z", tags: ["tile"] },
    });
    const raw = serializeDocument(document);
    expect(raw.palette.id).toBe("gb-dmg");
    expect(raw.palette.colors).toEqual(["#0f380f", "#306230", "#8bac0f", "#9bbc0f"]);
    expect(raw.metadata.createdAt).toBe("2026-09-02T00:00:00.000Z");
    expect(raw.metadata.tags).toEqual(["tile"]);
    expect(raw.frames[0]?.durationMs).toBe(250);
    expect(deserializeDocument(raw).name).toBe("cobble_01");
    const saved = { ...raw, frames: raw.frames.map((frame) => ({ ...frame, durationMs: 100 })) };
    expect(deserializeDocument(saved).frames[0]?.durationMs).toBe(100);
  });

  test("rejects unknown formats and versions", () => {
    const raw = serializeDocument(
      createDocument({ width: 1, height: 1, palette: builtinPalette("gb-dmg") }),
    ) as unknown as Record<string, unknown>;
    expect(() => deserializeDocument({ ...raw, format: "aseprite" })).toThrow(/Unknown format/);
    expect(() => deserializeDocument({ ...raw, version: 99 })).toThrow(/version 99/);
    expect(() => deserializeDocument(null)).toThrow(/received null/);
    expect(() => deserializeDocument([])).toThrow(/received an array/);
  });

  test("names the field and type when a value is wrong", () => {
    const raw = serializeDocument(
      createDocument({ width: 1, height: 1, palette: builtinPalette("gb-dmg") }),
    ) as unknown as Record<string, unknown>;
    expect(() => deserializeDocument({ ...raw, width: "8" })).toThrow(
      /document.width must be a finite number, received string/,
    );
    expect(() => deserializeDocument({ ...raw, frames: [] })).toThrow(/document.frames is empty/);
  });

  test("reports unparseable JSON rather than throwing a SyntaxError", () => {
    expect(() => documentFromJSON("{ nope")).toThrow(/not parseable/);
  });

  test("a document survives a store round trip unchanged", () => {
    const first = createStore(createDocument({ width: 4, height: 4, palette: builtinPalette("pico-8") }));
    first.writeRegion(0, 0, "0123\n4567\n89AB\nCDEF");
    const second = createStore(documentFromJSON(documentToJSON(first.snapshot())));
    expect(second.encode()).toBe(first.encode());
    expect(second.readLayer().cells).toEqual(decodeGrid("0123\n4567\n89AB\nCDEF").cells);
  });
});
