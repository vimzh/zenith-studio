import { silhouette } from "@zenith/core";
import { readArray, readInteger } from "../args";
import { ToolError, type ToolDefinition } from "../types";
import { requireActiveAsset, toToolError } from "./active";

/**
 * Frame structure.
 *
 * An asset is one or more frames sharing dimensions and palette. Nothing here
 * interprets them as motion — that is what the perception tools in
 * `animation.ts` are for. These just make frames exist, and make the frame every
 * other editing tool targets selectable.
 */

const FRAME_INDEX = {
  type: "integer",
  minimum: 0,
  description: "Frame index, 0-based. Call list_frames if you do not know it.",
} as const;

function frameIndex(args: Parameters<ToolDefinition["execute"]>[0], key: string, count: number): number {
  return readInteger(args, key, 0, count - 1);
}

export const listFrames: ToolDefinition = {
  name: "list_frames",
  description:
    "List open-asset frame indices, durations (ms), opaque counts and selected frame. Start here before other frame tools; dimensions and palette are shared.",
  readOnly: true,
  inputSchema: { type: "object", properties: {} },
  example: {},
  execute: () => {
    const { name, store } = requireActiveAsset();
    const document = store.snapshot();

    const lines = document.frames.map((frame, index) => {
      const opaque = store.stats(index).opaque;
      const selected = index === store.activeFrame ? "  [selected]" : "";
      return `  ${String(index)}  ${String(frame.durationMs)}ms  ${String(opaque)} opaque px${selected}`;
    });

    const total = document.frames.reduce((sum, frame) => sum + frame.durationMs, 0);
    return (
      `'${name}' has ${String(document.frames.length)} frame(s), ${String(total)}ms total:\n${lines.join("\n")}`
    );
  },
};

export const addFrame: ToolDefinition = {
  name: "add_frame",
  description:
    "Add and select an open-asset frame; returns its index. Blank unless copy_from copies pixels and duration. Omit at to append.",
  inputSchema: {
    type: "object",
    properties: {
      copy_from: { ...FRAME_INDEX, description: "Duplicate this frame's pixels and duration. Omit for a blank frame." },
      at: {
        type: "integer",
        minimum: 0,
        description: "Insert position. Omit to append to the end.",
      },
    },
  },
  example: { copy_from: 0 },
  execute: (args) => {
    const { store } = requireActiveAsset();
    const options: { copyFrom?: number; at?: number } = {};
    if (args["copy_from"] !== undefined) options.copyFrom = frameIndex(args, "copy_from", store.frameCount);
    if (args["at"] !== undefined) options.at = readInteger(args, "at", 0, store.frameCount);

    let index: number;
    try {
      index = store.addFrame(options);
    } catch (error) {
      throw toToolError(error);
    }
    const source = options.copyFrom === undefined ? "blank" : `a copy of frame ${String(options.copyFrom)}`;
    return `Added ${source} at index ${String(index)} and selected it. The asset now has ${String(store.frameCount)} frame(s).`;
  },
};

export const selectFrame: ToolDefinition = {
  name: "select_frame",
  description:
    "Select the open-asset frame targeted by editing tools and displayed on the human's timeline. Use list_frames for indices.",
  inputSchema: {
    type: "object",
    properties: { frame_index: FRAME_INDEX },
    required: ["frame_index"],
  },
  example: { frame_index: 0 },
  execute: (args) => {
    const { name, store } = requireActiveAsset();
    const index = frameIndex(args, "frame_index", store.frameCount);
    try {
      store.selectFrame(index);
    } catch (error) {
      throw toToolError(error);
    }
    return `Selected frame ${String(index)} of ${String(store.frameCount)} in '${name}'. Editing tools now write here.`;
  },
};

export const deleteFrame: ToolDefinition = {
  name: "delete_frame",
  description:
    "Delete one open-asset frame, undoable in one step. Refuses to delete the only remaining frame.",
  inputSchema: {
    type: "object",
    properties: { frame_index: FRAME_INDEX },
    required: ["frame_index"],
  },
  example: { frame_index: 1 },
  execute: (args) => {
    const { store } = requireActiveAsset();
    const index = frameIndex(args, "frame_index", store.frameCount);
    try {
      store.deleteFrame(index);
    } catch (error) {
      throw toToolError(error);
    }
    return `Deleted frame ${String(index)}. ${String(store.frameCount)} frame(s) remain; frame ${String(store.activeFrame)} is selected.`;
  },
};

export const reorderFrames: ToolDefinition = {
  name: "reorder_frames",
  description:
    "Reorder open-asset frames. Pass every current index exactly once, e.g. [2,0,1]; invalid permutations are rejected.",
  inputSchema: {
    type: "object",
    properties: {
      order: {
        type: "array",
        items: { type: "integer", minimum: 0 },
        description: "Every current frame index, exactly once, in the new order.",
      },
    },
    required: ["order"],
  },
  example: { order: [1, 0] },
  execute: (args) => {
    const { store } = requireActiveAsset();
    const raw = readArray(args, "order");
    const order = raw.map((value, position) => {
      if (typeof value !== "number" || !Number.isInteger(value)) {
        throw new ToolError(`order[${String(position)}] must be an integer frame index, received ${JSON.stringify(value)}.`);
      }
      return value;
    });

    try {
      store.reorderFrames(order);
    } catch (error) {
      throw toToolError(error);
    }
    return `Reordered ${String(store.frameCount)} frame(s) to [${order.join(", ")}]. Frame ${String(store.activeFrame)} is still selected.`;
  },
};

export const setFrameDuration: ToolDefinition = {
  name: "set_frame_duration",
  description:
    "Set an open-asset frame's hold in milliseconds. Affects playback and GIF timing; use list_frames for indices.",
  inputSchema: {
    type: "object",
    properties: {
      frame_index: FRAME_INDEX,
      ms: { type: "integer", minimum: 1, description: "Hold time in milliseconds." },
    },
    required: ["frame_index", "ms"],
  },
  example: { frame_index: 0, ms: 120 },
  execute: (args) => {
    const { store } = requireActiveAsset();
    const index = frameIndex(args, "frame_index", store.frameCount);
    const ms = readInteger(args, "ms", 1);
    try {
      store.setFrameDuration(index, ms);
    } catch (error) {
      throw toToolError(error);
    }
    return `Frame ${String(index)} now holds for ${String(ms)}ms.`;
  },
};

export const readFrame: ToolDefinition = {
  name: "read_frame",
  description:
    "Read an open frame: compact hex (0–F) or @hex then spaced tokens (00–fe); '.' transparent. (0,0) top-left, +x right, +y down. Costly; prefer read_frames_diff/read_animation_summary.",
  readOnly: true,
  inputSchema: {
    type: "object",
    properties: { frame_index: FRAME_INDEX },
    required: ["frame_index"],
  },
  example: { frame_index: 0 },
  execute: (args) => {
    const { name, store } = requireActiveAsset();
    const index = frameIndex(args, "frame_index", store.frameCount);
    return (
      `asset: ${name}   frame: ${String(index)}/${String(store.frameCount - 1)}\n` +
      `size: ${String(store.width)}x${String(store.height)}   origin: top-left, x right, y down\n` +
      `grid:\n${store.encode(index)}`
    );
  },
};

export const getSilhouette: ToolDefinition = {
  name: "get_silhouette",
  description:
    "Read an open-asset opacity grid: '1' opaque, '0' transparent; (0,0) top-left, +x right, +y down. Defaults to the selected frame; useful for pose/readability checks.",
  readOnly: true,
  inputSchema: {
    type: "object",
    properties: { frame_index: FRAME_INDEX },
  },
  example: {},
  execute: (args) => {
    const { name, store } = requireActiveAsset();
    const index =
      args["frame_index"] === undefined
        ? store.activeFrame
        : frameIndex(args, "frame_index", store.frameCount);
    const mask = silhouette(store.readComposite(index));
    const opaque = store.stats(index).opaque;
    return (
      `Silhouette of '${name}' frame ${String(index)} — ${String(opaque)} of ${String(store.width * store.height)} pixels opaque:\n${mask}`
    );
  },
};
