import { applySkeletonTemplate, bakeSkeletonPose } from "@/lib/editor";
import {
  TEMPLATE_NAMES,
  estimateSkeleton,
  jointsFor,
  type CharacterType,
  type Joint,
  type JointPosition,
  type Pose,
} from "@/lib/skeleton";
import { readArray, readEnum, readOptionalInteger, readRecordAt, readString } from "../args";
import { ToolError, type ToolArgs, type ToolDefinition } from "../types";
import { requireActiveAsset } from "./active";

const CHARACTER_TYPES: readonly CharacterType[] = ["bipedal", "bipedal-chibi", "quadrupedal"];

/** Joint overrides as `[{joint, x, y}]`, validated against the character type. */
function readJoints(args: ToolArgs, type: CharacterType): Partial<Record<Joint, JointPosition>> {
  if (args.joints === undefined) return {};
  const valid = jointsFor(type);
  const items = readArray(args, "joints");
  const joints: Partial<Record<Joint, JointPosition>> = {};
  items.forEach((_, index) => {
    const record = readRecordAt(items, index, "joints");
    const name = readString(record, "joint");
    if (!valid.includes(name as Joint)) {
      throw new ToolError(`'${name}' is not a ${type} joint. Valid joints: ${valid.join(", ")}.`);
    }
    const { x, y } = record;
    if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) {
      throw new ToolError(`Joint '${name}' needs finite numeric x and y, normalised 0-1 across the content bounds.`);
    }
    joints[name as Joint] = { x, y };
  });
  return joints;
}

/**
 * The agent's posing path, through the same local bone rig the editor uses.
 *
 * One tool rather than two: the catalog has a byte budget, and a stock cycle
 * and a custom pose share everything but the last step. Joints without a
 * template are the pose; joints with a template correct the estimated rig
 * before the cycle is built. With `estimate_skeleton` to read the joints,
 * this is "an agent can pose a skeleton entirely through tools".
 */
export const animateWithSkeletonTool: ToolDefinition = {
  name: "animate_with_skeleton",
  scope: "character",
  description:
    "Pose the open character locally, free. Read estimate_skeleton first; joints override the estimated rig in content-bounds coordinates 0–1, top-left, +x right, +y down; '-l' is screen-left. A template appends an undoable cycle; facing defaults east. Without a template, insert one pose after the selected frame. No new colours. Blocking quality: inspect overlaps.",
  inputSchema: {
    type: "object",
    properties: {
      template: { type: "string", enum: [...TEMPLATE_NAMES] },
      frames: { type: "integer", minimum: 2, maximum: 32 },
      facing: { type: "string", enum: ["east", "west"] },
      joints: {
        type: "array",
        items: {
          type: "object",
          properties: { joint: { type: "string" }, x: { type: "number" }, y: { type: "number" } },
          required: ["joint", "x", "y"],
        },
      },
      character_type: { type: "string", enum: [...CHARACTER_TYPES] },
    },
  },
  example: { template: "walk", frames: 6 },
  execute: (args) => {
    const { store } = requireActiveAsset();
    const type = readEnum<CharacterType>(args, "character_type", CHARACTER_TYPES, "bipedal");
    const template = args.template === undefined ? undefined : readEnum(args, "template", TEMPLATE_NAMES);
    const frames = readOptionalInteger(args, "frames", 2, 32) ?? 4;
    const facing = readEnum<"east" | "west">(args, "facing", ["east", "west"], "east");
    const overrides = readJoints(args, type);

    const source = store.readComposite(store.activeFrame);
    const estimated = estimateSkeleton(source, type);
    if (estimated === null) {
      throw new ToolError(`Frame ${String(store.activeFrame + 1)} is empty, so there is no silhouette to rig.`);
    }
    const corrected: Pose = { type, joints: { ...estimated.joints, ...overrides } };
    const moved = Object.keys(overrides);

    if (template !== undefined) {
      const summary = applySkeletonTemplate(store, template, frames, { base: corrected, facing });
      return moved.length === 0 ? summary : `${summary} Rig corrected at ${moved.join(", ")} first.`;
    }
    if (moved.length === 0) {
      throw new ToolError("Pass a template to build a cycle, or joints to create one posed frame.");
    }
    const summary = bakeSkeletonPose(store, source, estimated, corrected);
    return `${summary} Moved ${moved.join(", ")}. Read the new frame with read_frame to check the silhouette.`;
  },
};
