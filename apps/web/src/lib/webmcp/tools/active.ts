import type { DocumentStore } from "@zenith/core";
import { session } from "@/lib/editor";
import { ToolError } from "../types";

/**
 * Resolving implicit page state.
 *
 * Tools act on whatever asset the human currently has open rather than taking an
 * id on every call. That is the whole reason this tool surface lives in the page
 * and not on a remote MCP server: the agent and the human share a subject, so
 * "fill the top-left corner" needs no preamble about which file is meant.
 */

export interface ActiveAsset {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly store: DocumentStore;
}

export interface EditTarget {
  readonly id: string;
  readonly store: DocumentStore;
  readonly revision: number;
  readonly frame: number;
  readonly layer: number;
}

/** Freeze the destination before a model call so its result cannot overwrite newer work. */
export function captureEditTarget({ id, store }: Pick<ActiveAsset, "id" | "store">): EditTarget {
  return { id, store, revision: store.revision, frame: store.activeFrame, layer: store.activeLayer };
}

export function assertEditTarget(target: EditTarget): void {
  const { id, store, revision, frame, layer } = target;
  if (session.activeId !== id || session.get(id) !== store || store.revision !== revision ||
    store.activeFrame !== frame || store.activeLayer !== layer) {
    throw new ToolError("The asset, frame, layer or artwork changed while generating. The result was not applied; your newer work is unchanged.");
  }
}

export function requireActiveAsset(): ActiveAsset {
  const store = session.active;
  const id = session.activeId;
  if (store === null || id === null) {
    throw new ToolError(
      "No asset is open. Call list_assets to see what exists, open_asset to open one of them, or create_asset to start a new one.",
    );
  }
  const summary = session.list().find((asset) => asset.id === id);
  return { id, name: summary?.name ?? store.name, type: summary?.type ?? "tile", store };
}

/** Turns a `PixelError` from the store into an agent-readable failure. */
export function toToolError(error: unknown): ToolError {
  if (error instanceof ToolError) return error;
  if (error instanceof Error) return new ToolError(error.message);
  return new ToolError(String(error));
}

/** Runs a store mutation as one undo entry labelled with the tool that caused it. */
export function asOneEdit<T>(store: DocumentStore, label: string, run: () => T): T {
  try {
    return store.transaction(label, run);
  } catch (error) {
    throw toToolError(error);
  }
}
