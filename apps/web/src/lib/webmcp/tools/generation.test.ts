import { describe, expect, test } from "bun:test";
import { generationKind, planVariationFamily } from "./generation";

test("transparent isolated tiles use sprite framing instead of opaque texture framing", () => {
  expect(generationKind("tile")).toBe("texture");
  expect(generationKind("tile", "transparent")).toBe("sprite");
});

describe("planVariationFamily", () => {
  test("builds distinct source-faithful directions", () => {
    const plan = planVariationFamily(
      "Wooden chest",
      4,
      "dungeon loot progression",
      "wild",
    );

    expect(plan).toHaveLength(4);
    expect(new Set(plan.map((item) => item.name)).size).toBe(4);
    expect(plan.every((item) => item.name.startsWith("Wooden chest — "))).toBe(
      true,
    );
    expect(
      plan.every((item) =>
        item.instruction.includes("dungeon loot progression"),
      ),
    ).toBe(true);
    expect(
      plan.every((item) =>
        item.instruction.includes("source object's identity"),
      ),
    ).toBe(true);
  });

  test("lets an agent supply original concepts", () => {
    const plan = planVariationFamily("Chest", 2, undefined, "inventive", [
      "Clockwork mimic: brass teeth and a winding key",
      "Sunken reliquary: coral, pearls, and oxidised bands",
    ]);

    expect(plan.map((item) => item.name)).toEqual([
      "Chest — Clockwork mimic",
      "Chest — Sunken reliquary",
    ]);
    expect(plan[1]?.instruction).toContain("coral, pearls, and oxidised bands");
  });
});
