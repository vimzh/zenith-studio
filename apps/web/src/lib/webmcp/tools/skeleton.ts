import { applySkeletonTemplate } from "@/lib/editor";
import { TEMPLATE_NAMES } from "@/lib/skeleton";
import { readEnum, readOptionalInteger } from "../args";
import type { ToolDefinition } from "../types";
import { requireActiveAsset } from "./active";

/** Deterministic skeleton animation: the same local rig path used by the UI. */
export const animateWithSkeletonTool: ToolDefinition = {
  name: "animate_with_skeleton",
  scope: "character",
  description:
    "Build an editable animation from a stock skeleton pose sequence. Deterministic, instant and local: no text prompt, image model, network request or new colours. The flat-sprite rig deforms the selected frame into the requested poses and appends them as one undoable cycle. Best for blocking motion; finish small silhouette and overlap corrections with normal pixel tools.",
  inputSchema: {
    type: "object",
    properties: {
      template: { type: "string", enum: [...TEMPLATE_NAMES] },
      frames: { type: "integer", minimum: 2, maximum: 32 },
    },
    required: ["template"],
  },
  example: { template: "walk", frames: 6 },
  execute: (args) => {
    const { store } = requireActiveAsset();
    const template = readEnum(args, "template", TEMPLATE_NAMES);
    const frames = readOptionalInteger(args, "frames", 2, 32) ?? 4;
    return applySkeletonTemplate(store, template, frames);
  },
};
