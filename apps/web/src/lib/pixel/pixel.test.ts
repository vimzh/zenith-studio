import { describe, expect, test } from "bun:test";
import { CANVAS_PRESETS, findPreset, presetsAreValid } from "./presets";
import { applyOpacity, buildStroke, dedupe, line, pixelPerfect } from "./stroke";
import { requireIntegerScale } from "./scale";
import {
  INITIAL_VIEWPORT,
  ZOOM_LEVELS,
  artToScreen,
  fitToViewport,
  nextZoom,
  pan,
  screenToArt,
  zoomAtPoint,
} from "./viewport";

describe("presets", () => {
  test("every preset respects the 16-colour cap", () => {
    expect(presetsAreValid()).toBe(true);
  });

  test("NES sprite preset is 3 colours, matching the PPU limit", () => {
    expect(findPreset("nes-sprite")?.colors).toHaveLength(3);
  });

  test("Game Boy preset is 4 shades at 16x16", () => {
    const preset = findPreset("gb-4");
    expect(preset?.colors).toHaveLength(4);
    expect(preset?.width).toBe(16);
  });

  test("preset ids are unique", () => {
    const ids = CANVAS_PRESETS.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("all colours are lowercase #rrggbb", () => {
    for (const preset of CANVAS_PRESETS) {
      for (const color of preset.colors) {
        expect(color).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });
});

describe("viewport", () => {
  test("every zoom level is a whole-number scale factor", () => {
    for (const zoom of ZOOM_LEVELS) {
      expect(Number.isInteger(zoom)).toBe(true);
      expect(zoom).toBeGreaterThan(0);
    }
  });

  test("zoom levels ascend, and no step more than doubles", () => {
    for (let i = 1; i < ZOOM_LEVELS.length; i += 1) {
      const previous = ZOOM_LEVELS[i - 1]!;
      const current = ZOOM_LEVELS[i]!;
      expect(current).toBeGreaterThan(previous);
      expect(current / previous).toBeLessThanOrEqual(2);
    }
  });

  test("zoom clamps at both ends rather than wrapping", () => {
    expect(nextZoom(1, -1)).toBe(1);
    expect(nextZoom(32, 1)).toBe(32);
  });

  test("screenToArt and artToScreen round-trip", () => {
    const viewport = { originX: 3, originY: 7, zoom: 8 } as const;
    const screen = artToScreen(viewport, 12, 20);
    expect(screenToArt(viewport, screen.x, screen.y)).toEqual({ x: 12, y: 20 });
  });

  test("screenToArt floors, so a partial pixel resolves to the pixel containing it", () => {
    const viewport = { originX: 0, originY: 0, zoom: 8 } as const;
    expect(screenToArt(viewport, 15, 25)).toEqual({ x: 1, y: 3 });
  });

  test("zoomAtPoint holds the art pixel under the cursor in place", () => {
    const before = { originX: 0, originY: 0, zoom: 8 } as const;
    const cursor = { x: 120, y: 80 };
    const artBefore = screenToArt(before, cursor.x, cursor.y);

    const after = zoomAtPoint(before, 1, cursor.x, cursor.y);
    expect(after.zoom).toBe(12);
    expect(screenToArt(after, cursor.x, cursor.y)).toEqual(artBefore);
  });

  test("pan moves the origin against the drag, scaled by zoom", () => {
    const panned = pan({ originX: 10, originY: 10, zoom: 4 }, 8, -4);
    expect(panned.originX).toBe(8);
    expect(panned.originY).toBe(11);
  });

  test("fitToViewport picks the largest zoom that still fits", () => {
    const viewport = fitToViewport(32, 32, 640, 480, 32);
    expect(viewport.zoom).toBe(12); // 32*16=512 > 480-64=416; 32*12=384 fits
    expect(ZOOM_LEVELS).toContain(viewport.zoom);
  });

  test("fitToViewport never drops below 1x, even for an oversized document", () => {
    expect(fitToViewport(4096, 4096, 100, 100).zoom).toBe(1);
  });

  test("initial viewport uses a zoom level that exists", () => {
    expect(ZOOM_LEVELS).toContain(INITIAL_VIEWPORT.zoom);
  });
});

describe("stroke", () => {
  test("line includes both endpoints", () => {
    const points = line({ x: 0, y: 0 }, { x: 3, y: 0 });
    expect(points).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
    ]);
  });

  test("line is gap-free — every step is adjacent", () => {
    const points = line({ x: 0, y: 0 }, { x: 17, y: 9 });
    for (let i = 1; i < points.length; i += 1) {
      const previous = points[i - 1]!;
      const current = points[i]!;
      expect(Math.abs(current.x - previous.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(current.y - previous.y)).toBeLessThanOrEqual(1);
    }
  });

  test("line handles a single point", () => {
    expect(line({ x: 5, y: 5 }, { x: 5, y: 5 })).toEqual([{ x: 5, y: 5 }]);
  });

  test("pixelPerfect removes the L-shaped corner", () => {
    // (0,0) -> (1,0) -> (1,1): the middle pixel is the lump a pixel artist would not draw.
    const cleaned = pixelPerfect([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
    ]);
    expect(cleaned).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ]);
  });

  test("pixelPerfect keeps a straight run intact", () => {
    const straight = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
    ];
    expect(pixelPerfect(straight)).toEqual(straight);
  });

  test("pixelPerfect keeps an existing clean diagonal", () => {
    const diagonal = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 2 },
    ];
    expect(pixelPerfect(diagonal)).toEqual(diagonal);
  });

  test("dedupe collapses repeated pointer samples", () => {
    const deduped = dedupe([
      { x: 1, y: 1 },
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 2, y: 1 },
    ]);
    expect(deduped).toEqual([
      { x: 1, y: 1 },
      { x: 2, y: 1 },
    ]);
  });

  test("buildStroke fills gaps between sparse pointer samples", () => {
    const stroke = buildStroke([
      { x: 0, y: 0 },
      { x: 5, y: 0 },
    ]);
    expect(stroke).toHaveLength(6);
  });

  test("buildStroke can opt out of pixel-perfect cleanup", () => {
    const samples = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
    ];
    expect(buildStroke(samples, false)).toHaveLength(3);
    expect(buildStroke(samples, true)).toHaveLength(2);
  });

  test("buildStroke handles an empty sample list", () => {
    expect(buildStroke([])).toEqual([]);
  });

  test("opacity uses binary ordered coverage", () => {
    const block = Array.from({ length: 16 }, (_, offset) => ({ x: offset % 4, y: Math.floor(offset / 4) }));
    expect(applyOpacity(block, 0)).toHaveLength(0);
    expect(applyOpacity(block, 50)).toHaveLength(8);
    expect(applyOpacity(block, 100)).toEqual(block);
  });
});

describe("scale guard", () => {
  test("accepts positive integers", () => {
    expect(requireIntegerScale(4)).toBe(4);
  });

  test("rejects fractional and zero scales", () => {
    expect(() => requireIntegerScale(1.5)).toThrow(/integer/);
    expect(() => requireIntegerScale(0)).toThrow(/at least 1/);
  });
});
