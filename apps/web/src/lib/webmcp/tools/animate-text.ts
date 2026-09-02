import { encodeIndexedPng } from "@/lib/export";
import { session } from "@/lib/editor";
import { conformToPalette } from "./generation";
import { frameToCanvas, pixelizeAsync } from "@/lib/pixelize";
import { readInteger, readString } from "../args";
import { describePoses, deriveImage } from "../api";
import { decodeBase64Png } from "../raster";
import { ToolError, type ToolDefinition } from "../types";
import { requireActiveAsset, toToolError } from "./active";

/**
 * Drawn animation — the cycles `animate_procedural` cannot express.
 *
 * The procedural presets transform one frame: bob, sway, pulse, flicker, blink,
 * scroll. Every one of them moves or recolours the *same* drawing, which covers
 * an idle bob and covers nothing else. A run cycle, a weapon draw, a sword
 * slice and a stomp all need frames that were never drawn, and no rearrangement
 * of a single sprite produces them.
 *
 * So this draws them, one model call per frame, each conditioned on the base
 * sprite so the character stays the same character.
 *
 * Two decisions carry the quality:
 *
 * 1. **The poses are planned first**, in a single cheap text call. Handing the
 *    image model a phase fraction — "40% through the motion" — produces frames
 *    that differ arbitrarily instead of describing one motion, because nothing
 *    tells it what 40% of a weapon draw looks like. Naming each pose is what
 *    makes the sequence read as a cycle rather than as N variations.
 *
 * 2. **`mode: "pose"`**, which swaps the derive prompt's camera clause. The
 *    default clause preserves the subject's pose and angle, which is exactly the
 *    thing a frame must change — the same contradiction that silently defeated
 *    rotation, where every requested direction came back as the source view.
 */

const MAX_FRAMES = 12;

export const animateWithText: ToolDefinition = {
  name: "animate_with_text",
  scope: "editor",
  network: true,
  description:
    "Draw an animation cycle from a description — a run cycle, a weapon draw, a sword slice, a stomp, anything the motion can be described in words. Each frame is generated from the open asset so the subject stays recognisably itself, and the frames are appended to it. WHAT TO EXPECT: measured on a 4-frame run cycle, the output reads as four distinct action stances that share the character, not as a polished cycle with smooth weight transfer — treat the frames as a strong starting point to edit rather than a finished animation, and expect to fix contact positions by hand. SLOW AND PAID: one text call to plan the poses plus one image generation per frame, so four frames is roughly four to eight minutes and four images bought. Prefer animate_procedural when the motion is a bob, sway, pulse, flicker, blink or scroll — those are instant, exact and free. Use this only when the cycle needs poses that were never drawn.",
  inputSchema: {
    type: "object",
    properties: {
      description: {
        type: "string",
        description: "The motion, e.g. 'a run cycle', 'drawing a sword from its back scabbard', 'an overhead slice'.",
      },
      frames: {
        type: "integer",
        minimum: 2,
        maximum: MAX_FRAMES,
        description: `Frames to draw. Defaults to 4. Each one is a paid generation, so ask for the fewest that read as the motion.`,
      },
    },
    required: ["description"],
  },
  example: { description: "a run cycle", frames: 4 },
  execute: async (args) => {
    const { id, name } = requireActiveAsset();
    const store = session.get(id);
    if (store === undefined) throw new ToolError(`No asset '${id}' is open.`);

    const description = readString(args, "description");
    const frames = args["frames"] === undefined ? 4 : readInteger(args, "frames", 2, MAX_FRAMES);

    // The base frame is the reference every frame is drawn from, so the cycle
    // stays one subject rather than drifting a little with each generation.
    const base = store.readComposite();
    const palette = store.palette.colors.map((colour) => colour.hex);
    const source = encodeIndexedPng(base, palette, { scale: 16 });

    const poses = await describePoses(name, description, frames);

    const drawn: { pose: string; grid: Awaited<ReturnType<typeof pixelizeAsync>>["grid"] }[] = [];
    const failures: string[] = [];

    for (const [index, pose] of poses.entries()) {
      try {
        const generated = await deriveImage(
          source,
          `Frame ${String(index + 1)} of ${String(frames)} of "${description}". The pose: ${pose}`,
          "sprite",
          "pose",
        );
        const raster = await decodeBase64Png(generated.image);
        const framed = frameToCanvas(raster, store.width, store.height);
        const result = await pixelizeAsync(framed?.image ?? raster, {
          targetWidth: store.width,
          maxColors: palette.length,
        });
        drawn.push({ pose, grid: conformToPalette(result.grid, result.palette, palette) });
      } catch (error) {
        // One bad frame should not throw away the frames already bought.
        failures.push(`frame ${String(index + 1)}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (drawn.length === 0) {
      throw toToolError(new Error(`No frames could be drawn. ${failures.join("; ")}`));
    }

    // One transaction, so the whole cycle is a single undo for the human rather
    // than one entry per frame.
    store.transaction(`animate: ${description}`, () => {
      for (const { grid } of drawn) {
        const index = store.addFrame();
        store.selectFrame(index);
        store.writeRegion(0, 0, grid);
      }
    });

    const note = failures.length === 0 ? "" : ` ${String(failures.length)} frame(s) failed: ${failures.join("; ")}`;
    return (
      `Drew ${String(drawn.length)} frames of '${description}' onto '${name}', appended after the existing ones. ` +
      `Poses: ${drawn.map((entry, index) => `${String(index + 1)}. ${entry.pose}`).join(" ")}` +
      `${note} Play it back in the timeline, or check_animation_coherence to see whether the frames register.`
    );
  },
};
