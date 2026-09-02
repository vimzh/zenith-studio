import type { ToolDefinition } from "../types";
import { requireActiveAsset } from "./active";

/**
 * History.
 *
 * There is one undo stack, shared with the human. An agent can undo a human's
 * stroke and a human can press Ctrl+Z to undo an agent's edit — which is the
 * detail that makes people willing to let an agent touch their work at all.
 */

export const undo: ToolDefinition = {
  name: "undo",
  description:
    "Undo the most recent edit to the currently open asset. This is the same undo stack the human uses, so it may undo their work as well as yours — read_canvas afterwards if you need to be sure what changed. Returns the name of the operation undone.",
  inputSchema: { type: "object", properties: {} },
  example: {},
  execute: () => {
    const { store } = requireActiveAsset();
    const label = store.undo();
    if (label === null) return "Nothing to undo — the history is empty.";
    return `Undid '${label}'. ${String(store.canUndo ? "More history remains." : "That was the oldest entry.")}`;
  },
};

export const redo: ToolDefinition = {
  name: "redo",
  description:
    "Redo the most recently undone edit to the currently open asset. Any new edit clears the redo stack, so this only works immediately after an undo. Returns the name of the operation redone.",
  inputSchema: { type: "object", properties: {} },
  example: {},
  execute: () => {
    const { store } = requireActiveAsset();
    const label = store.redo();
    if (label === null) return "Nothing to redo. A new edit clears the redo stack.";
    return `Redid '${label}'.`;
  },
};
