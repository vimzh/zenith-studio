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
    "List the frames of the currently open asset: index, hold duration in milliseconds, how many pixels are opaque, and which frame is selected for editing. Every frame shares the asset's dimensions and palette. Start here before any other frame tool.",
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
    "Add a frame to the currently open asset and select it. Without copy_from the frame is fully transparent; with it, the frame is a pixel-for-pixel copy you can then modify — which is usually what you want for an animation, since a cycle is small changes to a repeated pose. Returns the new frame's index.",
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
    "Select which frame of the currently open asset every editing tool writes to. write_region, set_pixels, fill_region, bucket_fill and replace_color all target the selected frame unless told otherwise. The human sees the selection change on their timeline.",
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
    "Delete a frame from the currently open asset. Refused when it is the only frame, since an asset always has a canvas. Undoable in one step, like every other edit.",
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
    "Reorder the frames of the currently open asset. Provide every existing index exactly once, in the order you want them: [2, 0, 1] moves the last frame to the front. A list that is not a permutation is rejected rather than silently dropping or duplicating artwork.",
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
    "Set how long a frame is held, in milliseconds. Typical pixel-art cycles run 80-150ms per frame; a held pose at the end of a cycle is often longer. Affects playback and exported GIF timing.",
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
    "Read one frame of the currently open asset as an indexed character grid, in the same format read_canvas returns: '0'-'9' and 'A'-'F' for palette indices, '.' for transparent, origin (0,0) at the top-left. A full frame read is expensive — a 64x64 frame is roughly 1300 tokens — so prefer read_frames_diff when you already know a nearby frame, and read_animation_summary when you only need to understand the motion.",
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
    "Read a frame's opacity mask as a 1-bit grid: '1' where a pixel is opaque, '0' where transparent. Origin (0,0) is the top-left. Strips colour entirely, which makes it the cheap way to judge pose, readability and whether a shape holds together — the questions colour noise obscures. Defaults to the selected frame.",
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
