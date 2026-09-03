import {
  animateProcedural,
  checkAnimationCoherence,
  interpolateFrames,
  readAnimationSummary,
  readFramesDiff,
  type ProceduralPreset,
} from "@/lib/animation";
import { encodeCell, type Grid } from "@zenith/core";
import { readEnum, readInteger, readOptionalInteger } from "../args";
import { ToolError, type ToolDefinition } from "../types";
import { requireActiveAsset, toToolError } from "./active";

/**
 * Animation perception and authoring.
 *
 * The point of this group is that reading a whole animation is unaffordable. A
 * 64x64 frame is roughly 1300 tokens; four of them is a fifth of a small
 * context window spent before any thinking happens. Diffs and summaries exist so
 * an agent can reason about motion by reading almost none of it — and they are
 * only possible because the format is indexed. You cannot diff two PNGs and get
 * something a model can act on.
 */

/** Past this a diff is no longer cheaper than the frame, and the caller should say so. */
const MAX_LISTED_CHANGES = 400;

function framesOf(store: ReturnType<typeof requireActiveAsset>["store"]): Grid[] {
  return Array.from({ length: store.frameCount }, (_, index) => store.readComposite(index));
}

export const readFramesDiffTool: ToolDefinition = {
  scope: "animation",
  name: "read_frames_diff",
  description:
    "Read only changed pixels between two open-asset frames, with before/after indices and (x,y). Origin (0,0) is top-left; +x right, +y down. Usually smaller than full reads; useful for in-betweens.",
  readOnly: true,
  inputSchema: {
    type: "object",
    properties: {
      from_index: { type: "integer", minimum: 0, description: "Frame to compare from, 0-based." },
      to_index: { type: "integer", minimum: 0, description: "Frame to compare to, 0-based." },
    },
    required: ["from_index", "to_index"],
  },
  example: { from_index: 0, to_index: 1 },
  execute: (args) => {
    const { name, store } = requireActiveAsset();
    const from = readInteger(args, "from_index", 0, store.frameCount - 1);
    const to = readInteger(args, "to_index", 0, store.frameCount - 1);
    if (from === to) {
      throw new ToolError(
        `from_index and to_index are both ${String(from)}. Diffing a frame against itself reports nothing; pass two different frames.`,
      );
    }

    let diff;
    try {
      diff = readFramesDiff(store.readComposite(from), store.readComposite(to));
    } catch (error) {
      throw toToolError(error);
    }

    const header =
      `'${name}' frame ${String(from)} → ${String(to)}: ` +
      `${String(diff.changed)} of ${String(diff.total)} pixels differ (${(diff.ratio * 100).toFixed(1)}%).`;

    if (diff.changed === 0) return `${header} The frames are identical.`;

    const listed = diff.changes.slice(0, MAX_LISTED_CHANGES);
    const lines = listed.map(
      (change) =>
        `  (${String(change.x)}, ${String(change.y)}) ${encodeCell(change.from)}→${encodeCell(change.to)}`,
    );
    const omitted =
      diff.changes.length > listed.length
        ? `\n  … ${String(diff.changes.length - listed.length)} more. At this size read_frame is cheaper than a diff.`
        : "";

    return `${header}\n${lines.join("\n")}${omitted}`;
  },
};

export const readAnimationSummaryTool: ToolDefinition = {
  scope: "animation",
  name: "read_animation_summary",
  description:
    "Summarise each open-asset frame's opaque-pixel count, centre of mass, changed pixels and centroid displacement from the previous frame. Use before full reads to identify motion or silhouette jumps.",
  readOnly: true,
  inputSchema: { type: "object", properties: {} },
  example: {},
  execute: () => {
    const { name, store } = requireActiveAsset();
    const stats = readAnimationSummary(framesOf(store));

    const lines = stats.map((frame) => {
      const centroid =
        frame.centroid === null
          ? "empty"
          : `(${frame.centroid.x.toFixed(1)}, ${frame.centroid.y.toFixed(1)})`;
      const changed = frame.changedFromPrevious === null ? "—" : String(frame.changedFromPrevious);
      const shift = frame.centroidShift === null ? "—" : frame.centroidShift.toFixed(2);
      return `  ${String(frame.index)}  ${String(frame.opaque).padStart(5)} px  centroid ${centroid}  changed ${changed}  shift ${shift}`;
    });

    return `'${name}' — ${String(stats.length)} frame(s):\n${lines.join("\n")}`;
  },
};

export const checkAnimationCoherenceTool: ToolDefinition = {
  scope: "animation",
  name: "check_animation_coherence",
  description:
    "Check open frames for off-palette pixels, opaque-area jumps and identical loop endpoints; flag character edge contacts. Reports frame indices. Not proof of anatomy, grounded contact, registration or smoothness: review playback.",
  readOnly: true,
  inputSchema: {
    type: "object",
    properties: {
      loop: {
        type: "boolean",
        description: "Whether these frames are meant to loop. Defaults to true.",
      },
      max_area_jump: {
        type: "number",
        description:
          "Largest acceptable change in opaque area between neighbouring frames, 0-1. Defaults to 0.4.",
      },
    },
  },
  example: {},
  execute: (args) => {
    const { name, store, type } = requireActiveAsset();
    const loop = args["loop"] === undefined ? true : args["loop"] === true;
    const maxAreaJump = typeof args["max_area_jump"] === "number" ? args["max_area_jump"] : undefined;

    let problems;
    try {
      problems = checkAnimationCoherence(framesOf(store), {
        paletteSize: store.palette.colors.length,
        loop,
        checkBounds: type === "character",
        ...(maxAreaJump === undefined ? {} : { maxAreaJump }),
      });
    } catch (error) {
      throw toToolError(error);
    }

    if (problems.length === 0) {
      return `'${name}' passed automatic checks across ${String(store.frameCount)} frame(s): palette, area changes${loop ? ", duplicate loop endpoint" : ""}${type === "character" ? ", canvas-edge contacts" : ""}. This does not verify anatomy, foot contact, registration or smooth motion; review playback.`;
    }
    const lines = problems.map((problem) => `  frame ${String(problem.frame)}  [${problem.kind}]  ${problem.message}`);
    return `'${name}' has ${String(problems.length)} coherence problem(s):\n${lines.join("\n")}\nFix those frames and call check_animation_coherence again.`;
  },
};

const PRESETS: readonly ProceduralPreset[] = ["bob", "blink", "flicker", "pulse", "scroll", "sway"];

export const animateProceduralTool: ToolDefinition = {
  name: "animate_procedural",
  description:
    "Append a free, deterministic cycle from the selected frame; one undo. bob: vertical; sway: horizontal; pulse: palette brightness; flicker: irregular brightness; blink: dim highlights; scroll: seamless wrap. Prefer over model poses when suitable.",
  inputSchema: {
    type: "object",
    properties: {
      preset: { type: "string", enum: [...PRESETS], description: "Which motion to generate." },
      frames: { type: "integer", minimum: 2, maximum: 32, description: "Frames in the cycle. Defaults to 4." },
      amplitude: {
        type: "integer",
        minimum: 1,
        description: "Pixels of displacement, or ramp distance for the colour presets. Defaults to 1.",
      },
      dx: { type: "integer", description: "Horizontal pixels per frame, for scroll." },
      dy: { type: "integer", description: "Vertical pixels per frame, for scroll." },
    },
    required: ["preset"],
  },
  example: { preset: "bob", frames: 4 },
  execute: (args) => {
    const { name, store } = requireActiveAsset();
    const preset = readEnum<ProceduralPreset>(args, "preset", PRESETS);
    const frames = readOptionalInteger(args, "frames", 2, 32) ?? 4;
    const amplitude = readOptionalInteger(args, "amplitude", 1);
    const dx = readOptionalInteger(args, "dx");
    const dy = readOptionalInteger(args, "dy");

    const base = store.readComposite(store.activeFrame);
    let generated: Grid[];
    try {
      generated = animateProcedural(
        base,
        preset,
        {
          frames,
          ...(amplitude === undefined ? {} : { amplitude }),
          ...(dx === undefined ? {} : { dx }),
          ...(dy === undefined ? {} : { dy }),
        },
        store.palette.colors.length,
      );
    } catch (error) {
      throw toToolError(error);
    }

    const first = generated[0];
    if (first === undefined) throw new ToolError(`The ${preset} preset produced no frames.`);

    const startedAt = store.activeFrame;
    try {
      // One transaction, so a six-frame cycle is one Ctrl+Z for the human
      // rather than six. Structural and pixel changes may share an entry.
      store.transaction(`animate_procedural (${preset})`, () => {
        store.writeRegion(0, 0, first, { frame: startedAt });
        for (let index = 1; index < generated.length; index += 1) {
          const at = store.addFrame();
          store.writeRegion(0, 0, generated[index] as Grid, { frame: at });
        }
      });
    } catch (error) {
      throw toToolError(error);
    }

    return (
      `Built a ${String(generated.length)}-frame ${preset} cycle on '${name}', starting from frame ${String(startedAt)}. ` +
      `The asset now has ${String(store.frameCount)} frame(s). Call read_animation_summary to check the motion, or check_animation_coherence to validate the loop.`
    );
  },
};

export const interpolateFramesTool: ToolDefinition = {
  scope: "animation",
  name: "interpolate_frames",
  description:
    "Insert in-betweens after from_index between two open-asset keyframes. Moves pixel positions without blending colours or inventing palette entries; use to smooth a blocked-out cycle.",
  inputSchema: {
    type: "object",
    properties: {
      from_index: { type: "integer", minimum: 0, description: "Frame to start from, 0-based." },
      to_index: { type: "integer", minimum: 0, description: "Frame to end at, 0-based." },
      steps: { type: "integer", minimum: 1, maximum: 16, description: "How many frames to insert between them." },
    },
    required: ["from_index", "to_index", "steps"],
  },
  example: { from_index: 0, to_index: 1, steps: 2 },
  execute: (args) => {
    const { name, store } = requireActiveAsset();
    const from = readInteger(args, "from_index", 0, store.frameCount - 1);
    const to = readInteger(args, "to_index", 0, store.frameCount - 1);
    const steps = readInteger(args, "steps", 1, 16);
    if (from === to) {
      throw new ToolError(`from_index and to_index are both ${String(from)}. Interpolation needs two different frames.`);
    }

    let between: Grid[];
    try {
      between = interpolateFrames(store.readComposite(from), store.readComposite(to), steps);
    } catch (error) {
      throw toToolError(error);
    }

    try {
      store.transaction(`interpolate_frames (${String(steps)})`, () => {
        between.forEach((grid, offset) => {
          const at = store.addFrame({ at: from + 1 + offset });
          store.writeRegion(0, 0, grid, { frame: at });
        });
      });
    } catch (error) {
      throw toToolError(error);
    }

    return (
      `Inserted ${String(between.length)} in-between frame(s) after frame ${String(from)} of '${name}'. ` +
      `The asset now has ${String(store.frameCount)} frame(s).`
    );
  },
};
