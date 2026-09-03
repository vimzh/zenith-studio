import { beforeEach, describe, expect, test } from "bun:test";
import { session } from "@/lib/editor";
import { findTool, runTool, transcript, type ToolArgs, type ToolDefinition } from "./index";

async function call(name: string, args: ToolArgs = {}): Promise<string> {
  const definition = findTool(name);
  if (definition === undefined) throw new Error(`No tool '${name}'`);
  const outcome = await runTool(definition as ToolDefinition, args, "console");
  if (!outcome.ok) throw new Error(outcome.text);
  return outcome.text;
}

async function callExpectingError(name: string, args: ToolArgs = {}): Promise<string> {
  const definition = findTool(name);
  if (definition === undefined) throw new Error(`No tool '${name}'`);
  const outcome = await runTool(definition as ToolDefinition, args, "console");
  expect(outcome.ok).toBe(false);
  return outcome.text;
}

beforeEach(() => {
  for (const asset of session.list()) session.close(asset.id);
  transcript.clear();
  session.create({ name: "walk", type: "character", preset: "tile-32" });
});

describe("frame structure", () => {
  test("list_frames reports duration, coverage and the selection", async () => {
    await call("fill_region", { x: 0, y: 0, width: 8, height: 8, index: 1 });
    const result = await call("list_frames");
    expect(result).toContain("1 frame(s)");
    expect(result).toContain("250ms");
    expect(result).toContain("64 opaque px");
    expect(result).toContain("[selected]");
  });

  test("add_frame copies pixels when asked and selects the new frame", async () => {
    await call("fill_region", { x: 0, y: 0, width: 4, height: 4, index: 2 });
    expect(await call("add_frame", { copy_from: 0 })).toContain("index 1");
    expect(session.active?.activeFrame).toBe(1);
    expect(session.active?.encode(1)).toBe(session.active?.encode(0));
  });

  test("add_frame without copy_from is blank", async () => {
    await call("fill_region", { x: 0, y: 0, width: 32, height: 32, index: 3 });
    await call("add_frame");
    expect(session.active?.stats(1).opaque).toBe(0);
  });

  test("select_frame redirects the editing tools", async () => {
    await call("add_frame");
    await call("select_frame", { frame_index: 0 });
    await call("set_pixels", { pixels: [{ x: 1, y: 1, index: 4 }] });

    expect(session.active?.colorAt(1, 1, 0)).toBe(4);
    expect(session.active?.colorAt(1, 1, 1)).toBe(-1);
  });

  test("delete_frame refuses the only frame with an actionable message", async () => {
    const message = await callExpectingError("delete_frame", { frame_index: 0 });
    expect(message).toContain("only frame");
    expect(message).toContain("clearRegion");
  });

  test("reorder_frames rejects a partial order rather than dropping art", async () => {
    await call("add_frame");
    await call("add_frame");
    expect(await callExpectingError("reorder_frames", { order: [0, 1] })).toContain("exactly once");
    expect(await callExpectingError("reorder_frames", { order: [0, 1, 1] })).toContain("more than once");
    expect(await callExpectingError("reorder_frames", { order: [0, 1, "2"] })).toContain("must be an integer");
  });

  test("reorder_frames moves frames", async () => {
    await call("fill_region", { x: 0, y: 0, width: 32, height: 32, index: 1 });
    await call("add_frame");
    await call("fill_region", { x: 0, y: 0, width: 32, height: 32, index: 2 });

    await call("reorder_frames", { order: [1, 0] });
    expect(session.active?.colorAt(0, 0, 0)).toBe(2);
    expect(session.active?.colorAt(0, 0, 1)).toBe(1);
  });

  test("set_frame_duration rejects a non-positive hold", async () => {
    expect(await callExpectingError("set_frame_duration", { frame_index: 0, ms: 0 })).toContain("minimum");
    await call("set_frame_duration", { frame_index: 0, ms: 120 });
    expect(session.active?.snapshot().frames[0]?.durationMs).toBe(120);
  });

  test("read_frame returns the grid with its origin stated", async () => {
    await call("fill_region", { x: 0, y: 0, width: 32, height: 1, index: 5 });
    const result = await call("read_frame", { frame_index: 0 });
    expect(result).toContain("origin: top-left, x right, y down");
    expect((result.split("grid:\n")[1] ?? "").split("\n")[0]).toBe("5".repeat(32));
  });

  test("get_silhouette strips colour to a 1-bit mask", async () => {
    await call("fill_region", { x: 0, y: 0, width: 4, height: 1, index: 5 });
    await call("fill_region", { x: 4, y: 0, width: 4, height: 1, index: 9 });
    const mask = await call("get_silhouette");
    expect((mask.split("\n")[1] ?? "").slice(0, 10)).toBe("1111111100");
  });
});

describe("animation perception", () => {
  /** The phase's headline claim: a diff costs a fraction of a full frame read. */
  test("read_frames_diff reports only what moved, well under a full read", async () => {
    await call("fill_region", { x: 0, y: 0, width: 32, height: 32, index: 1 });
    await call("add_frame", { copy_from: 0 });
    await call("set_pixels", {
      pixels: [
        { x: 4, y: 4, index: 3 },
        { x: 5, y: 4, index: 3 },
      ],
    });

    const result = await call("read_frames_diff", { from_index: 0, to_index: 1 });
    expect(result).toContain("2 of 1024 pixels differ");
    expect(result).toContain("(4, 4) 1→3");
    expect(result).toContain("(5, 4) 1→3");
    // Materially smaller than the 1024-character grid a full read returns.
    expect(result.length).toBeLessThan(session.active?.encode(0).length ?? 0);
  });

  test("read_frames_diff says so when frames are identical", async () => {
    await call("add_frame", { copy_from: 0 });
    expect(await call("read_frames_diff", { from_index: 0, to_index: 1 })).toContain("identical");
  });

  test("read_frames_diff refuses to diff a frame against itself", async () => {
    await call("add_frame");
    expect(await callExpectingError("read_frames_diff", { from_index: 1, to_index: 1 })).toContain(
      "two different frames",
    );
  });

  test("read_animation_summary describes motion without a full read", async () => {
    await call("fill_region", { x: 0, y: 0, width: 4, height: 4, index: 1 });
    await call("add_frame", { copy_from: 0 });
    const summary = await call("read_animation_summary");
    expect(summary).toContain("2 frame(s)");
    expect(summary).toContain("centroid");
    // The first frame has no predecessor, so it reports no shift.
    expect(summary.split("\n")[1]).toContain("changed —");
  });

  test("an empty frame reports no centroid rather than one at the origin", async () => {
    await call("add_frame");
    expect(await call("read_animation_summary")).toContain("empty");
  });
});

describe("animation authoring", () => {
  test("animate_procedural builds a cycle as one undo step", async () => {
    await call("fill_region", { x: 8, y: 8, width: 16, height: 16, index: 6 });
    const result = await call("animate_procedural", { preset: "bob", frames: 4 });

    expect(result).toContain("4-frame bob cycle");
    expect(session.active?.frameCount).toBe(4);
    expect(session.active?.history().at(-1)).toBe("animate_procedural (bob)");
    expect(session.active?.snapshot().frames.map((frame) => frame.durationMs)).toEqual([250, 250, 250, 250]);

    session.active?.undo();
    expect(session.active?.frameCount).toBe(1);
  });

  test("scroll wraps, so a seamless tile stays seamless", async () => {
    await call("write_region", { x: 0, y: 0, grid: Array.from({ length: 32 }, () => "00112233001122330011223300112233").join("\n") });
    await call("animate_procedural", { preset: "scroll", frames: 4, dx: 1 });

    const before = session.active?.stats(0).opaque;
    for (let frame = 1; frame < (session.active?.frameCount ?? 0); frame += 1) {
      // Wrapping moves pixels without losing any off the edge.
      expect(session.active?.stats(frame).opaque).toBe(before as number);
    }
  });

  test("animate_procedural rejects an unknown preset naming the valid ones", async () => {
    const message = await callExpectingError("animate_procedural", { preset: "wiggle" });
    expect(message).toContain("'bob'");
    expect(message).toContain("'scroll'");
  });

  test("interpolate_frames inserts between two keys, as one undo step", async () => {
    await call("fill_region", { x: 0, y: 0, width: 4, height: 4, index: 1 });
    await call("add_frame", { copy_from: 0 });
    await call("fill_region", { x: 16, y: 16, width: 4, height: 4, index: 1 });
    await call("select_frame", { frame_index: 1 });
    await call("fill_region", { x: 0, y: 0, width: 4, height: 4, index: -1 });

    await call("interpolate_frames", { from_index: 0, to_index: 1, steps: 2 });
    expect(session.active?.frameCount).toBe(4);
    expect(session.active?.history().at(-1)).toBe("interpolate_frames (2)");
    expect(session.active?.snapshot().frames.map((frame) => frame.durationMs)).toEqual([250, 250, 250, 250]);

    session.active?.undo();
    expect(session.active?.frameCount).toBe(2);
  });
});

describe("coherence", () => {
  test("reports character boundary contacts instead of claiming polished motion", async () => {
    await call("fill_region", { x: 12, y: 0, width: 8, height: 16, index: 6 });
    await call("add_frame", { copy_from: 0 });
    const result = await call("check_animation_coherence");
    expect(result).toContain("[bounds]");
    expect(result).toContain("frame 0");
    expect(result).toContain("edge contact alone cannot prove clipping");
    expect(result).not.toContain("is coherent");
  });

  test("a disabled loop check does not claim to have checked the loop", async () => {
    await call("fill_region", { x: 12, y: 8, width: 8, height: 16, index: 6 });
    const result = await call("check_animation_coherence", { loop: false });
    expect(result).not.toContain("duplicate loop endpoint");
    expect(result).toContain("does not verify anatomy, foot contact, registration or smooth motion");
  });

  test("passes a clean cycle", async () => {
    await call("fill_region", { x: 8, y: 8, width: 16, height: 16, index: 6 });
    await call("animate_procedural", { preset: "bob", frames: 4 });
    expect(await call("check_animation_coherence")).toContain("passed automatic checks");
  });

  /** Reports frame indices, never a bare verdict — the fix-and-recheck loop. */
  test("names the frame when a loop holds a pose twice", async () => {
    await call("fill_region", { x: 8, y: 8, width: 8, height: 8, index: 6 });
    await call("add_frame", { copy_from: 0 });
    await call("add_frame", { copy_from: 0 });

    const result = await call("check_animation_coherence", { loop: true });
    expect(result).toMatch(/frame \d+/);
    expect(result).toContain("check_animation_coherence again");
  });

  test("flags a silhouette pop between neighbouring frames", async () => {
    await call("fill_region", { x: 0, y: 0, width: 32, height: 32, index: 1 });
    await call("add_frame");
    await call("set_pixels", { pixels: [{ x: 0, y: 0, index: 1 }] });

    const result = await call("check_animation_coherence");
    expect(result).toContain("silhouette");
  });
});
