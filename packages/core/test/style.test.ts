import { describe, expect, test } from "bun:test";
import {
  builtinPalette,
  checkStyleConsistency,
  conformToStyle,
  createStyleProfile,
  createPalette,
  decodeGrid,
  describeStyleReport,
  encodeGrid,
  expectedSize,
  styleBrief,
} from "../src/index";

const palette = builtinPalette("gb-dmg"); // 4 colours: indices 0-3
const profile = createStyleProfile(palette, { canvasSizes: { character: 4, tile: 4, texture: 4, item: 4, ui: 4 } });

describe("createStyleProfile", () => {
  test("fills the defaults a project needs to be usable immediately", () => {
    const created = createStyleProfile(palette);
    expect(created.canvasSizes.character).toBe(32);
    expect(created.canvasSizes.item).toBe(16);
    expect(created.view).toBe("side");
    expect(created.outline).toBe("dark");
    expect(created.references).toEqual([]);
  });

  test("overrides survive and the palette is the one given", () => {
    const created = createStyleProfile(palette, { view: "high top-down", directionSet: "cardinal4" });
    expect(created.view).toBe("high top-down");
    expect(created.directionSet).toBe("cardinal4");
    expect(created.palette.colors).toHaveLength(4);
  });

  test("expectedSize answers per type, and null for a type it does not govern", () => {
    const created = createStyleProfile(palette);
    expect(expectedSize(created, "character")).toBe(32);
    expect(expectedSize(created, "ui")).toBe(16);
    expect(expectedSize(created, "world")).toBeNull();
  });
});

describe("checkStyleConsistency", () => {
  test("passes an asset that matches the contract", () => {
    const report = checkStyleConsistency([decodeGrid("0123\n1230\n2301\n3012")], profile, "tile");
    expect(report.conforms).toBe(true);
    expect(report.violations).toEqual([]);
  });

  /** Coordinates, not a verdict — so a fix can target exactly those pixels. */
  test("locates every out-of-palette pixel", () => {
    const report = checkStyleConsistency([decodeGrid("0129\n1230\n2301\nA012")], profile, "tile");
    expect(report.conforms).toBe(false);

    const violation = report.violations.find((each) => each.kind === "palette");
    expect(violation?.coordinates).toEqual([
      [3, 0],
      [0, 3],
    ]);
    expect(violation?.message).toContain("allows 4 colours");
    expect(violation?.message).toContain("conform_to_style");
  });

  test("compares actual colours, not merely palette indices", () => {
    const source = createPalette({ colors: ["#ff0000", "#00ff00", "#0000ff", "#ffffff"] });
    const report = checkStyleConsistency(
      [decodeGrid("0123\n1230\n2301\n3012")],
      profile,
      "tile",
      source,
    );
    expect(report.violations.find((each) => each.kind === "palette")?.coordinates).toHaveLength(16);
  });

  test("reports a size mismatch against the type's expected size", () => {
    const report = checkStyleConsistency([decodeGrid("01\n23")], profile, "tile");
    const violation = report.violations.find((each) => each.kind === "size");
    expect(violation?.message).toContain("2x2");
    expect(violation?.message).toContain("4x4");
    // Resize crops or pads; scaling would resample the art.
    expect(violation?.message).toContain("rather than scaling");
  });

  test("checks every frame, not only the first", () => {
    const clean = decodeGrid("0123\n1230\n2301\n3012");
    const dirty = decodeGrid("0123\n1230\n2301\n301F");
    expect(checkStyleConsistency([clean, dirty], profile, "tile").conforms).toBe(false);
  });

  test("transparency is never a violation", () => {
    expect(checkStyleConsistency([decodeGrid("0.2.\n.23.\n2.01\n.012")], profile, "tile").conforms).toBe(true);
  });

  test("a type the profile does not govern is not size-checked", () => {
    const report = checkStyleConsistency([decodeGrid("01\n23")], profile, "world");
    expect(report.violations.some((each) => each.kind === "size")).toBe(false);
  });

  test("refuses an empty frame list rather than passing vacuously", () => {
    expect(() => checkStyleConsistency([], profile, "tile")).toThrow(/at least one grid/);
  });

  /**
   * Only what a grid can actually prove. Outline, shading and proportions are
   * judgements a model makes, not properties a raster has, and reporting on them
   * would be a verdict dressed as a measurement.
   */
  test("reports only the deterministic aspects", () => {
    const report = checkStyleConsistency([decodeGrid("01\n2F")], profile, "tile");
    const kinds = new Set(report.violations.map((each) => each.kind));
    expect([...kinds].every((kind) => ["palette", "size", "alpha"].includes(kind))).toBe(true);
  });
});

describe("describeStyleReport", () => {
  test("states conformance plainly", () => {
    expect(describeStyleReport(checkStyleConsistency([decodeGrid("0123\n1230\n2301\n3012")], profile, "tile"), "hero"))
      .toContain("conforms to the project style");
  });

  test("lists coordinates for the violations that have them", () => {
    const text = describeStyleReport(checkStyleConsistency([decodeGrid("012F\n1230\n2301\n3012")], profile, "tile"), "slime");
    expect(text).toContain("[palette]");
    expect(text).toContain("(3, 0)");
  });
});

describe("conformToStyle", () => {
  test("remaps out-of-palette pixels and reports how many changed", () => {
    const result = conformToStyle(decodeGrid("012F\n1230\n2301\n3012"), profile, "tile");
    expect(result.changed).toBe(1);
    expect(encodeGrid(result.grid)).toBe("0123\n1230\n2301\n3012");
  });

  test("remaps source colours perceptually into the project palette", () => {
    const source = createPalette({ colors: ["#103910", "#fefefe"] });
    const result = conformToStyle(decodeGrid("01\n10"), profile, "tile", source);
    expect(encodeGrid(result.grid).startsWith("03..\n30..")).toBe(true);
  });

  /** The pixel was drawn deliberately; erasing it to enforce a colour rule loses art. */
  test("clamps an out-of-range index rather than erasing the pixel", () => {
    const result = conformToStyle(decodeGrid("F0\n01"), profile, "tile");
    // gb-dmg has 4 colours, so F clamps to 3 — still opaque, still there.
    expect(encodeGrid(result.grid).charAt(0)).toBe("3");
  });

  test("leaves transparency exactly as it was", () => {
    const result = conformToStyle(decodeGrid("0.2.\n.23.\n2.01\n.012"), profile, "tile");
    expect(encodeGrid(result.grid)).toBe("0.2.\n.23.\n2.01\n.012");
    expect(result.changed).toBe(0);
  });

  /** Scaling would resample the art, which is the one thing this pipeline never does. */
  test("resizes by cropping and padding, never by scaling", () => {
    const bigger = conformToStyle(decodeGrid("012301\n123012\n230123\n301230\n012301\n123012"), profile, "tile");
    expect(bigger.resized).toBe(true);
    expect(bigger.grid.width).toBe(4);
    // Top-left 4x4 preserved verbatim — cropped, not squashed.
    expect(encodeGrid(bigger.grid)).toBe("0123\n1230\n2301\n3012");

    const smaller = conformToStyle(decodeGrid("01\n23"), profile, "tile");
    expect(smaller.grid.width).toBe(4);
    // Padded with transparency, original content intact at the origin.
    expect(encodeGrid(smaller.grid)).toBe("01..\n23..\n....\n....");
  });

  test("leaves a governed-size asset alone when it already conforms", () => {
    const result = conformToStyle(decodeGrid("0123\n1230\n2301\n3012"), profile, "tile");
    expect(result.resized).toBe(false);
    expect(result.changed).toBe(0);
  });

  test("does not resize a type the profile does not govern", () => {
    const result = conformToStyle(decodeGrid("01\n23"), profile, "world");
    expect(result.resized).toBe(false);
    expect(result.grid.width).toBe(2);
  });

  /** Conformance is arithmetic, so it must not depend on being run once. */
  test("is idempotent and deterministic", () => {
    const once = conformToStyle(decodeGrid("F12A\n1230\n2301\n3012"), profile, "tile");
    const twice = conformToStyle(once.grid, profile, "tile");
    expect(encodeGrid(twice.grid)).toBe(encodeGrid(once.grid));
    expect(twice.changed).toBe(0);

    const again = conformToStyle(decodeGrid("F12A\n1230\n2301\n3012"), profile, "tile");
    expect(encodeGrid(again.grid)).toBe(encodeGrid(once.grid));
  });

  test("its output passes the check that motivated it", () => {
    const dirty = decodeGrid("F12A9\n12309\n23019\n30129\n01239");
    const conformed = conformToStyle(dirty, profile, "tile");
    expect(checkStyleConsistency([conformed.grid], profile, "tile").conforms).toBe(true);
  });
});

describe("styleBrief", () => {
  test("states every instruction a model can act on", () => {
    const brief = styleBrief(createStyleProfile(palette, { view: "high top-down", outline: "darker-hue", shading: "detailed" }), "character");
    expect(brief).toContain("high top-down view");
    expect(brief).toContain("orthographic");
    expect(brief).toContain("darker shade of each form's own colour");
    expect(brief).toContain("Layered shading");
    expect(brief).toContain("#0f380f");
  });

  /**
   * A palette stated as a law is right for reading the contract and wrong for
   * drawing against it. Told to use only sixteen named colours, an image model
   * reaches for the nearest listed shade instead of the right one, and every
   * asset in the project comes back looking like the last one. The palette
   * stays in the profile — `check_style_consistency` and `conform_to_style`
   * still enforce it exactly — it simply stops narrowing the model's hand.
   */
  test("states the palette as a law only when asked to", () => {
    const profile = createStyleProfile(palette);
    expect(styleBrief(profile, "character")).toContain("Use only these 4 colours");
    expect(styleBrief(profile, "character", { lockPalette: true })).toContain("Use only these");

    const free = styleBrief(profile, "character", { lockPalette: false });
    expect(free).not.toContain("Use only these");
    expect(free).not.toContain("#0f380f");
    // Everything that is not colour still travels.
    expect(free).toContain("side view");
    expect(free).toContain("solid dark outline");
  });

  /**
   * The failure that dominates everything else: art composed finer than the
   * target grid dissolves when resampled, however good it looks at 1024px.
   */
  test("bounds feature count to what the target grid can hold", () => {
    expect(styleBrief(createStyleProfile(palette), "item")).toContain("16x16 pixel grid");
    expect(styleBrief(createStyleProfile(palette), "item")).toContain("at most 4 distinct shapes");
    expect(styleBrief(createStyleProfile(palette), "character")).toContain("at most 8 distinct shapes");
  });

  test("omits the size instruction for a type the profile does not govern", () => {
    expect(styleBrief(createStyleProfile(palette), "world")).not.toContain("pixel grid");
    expect(styleBrief(createStyleProfile(palette))).not.toContain("pixel grid");
  });

  test("carries free-text direction through, and says nothing when there is none", () => {
    expect(styleBrief(createStyleProfile(palette, { notes: "damp forest ruins" }))).toContain(
      "Art direction: damp forest ruins",
    );
    expect(styleBrief(createStyleProfile(palette))).not.toContain("Art direction");
    expect(styleBrief(createStyleProfile(palette, { notes: "   " }))).not.toContain("Art direction");
  });

  test("says nothing about proportions when they are realistic", () => {
    expect(styleBrief(createStyleProfile(palette, { proportions: "realistic" }))).not.toContain("proportions");
    expect(styleBrief(createStyleProfile(palette, { proportions: "chibi" }))).toContain("very large head");
  });

  /**
   * Neither is an instruction about how one image should look: direction sets
   * govern how many images to make, and references are conditioning that
   * travels as an image rather than as words.
   */
  test("omits what a single image cannot express", () => {
    const brief = styleBrief(createStyleProfile(palette, { directionSet: "ordinal8", references: ["asset_001"] }), "character");
    expect(brief).not.toContain("ordinal8");
    expect(brief).not.toContain("asset_001");
  });

  test("names every palette colour, since the palette is the hard law", () => {
    const brief = styleBrief(createStyleProfile(builtinPalette("pico-8")), "tile");
    for (const colour of builtinPalette("pico-8").colors) {
      expect(brief).toContain(colour.hex);
    }
  });
});
