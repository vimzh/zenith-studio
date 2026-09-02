import { describe, expect, test } from "bun:test";
import { createGrid, encodeGrid, type Grid } from "@zenith/core";
import { mirrorGrid, type Direction } from "@/lib/directions";
import { createRaster, type RasterImage } from "@/lib/pixelize";
import { buildCharacter } from "./pipeline";

/** A small asymmetric sprite, so mirroring is observable. */
function reference(): RasterImage {
  const image = createRaster(16, 16);
  for (let y = 0; y < 16; y += 1) {
    for (let x = 0; x < 16; x += 1) {
      const o = (y * 16 + x) * 4;
      const solid = x < 8 && y > 3;
      image.data[o] = solid ? 220 : 40;
      image.data[o + 1] = solid ? 90 : 40;
      image.data[o + 2] = 60;
      image.data[o + 3] = 255;
    }
  }
  return image;
}

describe("buildCharacter", () => {
  test("completes what it can for free and reports the rest as skipped", async () => {
    const result = await buildCharacter(reference(), { directionSet: "cardinal4" });

    // north is the base; west mirrors from east — but east itself needs a model.
    expect(result.directions.has("north")).toBe(true);
    expect(result.skipped.length).toBeGreaterThan(0);
    expect(result.steps.map((s) => s.step)).toEqual([
      "pixelize",
      "plan_directions",
      "generate_directions",
      "animate",
      "export_spritesheet",
    ]);
  });

  test("uses the injected generator and marks provenance honestly", async () => {
    const generated: Direction[] = [];
    const result = await buildCharacter(reference(), {
      directionSet: "cardinal4",
      generateDirection: (base, direction) => {
        generated.push(direction);
        return base;
      },
    });

    expect(result.skipped).toEqual([]);
    expect(result.directions.size).toBe(4);
    expect(result.directions.get("north")?.provenance).toBe("drawn");
    expect(result.directions.get("west")?.provenance).toBe("mirrored");
    for (const direction of generated) {
      expect(result.directions.get(direction)?.provenance).toBe("generated");
    }
  });

  test("mirrors rather than generating wherever it can — the cost argument", async () => {
    let calls = 0;
    await buildCharacter(reference(), {
      directionSet: "ordinal8",
      generateDirection: (base) => {
        calls += 1;
        return base;
      },
    });
    // Eight directions, one is the base, three are mirrors: four generations.
    expect(calls).toBe(4);
  });

  test("a mirrored direction really is the horizontal flip of its source", async () => {
    const result = await buildCharacter(reference(), {
      directionSet: "side2",
      generateDirection: (base) => base,
    });
    const east = result.directions.get("east") as { grid: Grid };
    const west = result.directions.get("west") as { grid: Grid };
    expect(encodeGrid(west.grid)).toBe(encodeGrid(mirrorGrid(east.grid)));
  });

  test("every produced frame shares the document's dimensions", async () => {
    const result = await buildCharacter(reference(), {
      directionSet: "cardinal4",
      generateDirection: (base) => base,
    });
    const { w, h } = result.sheet.atlas.meta.size;
    expect(w).toBeGreaterThan(0);
    expect(h).toBeGreaterThan(0);
    for (const frame of result.sheet.atlas.frames) {
      expect(frame.sourceSize).toEqual(result.sheet.atlas.frames[0]?.sourceSize as never);
    }
  });

  test("tags every animation so an engine can find its ranges", async () => {
    const result = await buildCharacter(reference(), {
      directionSet: "side2",
      generateDirection: (base) => base,
      animations: [{ name: "idle", preset: "bob", frames: 2 }],
    });
    const names = result.sheet.atlas.meta.frameTags.map((tag) => tag.name);
    expect(names).toContain("east_idle");
    expect(names).toContain("west_idle");
  });

  test("skipping animations yields one frame per direction", async () => {
    const result = await buildCharacter(reference(), {
      directionSet: "side2",
      generateDirection: (base) => base,
      animations: [],
    });
    expect(result.sheet.atlas.frames).toHaveLength(2);
  });

  test("respects an explicit target size", async () => {
    const result = await buildCharacter(reference(), {
      directionSet: "side2",
      targetWidth: 8,
      generateDirection: (base) => base,
    });
    expect(result.pixelised.grid.width).toBe(8);
  });

  test("uses the caller's declared base direction instead of guessing it", async () => {
    const result = await buildCharacter(reference(), {
      directionSet: "cardinal4",
      baseDirection: "south",
      animations: [],
    });
    expect(result.directions.has("south")).toBe(true);
    expect(result.directions.has("north")).toBe(false);
  });

  test("rejects a base direction outside the requested set", async () => {
    await expect(buildCharacter(reference(), { directionSet: "side2", baseDirection: "south" })).rejects.toThrow(
      /not part of 'side2'/,
    );
  });

  test("awaits an asynchronous generator", async () => {
    const result = await buildCharacter(reference(), {
      directionSet: "side2",
      generateDirection: async (base) => {
        await Promise.resolve();
        return base;
      },
    });
    expect(result.skipped).toEqual([]);
  });

  test("every step reports what it actually did", async () => {
    const result = await buildCharacter(reference(), {
      directionSet: "cardinal4",
      generateDirection: (base) => base,
    });
    for (const step of result.steps) {
      expect(step.detail.length).toBeGreaterThan(0);
    }
    expect(result.steps[1]?.detail).toContain("mirroring");
  });

  test("is deterministic given a deterministic generator", async () => {
    const run = async () =>
      JSON.stringify(
        (
          await buildCharacter(reference(), {
            directionSet: "cardinal4",
            generateDirection: (base) => base,
          })
        ).sheet.atlas
      );
    const first = await run();
    expect(await run()).toBe(first);
  });

  test("propagates a generator failure rather than producing a half-built sheet", async () => {
    await expect(
      buildCharacter(reference(), {
        directionSet: "cardinal4",
        generateDirection: () => {
          throw new Error("model unavailable");
        },
      })
    ).rejects.toThrow(/model unavailable/);
  });

  test("handles a blank reference without crashing", async () => {
    const blank = createRaster(8, 8);
    const result = await buildCharacter(blank, { directionSet: "side2" });
    expect(result.pixelised.grid.width).toBeGreaterThan(0);
    expect(createGrid(1, 1)).toBeDefined();
  });
});
