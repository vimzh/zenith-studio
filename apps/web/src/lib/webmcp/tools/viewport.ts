import { readInteger } from "../args";
import { ToolError, type ToolDefinition } from "../types";
import { viewportChannel, visibleRegion } from "../viewport";
import { requireActiveAsset } from "./active";

/**
 * Viewport tools — the agent directing the human's attention.
 *
 * Small, and disproportionately effective for making collaboration legible.
 * When the agent says "I fixed the pixels at (12, 20)", the canvas can go there
 * instead of leaving the human to hunt for it.
 */

const NOT_WIRED =
  "The editor is not reporting its viewport. This tool only works while an asset is open in the editor.";

export const getViewport: ToolDefinition = {
  name: "get_viewport",
  description:
    "Report what the human is currently looking at: the region of the open asset visible on their screen, in asset-local pixel coordinates, and the integer zoom level. Origin (0,0) is the top-left pixel, x increases right, y increases down. Use it before focus_viewport to see whether the area you care about is already on screen.",
  readOnly: true,
  inputSchema: { type: "object", properties: {} },
  example: {},
  execute: () => {
    const { name, store } = requireActiveAsset();
    const snapshot = viewportChannel.peekSnapshot();
    if (snapshot === null) throw new ToolError(NOT_WIRED);

    const region = visibleRegion(snapshot, store.width, store.height);
    const whole = region.width >= store.width && region.height >= store.height;
    return (
      `Viewing '${name}' at ${String(snapshot.zoom)}x zoom. ` +
      `Visible region: x ${String(region.x)}-${String(region.x + region.width - 1)}, ` +
      `y ${String(region.y)}-${String(region.y + region.height - 1)} ` +
      `(${String(region.width)}x${String(region.height)} of ${String(store.width)}x${String(store.height)})` +
      `${whole ? " — the whole asset is on screen." : "."}`
    );
  },
};

export const focusViewport: ToolDefinition = {
  name: "focus_viewport",
  description:
    "Pan and zoom the human's canvas to bring a region of the open asset into view, centred, at the largest integer zoom that fits it. Coordinates are asset-local pixels: (0,0) is the top-left pixel, x increases right, y increases down. Use it to show the human where you have been working — after fixing a seam, or before describing a change — so they are looking at the same pixels you are. Omit the region to frame the whole asset.",
  inputSchema: {
    type: "object",
    properties: {
      x: { type: "integer", minimum: 0, description: "Left edge of the region, 0-indexed from the left." },
      y: { type: "integer", minimum: 0, description: "Top edge of the region, 0-indexed from the top." },
      width: { type: "integer", minimum: 1, description: "Region width in pixels." },
      height: { type: "integer", minimum: 1, description: "Region height in pixels." },
    },
  },
  example: { x: 0, y: 0, width: 16, height: 16 },
  execute: (args) => {
    const { name, store } = requireActiveAsset();
    if (!viewportChannel.connected) throw new ToolError(NOT_WIRED);

    const wholeAsset = args["x"] === undefined && args["y"] === undefined;
    const region = wholeAsset
      ? { x: 0, y: 0, width: store.width, height: store.height }
      : {
          x: readInteger(args, "x", 0, store.width - 1),
          y: readInteger(args, "y", 0, store.height - 1),
          width: readInteger(args, "width", 1, store.width),
          height: readInteger(args, "height", 1, store.height),
        };

    if (region.x + region.width > store.width || region.y + region.height > store.height) {
      throw new ToolError(
        `The region (${String(region.x)}, ${String(region.y)}) ${String(region.width)}x${String(region.height)} extends past the ${String(store.width)}x${String(store.height)} asset. Reduce it, or omit the region to frame the whole asset.`,
      );
    }

    viewportChannel.request(region);
    return wholeAsset
      ? `Framed the whole of '${name}' (${String(store.width)}x${String(store.height)}) in the human's view.`
      : `Moved the human's view to (${String(region.x)}, ${String(region.y)}) ${String(region.width)}x${String(region.height)} of '${name}'.`;
  },
};
