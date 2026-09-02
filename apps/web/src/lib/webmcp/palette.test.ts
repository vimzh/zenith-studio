import { beforeEach, describe, expect, test } from "bun:test";
import { ZOOM_LEVELS } from "@/lib/pixel";
import { session } from "@/lib/editor";
import {
  TOOLS,
  findTool,
  jumpForTool,
  runTool,
  toolRunnerState,
  viewportChannel,
  viewportForRegion,
  visibleRegion,
  type ToolDefinition,
} from "./index";

describe("jumpForTool", () => {
  test("stays put when the editor is already open", () => {
    expect(jumpForTool("/asset/asset_001", "asset_001", "asset_001")).toEqual({
      route: null,
      reachable: true,
    });
  });

  test("opens the active asset when chosen from the library", () => {
    expect(jumpForTool("/home", "asset_002", "asset_001")).toEqual({
      route: "/asset/asset_002",
      reachable: true,
    });
  });

  test("falls back to the first asset when nothing is active", () => {
    expect(jumpForTool("/home", null, "asset_001")).toEqual({
      route: "/asset/asset_001",
      reachable: true,
    });
  });

  test("reports unreachable when the library is empty", () => {
    expect(jumpForTool("/home", null, null)).toEqual({ route: null, reachable: false });
  });

  test("treats any non-editor route the same way", () => {
    expect(jumpForTool("/settings", null, "asset_001").route).toBe("/asset/asset_001");
  });
});

describe("tool runner state", () => {
  beforeEach(() => {
    toolRunnerState.select((TOOLS[0] as { name: string }).name);
  });

  test("selecting a tool loads its example arguments", () => {
    toolRunnerState.select("fill_region");
    expect(toolRunnerState.snapshot.name).toBe("fill_region");
    expect(JSON.parse(toolRunnerState.snapshot.args) as Record<string, unknown>).toEqual({
      x: 0,
      y: 0,
      width: 8,
      height: 8,
      index: 1,
    });
  });

  test("keeps a stable snapshot reference between changes", () => {
    const first = toolRunnerState.snapshot;
    toolRunnerState.select(first.name);
    expect(toolRunnerState.snapshot).toBe(first);
  });

  test("editing arguments does not reset the tool", () => {
    toolRunnerState.select("bucket_fill");
    toolRunnerState.setArgs('{"x":9,"y":9,"index":2}');
    expect(toolRunnerState.snapshot.name).toBe("bucket_fill");
    expect(toolRunnerState.snapshot.args).toBe('{"x":9,"y":9,"index":2}');
  });

  test("ignores a tool that does not exist", () => {
    toolRunnerState.select("read_canvas");
    toolRunnerState.select("not_a_tool");
    expect(toolRunnerState.snapshot.name).toBe("read_canvas");
  });

  /** Focus is taken only when asked, so the dropdown does not lose it mid-selection. */
  test("only bumps the focus request when focus is asked for", () => {
    const before = toolRunnerState.snapshot.focusRequest;
    toolRunnerState.select("get_palette");
    expect(toolRunnerState.snapshot.focusRequest).toBe(before);

    toolRunnerState.select("undo", { focus: true });
    expect(toolRunnerState.snapshot.focusRequest).toBe(before + 1);
  });

  test("re-selecting the same tool with focus still asks for focus", () => {
    toolRunnerState.select("undo", { focus: true });
    const before = toolRunnerState.snapshot.focusRequest;
    toolRunnerState.select("undo", { focus: true });
    expect(toolRunnerState.snapshot.focusRequest).toBe(before + 1);
  });

  test("every tool in the registry can be selected", () => {
    for (const tool of TOOLS) {
      toolRunnerState.select(tool.name);
      expect(toolRunnerState.snapshot.name).toBe(tool.name);
      expect(() => JSON.parse(toolRunnerState.snapshot.args) as unknown).not.toThrow();
    }
  });
});

describe("viewport", () => {
  const asset = { width: 32, height: 32 };

  beforeEach(() => {
    viewportChannel.reset();
  });

  test("reports the visible region clamped to the asset", () => {
    const region = visibleRegion(
      { originX: -4, originY: -4, zoom: 8, viewWidth: 512, viewHeight: 512 },
      asset.width,
      asset.height,
    );
    expect(region).toEqual({ x: 0, y: 0, width: 32, height: 32 });
  });

  test("reports a partial view when zoomed in", () => {
    const region = visibleRegion(
      { originX: 8, originY: 4, zoom: 16, viewWidth: 256, viewHeight: 256 },
      asset.width,
      asset.height,
    );
    expect(region).toEqual({ x: 8, y: 4, width: 16, height: 16 });
  });

  /**
   * Asserted as a property rather than a number: the zoom ladder is the
   * editor's to change, and it has already gained 3x/6x/12x/24x since this was
   * written. What must hold is that the chosen level fits and the next does not.
   */
  test("frames a region at the largest integer zoom that fits", () => {
    const padding = 16;
    const view = 256;
    const available = view - padding * 2;
    const placement = viewportForRegion({ x: 8, y: 8, width: 8, height: 8 }, view, view, padding);

    expect(ZOOM_LEVELS).toContain(placement.zoom as (typeof ZOOM_LEVELS)[number]);
    expect(8 * placement.zoom).toBeLessThanOrEqual(available);

    const next = ZOOM_LEVELS[ZOOM_LEVELS.indexOf(placement.zoom as (typeof ZOOM_LEVELS)[number]) + 1];
    if (next !== undefined) expect(8 * next).toBeGreaterThan(available);

    // Centred: the region's midpoint sits at the middle of the view.
    expect(placement.originX + view / (2 * placement.zoom)).toBe(12);
    expect(placement.originY + view / (2 * placement.zoom)).toBe(12);
  });

  test("never chooses a fractional zoom to make a region fit exactly", () => {
    for (const width of [3, 5, 7, 11, 13, 17, 31]) {
      const placement = viewportForRegion({ x: 0, y: 0, width, height: width }, 300, 300);
      expect(Number.isInteger(placement.zoom)).toBe(true);
      expect(ZOOM_LEVELS).toContain(placement.zoom as (typeof ZOOM_LEVELS)[number]);
    }
  });

  test("is disconnected until the editor subscribes", () => {
    expect(viewportChannel.connected).toBe(false);
    const unsubscribe = viewportChannel.subscribe(() => undefined);
    expect(viewportChannel.connected).toBe(true);
    unsubscribe();
    expect(viewportChannel.connected).toBe(false);
  });

  test("delivers a request to the editor and clears once consumed", () => {
    let notified = 0;
    const unsubscribe = viewportChannel.subscribe(() => {
      notified += 1;
    });

    viewportChannel.request({ x: 4, y: 4, width: 8, height: 8 });
    expect(notified).toBe(1);
    expect(viewportChannel.peekRequest()).toEqual({ x: 4, y: 4, width: 8, height: 8 });

    viewportChannel.clearRequest();
    expect(viewportChannel.peekRequest()).toBeNull();
    unsubscribe();
  });
});

/** A tool that moved nothing must not report that it did. */
describe("viewport tools without a wired editor", () => {
  beforeEach(() => {
    viewportChannel.reset();
    for (const entry of session.list()) session.close(entry.id);
    session.create({ name: "tile", preset: "tile-32" });
  });

  test("get_viewport says the editor is not reporting rather than inventing one", async () => {
    const definition = findTool("get_viewport") as ToolDefinition;
    const outcome = await runTool(definition, {}, "console");
    expect(outcome.ok).toBe(false);
    expect(outcome.text).toContain("not reporting its viewport");
  });

  test("focus_viewport refuses rather than claiming a move that did not happen", async () => {
    const definition = findTool("focus_viewport") as ToolDefinition;
    const outcome = await runTool(definition, { x: 0, y: 0, width: 8, height: 8 }, "console");
    expect(outcome.ok).toBe(false);
    expect(outcome.text).toContain("not reporting its viewport");
  });

  test("focus_viewport reports the move once the editor is wired", async () => {
    const unsubscribe = viewportChannel.subscribe(() => undefined);
    const definition = findTool("focus_viewport") as ToolDefinition;

    const outcome = await runTool(definition, { x: 4, y: 4, width: 8, height: 8 }, "console");
    expect(outcome.ok).toBe(true);
    expect(outcome.text).toContain("(4, 4) 8x8");
    expect(viewportChannel.peekRequest()).toEqual({ x: 4, y: 4, width: 8, height: 8 });
    unsubscribe();
  });

  test("focus_viewport rejects a region larger than the asset", async () => {
    const unsubscribe = viewportChannel.subscribe(() => undefined);
    const definition = findTool("focus_viewport") as ToolDefinition;

    const outcome = await runTool(definition, { x: 28, y: 28, width: 16, height: 16 }, "console");
    expect(outcome.ok).toBe(false);
    expect(outcome.text).toContain("extends past the 32x32 asset");
    unsubscribe();
  });
});
