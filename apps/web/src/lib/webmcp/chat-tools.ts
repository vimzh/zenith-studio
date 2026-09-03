/**
 * Which tools the chat model is offered.
 *
 * Deliberately a curated allowlist rather than the view-scoped registry. The
 * registry is past thirty, and a chat loop calls tools several times per user
 * message — every extra choice costs selection accuracy on every one of those
 * calls, which is the failure `AGENTS.md` warns about.
 *
 * The criterion for inclusion is: **would a human ask for this in a sentence?**
 *
 * In: perceiving the canvas, editing pixels, checking work, undoing, moving
 * between frames, directing the human's attention.
 *
 * Out, and why:
 *  - `create_asset` / `open_asset` — the human picks what they are working on.
 *    An agent switching assets mid-conversation is disorienting, and the chat
 *    already runs inside one open asset.
 *  - `export_png`, `export_*` — these trigger a download. A model deciding to
 *    put a file on someone's disk mid-sentence is the wrong default.
 *  - `generate_asset` — creates a *second* asset. When someone asks for a bush
 *    on the canvas they are looking at, they mean this canvas;
 *    `draw_from_prompt` is the same pipeline pointed at the open one, and is
 *    allowed below for that reason.
 *  - `delete_frame`, `reorder_frames`, `pixelize` — destructive or lossy in ways
 *    that are hard to describe in a sentence and easy to get wrong.
 *
 * Nothing here is a permanent judgement; it is where the line sits while the
 * loop is new. Anything excluded is still one click away in the tool runner.
 */

import { findTool, toolsForContext } from "./tools";
import type { ScopeContext } from "./scope";
import type { ToolDefinition } from "./types";

export const CHAT_TOOL_NAMES: readonly string[] = [
  // Explicit metadata correction, without regenerating an existing subject.
  "set_asset_type",
  // Perception — the agent must see before it edits.
  "read_canvas",
  "get_palette",
  "read_frame",
  "get_silhouette",
  "read_frames_diff",
  "read_animation_summary",
  // Editing.
  "write_region",
  "set_pixels",
  "fill_region",
  "bucket_fill",
  "replace_color",
  // Frames.
  "list_frames",
  "add_frame",
  "select_frame",
  "set_frame_duration",
  "animate_procedural",
  "animate_with_skeleton",
  // Directions. "Give me all eight angles" is one sentence and was reachable
  // only through the tool runner, which is not where anyone asks for it. They
  // are character-scoped, so they appear for a character and nowhere else, and
  // the free mirror sits beside the paid generators so the model can prefer it.
  "get_directions",
  "select_direction",
  "derive_direction_by_mirror",
  "rotate_character",
  "generate_direction_set",
  // Checking its own work — the loop that makes the agent trustworthy.
  "check_seamless_tiling",
  "check_animation_coherence",
  // Undoing, and pointing the human at what changed.
  "undo",
  "focus_viewport",
  // Deterministic authoring. Each of these is something a human asks for in a
  // sentence — "make me a tileset from this", "swap it to Game Boy green",
  // "where are its joints?" — and none costs money, calls a model, or writes a
  // file, so the reasons the generative and export tools are excluded do not
  // apply. `import_image` and `build_character_from_reference` stay out: one
  // needs a base64 blob inside the message, the other creates four assets.
  "generate_tileset",
  // Generation is the product's core chat workflow. The system prompt forbids
  // calling these tools unless the human explicitly asks for art.
  //
  // `draw_from_prompt` is here because the alternative was worse in a way that
  // was measured in the product: with no way to generate into the open canvas,
  // the model hand-drew a 32x32 bush with set_pixels across eight turns, hit the
  // turn limit, and left a green blob behind.
  "draw_from_prompt",
  "derive_variant",
  "inpaint_region",
  "generate_variation_set",
  "set_palette",
  "estimate_skeleton",
];

/** The chat allowlist, narrowed to what the current view can actually act on. */
export function chatTools(context: ScopeContext): readonly ToolDefinition[] {
  const inScope = new Set(toolsForContext(context).map((tool) => tool.name));
  return CHAT_TOOL_NAMES.filter((name) => inScope.has(name))
    .map((name) => findTool(name))
    .filter((tool): tool is ToolDefinition => tool !== undefined);
}

/** OpenAI's function-tool shape. The input schema is already JSON Schema. */
export interface OpenAiTool {
  readonly type: "function";
  readonly function: {
    readonly name: string;
    readonly description: string;
    readonly parameters: unknown;
  };
}

export function toOpenAiTools(tools: readonly ToolDefinition[]): OpenAiTool[] {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  }));
}
