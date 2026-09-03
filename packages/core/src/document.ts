/**
 * The document: dimensions, a palette, one or more frames, metadata.
 *
 * A frame is a composite of layers. Layers are not a shipped feature until phase
 * 15 — the abstraction is carried from the start because retrofitting a
 * composite through every phase that touches pixels costs far more than an
 * unused field does.
 *
 * `validateDocument` is the single place the five invariants are checked against
 * a whole document. The store checks them per-mutation; this catches anything
 * arriving from outside, such as deserialised JSON or a model response.
 */

import { fail, requirePositiveInteger } from "./errors";
import { cloneGrid, createGrid, isCell } from "./grid";
import { createPalette, isCellInPalette } from "./palette";
import {
  MAX_PALETTE_SIZE,
  TRANSPARENT,
  type Cell,
  type DocumentMetadata,
  type Frame,
  type Grid,
  type Layer,
  type Palette,
  type PixelDocument,
} from "./types";

export const DEFAULT_FRAME_DURATION_MS = 250;

let counter = 0;
const SESSION = Math.random().toString(36).slice(2, 8);

/**
 * Readable ids, monotonic within a session and prefixed by a per-session token.
 *
 * The prefix is what keeps two documents authored in different browser sessions
 * from colliding once persistence lands, without pulling in a uuid dependency.
 */
export function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}_${SESSION}${counter.toString(36)}`;
}

export interface CreateLayerInput {
  readonly id?: string;
  readonly name?: string;
  readonly visible?: boolean;
  readonly grid?: Grid;
}

export function createLayer(width: number, height: number, input: CreateLayerInput = {}): Layer {
  const grid = input.grid === undefined ? createGrid(width, height) : cloneGrid(input.grid);
  if (grid.width !== width || grid.height !== height) {
    fail(
      "dimension_mismatch",
      `Layer grid is ${String(grid.width)}x${String(grid.height)} but the document is ${String(width)}x${String(height)}. All layers share the document's dimensions.`,
    );
  }
  return {
    id: input.id ?? nextId("layer"),
    name: input.name ?? "Layer 1",
    visible: input.visible ?? true,
    grid,
  };
}

export interface CreateFrameInput {
  readonly id?: string;
  readonly durationMs?: number;
  readonly layers?: readonly Layer[];
}

export function createFrame(width: number, height: number, input: CreateFrameInput = {}): Frame {
  const layers =
    input.layers === undefined || input.layers.length === 0
      ? [createLayer(width, height)]
      : input.layers.map((layer) => createLayer(width, height, layer));
  return {
    id: input.id ?? nextId("frame"),
    durationMs: requirePositiveInteger(input.durationMs ?? DEFAULT_FRAME_DURATION_MS, "durationMs"),
    layers,
  };
}

export interface CreateDocumentInput {
  readonly id?: string;
  readonly name?: string;
  readonly width: number;
  readonly height: number;
  readonly palette: Palette | readonly string[];
  readonly frames?: readonly Frame[];
  readonly frameCount?: number;
  readonly metadata?: Partial<DocumentMetadata>;
}

export function createDocument(input: CreateDocumentInput): PixelDocument {
  const width = requirePositiveInteger(input.width, "width");
  const height = requirePositiveInteger(input.height, "height");
  const palette = Array.isArray(input.palette)
    ? createPalette({ colors: input.palette })
    : (input.palette as Palette);

  const frames =
    input.frames !== undefined && input.frames.length > 0
      ? input.frames.map((frame) => createFrame(width, height, frame))
      : Array.from({ length: requirePositiveInteger(input.frameCount ?? 1, "frameCount") }, () =>
          createFrame(width, height),
        );

  const now = new Date(0).toISOString();
  const document: PixelDocument = {
    id: input.id ?? nextId("doc"),
    name: input.name ?? "Untitled",
    width,
    height,
    palette,
    frames,
    metadata: {
      createdAt: input.metadata?.createdAt ?? now,
      updatedAt: input.metadata?.updatedAt ?? now,
      tags: input.metadata?.tags ?? [],
    },
  };
  validateDocument(document);
  return document;
}

export function cloneDocument(document: PixelDocument): PixelDocument {
  return {
    ...document,
    palette: { ...document.palette, colors: document.palette.colors.map((color) => ({ ...color })) },
    frames: document.frames.map((frame) => ({
      ...frame,
      layers: frame.layers.map((layer) => ({ ...layer, grid: cloneGrid(layer.grid) })),
    })),
    metadata: { ...document.metadata, tags: [...document.metadata.tags] },
  };
}

/**
 * Flattens a frame's visible layers into one grid, bottom to top.
 *
 * Compositing is a straight overwrite — a non-transparent cell replaces what is
 * beneath it. There is no blending, because invariant 2 leaves nothing to blend.
 */
export function compositeFrame(frame: Frame, width: number, height: number): Grid {
  const composite = createGrid(width, height);
  for (const layer of frame.layers) {
    if (!layer.visible) continue;
    for (let i = 0; i < composite.cells.length; i += 1) {
      const value = layer.grid.cells[i] as Cell;
      if (value !== TRANSPARENT) composite.cells[i] = value;
    }
  }
  return composite;
}

/** Throws a {@link PixelError} naming the first invariant the document breaks. */
export function validateDocument(document: PixelDocument): void {
  requirePositiveInteger(document.width, "width");
  requirePositiveInteger(document.height, "height");

  if (document.palette.colors.length === 0) {
    fail("invalid_document", "Document palette is empty. A document needs at least one colour.");
  }
  if (document.palette.colors.length > MAX_PALETTE_SIZE) {
    fail("palette_overflow", `Document palette exceeds the ${String(MAX_PALETTE_SIZE)}-colour cap.`);
  }
  if (document.frames.length === 0) {
    fail("invalid_document", "Document has no frames. Every document has at least one frame.");
  }

  for (let f = 0; f < document.frames.length; f += 1) {
    const frame = document.frames[f] as Frame;
    requirePositiveInteger(frame.durationMs, `frames[${String(f)}].durationMs`);
    if (frame.layers.length === 0) {
      fail("invalid_document", `Frame ${String(f)} has no layers. Every frame has at least one layer.`);
    }
    for (let l = 0; l < frame.layers.length; l += 1) {
      const layer = frame.layers[l] as Layer;
      const grid = layer.grid;
      // Invariants 3 and 5 — dimensions are fixed, and every frame agrees.
      if (grid.width !== document.width || grid.height !== document.height) {
        fail(
          "frame_mismatch",
          `frames[${String(f)}].layers[${String(l)}] is ${String(grid.width)}x${String(grid.height)} but the document is ${String(document.width)}x${String(document.height)}. All frames of an asset share dimensions and palette.`,
        );
      }
      if (grid.cells.length !== document.width * document.height) {
        fail(
          "frame_mismatch",
          `frames[${String(f)}].layers[${String(l)}] holds ${String(grid.cells.length)} cells but ${String(document.width * document.height)} are required for a ${String(document.width)}x${String(document.height)} grid.`,
        );
      }
      // Invariant 1 — every cell is a valid palette index or transparent.
      for (let i = 0; i < grid.cells.length; i += 1) {
        const value = grid.cells[i] as Cell;
        if (!isCell(value) || !isCellInPalette(document.palette, value)) {
          const x = i % document.width;
          const y = (i / document.width) | 0;
          fail(
            "invalid_index",
            `frames[${String(f)}].layers[${String(l)}] holds ${String(value)} at (${String(x)}, ${String(y)}), which is not a palette index 0-${String(document.palette.colors.length - 1)} or -1 (transparent).`,
          );
        }
      }
    }
  }
}

export interface DocumentStats {
  readonly opaque: number;
  readonly transparent: number;
  readonly coverage: number;
  readonly usage: ReadonlyMap<Cell, number>;
}

/** Coverage and per-index usage for one composited frame. Feeds `get_palette` in phase 03. */
export function frameStats(document: PixelDocument, frameIndex: number): DocumentStats {
  const frame = document.frames[frameIndex];
  if (frame === undefined) {
    fail(
      "unknown_target",
      `Frame ${String(frameIndex)} does not exist. This document has ${String(document.frames.length)} frame(s), indices 0-${String(document.frames.length - 1)}.`,
    );
  }
  const grid = compositeFrame(frame, document.width, document.height);
  const usage = new Map<Cell, number>();
  let opaque = 0;
  for (let i = 0; i < grid.cells.length; i += 1) {
    const value = grid.cells[i] as Cell;
    usage.set(value, (usage.get(value) ?? 0) + 1);
    if (value !== TRANSPARENT) opaque += 1;
  }
  const total = grid.cells.length;
  return { opaque, transparent: total - opaque, coverage: opaque / total, usage };
}
