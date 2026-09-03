import type { LucideIcon } from "lucide-react";
import { Eraser, Hand, PaintBucket, Pencil, Pipette, SquareDashed } from "lucide-react";
import { TRANSPARENT, type Cell } from "@zenith/core";

/**
 * The editor's tools.
 *
 * Five began as the irreducible set for drawing. `select` joins them because a
 * selection is not only an editing convenience here — it is how a human tells
 * the agent *which part of the canvas they are talking about*, which is the
 * cheapest and most precise context a chat message can carry.
 *
 * Line, rectangle, ellipse, dithering and symmetry remain deferred to phase 13.
 * A deferred tool is absent, not a disabled button.
 */

export type ToolId = "pencil" | "eraser" | "bucket" | "eyedropper" | "select" | "pan";

/** Palette swaps keep the workspace mounted; its old brush index may no longer exist. */
export function clampPaletteIndex(index: Cell, paletteSize: number): Cell {
  return index === TRANSPARENT ? TRANSPARENT : Math.min(index, paletteSize - 1) as Cell;
}

export interface ToolDefinition {
  readonly id: ToolId;
  readonly label: string;
  readonly shortcut: string;
  readonly icon: LucideIcon;
  /** Tools that paint on drag; pan and eyedropper do not. */
  readonly paints: boolean;
}

export const EDITOR_TOOLS: readonly ToolDefinition[] = [
  { id: "pencil", label: "Pencil", shortcut: "B", icon: Pencil, paints: true },
  { id: "eraser", label: "Eraser", shortcut: "E", icon: Eraser, paints: true },
  { id: "bucket", label: "Bucket", shortcut: "G", icon: PaintBucket, paints: false },
  { id: "eyedropper", label: "Eyedropper", shortcut: "I", icon: Pipette, paints: false },
  {
    id: "select",
    label: "Select",
    shortcut: "M",
    icon: SquareDashed,
    paints: false,
  },
  { id: "pan", label: "Pan", shortcut: "H", icon: Hand, paints: false },
];

export const SHORTCUT_TO_TOOL: Readonly<Record<string, ToolId>> = Object.freeze({
  b: "pencil",
  e: "eraser",
  g: "bucket",
  i: "eyedropper",
  m: "select",
  h: "pan",
});
