/**
 * The document store — one mutation chokepoint, one undo stack, two front doors.
 *
 * Every human action and every WebMCP tool call (phase 03) lands in `#apply`.
 * That is the whole design: invariants are enforced once, at the boundary, so
 * the agent path cannot drift from the human path, and the human can undo the
 * agent's work because there is only one stack to undo from.
 *
 * State lives in `#`-private fields and is handed out only as copies. Nothing
 * outside this class can reach a live `Int8Array`.
 */

import { fail, requirePositiveInteger } from "./errors";
import {
  cloneDocument,
  compositeFrame,
  createFrame,
  frameStats,
  nextId,
  validateDocument,
  type DocumentStats,
} from "./document";
import { cloneGrid, decodeGrid, encodeGrid, silhouette } from "./grid";
import { isCellInPalette } from "./palette";
import {
  bucketFill,
  clearRegion,
  fillRegion,
  mirror,
  replaceColor,
  setPixels,
  shift,
  writeRegion,
  type BucketFillOptions,
  type CellChange,
  type PixelWrite,
  type ShiftOptions,
} from "./mutations";
import type {
  Cell,
  Frame,
  Grid,
  Layer,
  MirrorAxis,
  Palette,
  PixelDocument,
  PixelPatch,
  Region,
  ResolvedTarget,
  Target,
} from "./types";

/** A colour edit. The unit of undo for everything that changes pixels. */
export interface PixelHistoryEntry {
  readonly kind: "pixels";
  readonly id: string;
  readonly label: string;
  readonly patches: readonly PixelPatch[];
}

/**
 * A structural change to the frame list.
 *
 * Deliberately not expressed as pixel patches: adding a frame changes what
 * indices mean, which no set of per-cell edits can describe. Each variant
 * carries the minimum needed to invert it rather than a snapshot of the frame
 * array, so history stays proportional to what changed.
 */
export type FrameChange =
  | { readonly op: "add"; readonly index: number; readonly frame: Frame }
  | { readonly op: "delete"; readonly index: number; readonly frame: Frame }
  | { readonly op: "reorder"; readonly order: readonly number[] }
  | { readonly op: "duration"; readonly index: number; readonly from: number; readonly to: number };

export interface FrameHistoryEntry {
  readonly kind: "frames";
  readonly id: string;
  readonly label: string;
  readonly change: FrameChange;
}

/**
 * Several changes undone and redone as one.
 *
 * What makes a six-frame procedural cycle a single Ctrl+Z rather than six.
 * Steps are held in application order and reverted in reverse, so the same LIFO
 * argument that keeps index-addressed pixel patches valid holds inside a
 * compound entry too.
 */
export interface CompoundHistoryEntry {
  readonly kind: "compound";
  readonly id: string;
  readonly label: string;
  readonly steps: readonly HistoryEntry[];
}

/**
 * One entry on the shared undo stack.
 *
 * Pixel patches address frames by index, and a structural change moves those
 * indices. That is safe only because the stack is strictly LIFO: any pixel
 * entry recorded after a structural one is undone before it, so indices are
 * always back to what the patch expected by the time it is applied.
 */
export type HistoryEntry = PixelHistoryEntry | FrameHistoryEntry | CompoundHistoryEntry;

export interface AddFrameOptions {
  /** Duplicate this frame's layers and duration. Omit for a blank frame. */
  readonly copyFrom?: number;
  /** Insert position. Defaults to the end. */
  readonly at?: number;
}

export interface DocumentStoreOptions {
  /** Oldest entries are dropped past this many. Defaults to 200. */
  readonly historyLimit?: number;
}

/**
 * One step of an open transaction.
 *
 * Ordered rather than merged into a single map, because a structural change
 * moves the indices every buffered pixel patch refers to. Consecutive pixel
 * mutations still coalesce into the step in progress — that is what keeps a drag
 * stroke one entry — but a frame change closes it and starts a new one after.
 */
type TransactionStep =
  | { readonly kind: "pixels"; readonly patches: Map<string, PixelPatch> }
  | { readonly kind: "frames"; readonly change: FrameChange };

interface OpenTransaction {
  label: string;
  depth: number;
  readonly steps: TransactionStep[];
}

const DEFAULT_HISTORY_LIMIT = 200;

export class DocumentStore {
  readonly #document: PixelDocument;
  readonly #undoStack: HistoryEntry[] = [];
  readonly #redoStack: HistoryEntry[] = [];
  readonly #listeners = new Set<() => void>();
  readonly #historyLimit: number;
  #transaction: OpenTransaction | null = null;
  #frame = 0;
  #layer = 0;
  #revision = 0;

  constructor(document: PixelDocument, options: DocumentStoreOptions = {}) {
    validateDocument(document);
    // Copy on the way in: whoever built the document keeps no handle on our cells.
    this.#document = cloneDocument(document);
    this.#historyLimit = options.historyLimit ?? DEFAULT_HISTORY_LIMIT;
  }

  // ---------------------------------------------------------------- identity

  get id(): string {
    return this.#document.id;
  }

  get name(): string {
    return this.#document.name;
  }

  get width(): number {
    return this.#document.width;
  }

  get height(): number {
    return this.#document.height;
  }

  get frameCount(): number {
    return this.#document.frames.length;
  }

  get layerCount(): number {
    return (this.#document.frames[this.#frame] as Frame).layers.length;
  }

  /** Bumped on every applied change. Cheap identity for `useSyncExternalStore`. */
  get revision(): number {
    return this.#revision;
  }

  // --------------------------------------------------------------- selection

  get activeFrame(): number {
    return this.#frame;
  }

  get activeLayer(): number {
    return this.#layer;
  }

  selectFrame(index: number): void {
    this.#resolve({ frame: index, layer: 0 });
    this.#frame = index;
    this.#layer = Math.min(this.#layer, this.layerCount - 1);
    this.#notify();
  }

  selectLayer(index: number): void {
    this.#resolve({ layer: index });
    this.#layer = index;
    this.#notify();
  }

  // ------------------------------------------------------------- perception

  /** A deep copy. Mutating the result cannot affect store state. */
  snapshot(): PixelDocument {
    return cloneDocument(this.#document);
  }

  get palette(): Palette {
    return { ...this.#document.palette, colors: this.#document.palette.colors.map((c) => ({ ...c })) };
  }

  /** Copy of one layer's grid. */
  readLayer(target?: Target): Grid {
    const resolved = this.#resolve(target);
    return cloneGrid(this.#gridAt(resolved));
  }

  /** Copy of a frame's visible layers, flattened. This is what `read_canvas` renders. */
  readComposite(frameIndex?: number): Grid {
    const resolved = this.#resolve(frameIndex === undefined ? undefined : { frame: frameIndex });
    return compositeFrame(
      this.#document.frames[resolved.frame] as Frame,
      this.#document.width,
      this.#document.height,
    );
  }

  /** The composited frame in the indexed text format. */
  encode(frameIndex?: number): string {
    return encodeGrid(this.readComposite(frameIndex));
  }

  /** 1-bit opacity mask of the composited frame. */
  silhouette(frameIndex?: number): string {
    return silhouette(this.readComposite(frameIndex));
  }

  colorAt(x: number, y: number, frameIndex?: number): Cell {
    return this.#cellAt(this.readComposite(frameIndex), x, y);
  }

  stats(frameIndex?: number): DocumentStats {
    const target = frameIndex === undefined ? undefined : { frame: frameIndex };
    return frameStats(this.#document, this.#resolve(target).frame);
  }

  // -------------------------------------------------------------- mutations

  setPixels(pixels: readonly PixelWrite[], target?: Target): number {
    return this.#apply("Set pixels", (grid) => setPixels(grid, pixels), target);
  }

  /** `source` may be a grid or the indexed text format an agent produced. */
  writeRegion(x: number, y: number, source: Grid | string, target?: Target): number {
    const grid = typeof source === "string" ? decodeGrid(source) : source;
    return this.#apply("Write region", (destination) => writeRegion(destination, x, y, grid), target);
  }

  fillRegion(region: Region, index: Cell, target?: Target): number {
    return this.#apply("Fill region", (grid) => fillRegion(grid, region, index), target);
  }

  bucketFill(x: number, y: number, index: Cell, options?: BucketFillOptions, target?: Target): number {
    return this.#apply("Bucket fill", (grid) => bucketFill(grid, x, y, index, options ?? {}), target);
  }

  replaceColor(from: Cell, to: Cell, target?: Target): number {
    return this.#apply("Replace colour", (grid) => replaceColor(grid, from, to), target);
  }

  clearRegion(region: Region, target?: Target): number {
    return this.#apply("Clear region", (grid) => clearRegion(grid, region), target);
  }

  shift(dx: number, dy: number, options?: ShiftOptions, target?: Target): number {
    return this.#apply("Shift", (grid) => shift(grid, dx, dy, options ?? {}), target);
  }

  mirror(axis: MirrorAxis, region?: Region, target?: Target): number {
    return this.#apply("Mirror", (grid) => mirror(grid, axis, region), target);
  }

  // ------------------------------------------------------------------ frames

  /**
   * Adds a frame and selects it. Returns its index.
   *
   * A copied frame duplicates the source's layers and duration; grids are
   * cloned, never shared, so painting the copy cannot alter the original.
   * Nothing here interprets frames as motion — that is phase 07.
   */
  addFrame(options: AddFrameOptions = {}): number {
    const frames = this.#frames;
    const at = options.at ?? frames.length;
    if (!Number.isInteger(at) || at < 0 || at > frames.length) {
      fail(
        "invalid_argument",
        `Cannot insert a frame at ${String(at)}. Valid positions are 0-${String(frames.length)} for a document with ${String(frames.length)} frame(s).`,
      );
    }

    const { width, height } = this.#document;
    let frame: Frame;
    if (options.copyFrom === undefined) {
      frame = createFrame(width, height);
    } else {
      const source = frames[options.copyFrom];
      if (source === undefined) {
        fail(
          "unknown_target",
          `Cannot copy frame ${String(options.copyFrom)}: it does not exist. Valid indices are 0-${String(frames.length - 1)}.`,
        );
      }
      frame = createFrame(width, height, {
        durationMs: source.durationMs,
        // Fresh layer ids: a duplicated frame is a new frame, not an alias.
        layers: source.layers.map((layer) => ({ ...layer, id: nextId("layer") })),
      });
    }

    frames.splice(at, 0, frame);
    this.#frame = at;
    this.#commitFrameChange("Add frame", { op: "add", index: at, frame });
    return at;
  }

  /** Removes a frame. Refuses to remove the last one — a document always has a canvas. */
  deleteFrame(index: number): void {
    const frames = this.#frames;
    this.#requireFrameIndex(index);
    if (frames.length === 1) {
      fail(
        "invalid_argument",
        "Cannot delete the only frame: every document has at least one. Clear it with clearRegion instead, or add a frame first.",
      );
    }

    const [frame] = frames.splice(index, 1);
    this.#clampSelection();
    this.#commitFrameChange("Delete frame", { op: "delete", index, frame: frame as Frame });
  }

  /**
   * Reorders frames. `order[newIndex]` is the index the frame currently sits at.
   *
   * Rejects anything that is not a permutation, because a partial order would
   * silently drop or duplicate artwork.
   */
  reorderFrames(order: readonly number[]): void {
    const frames = this.#frames;
    if (order.length !== frames.length) {
      fail(
        "invalid_argument",
        `Order lists ${String(order.length)} frame(s) but the document has ${String(frames.length)}. Provide every index exactly once.`,
      );
    }

    const seen = new Set<number>();
    for (const index of order) {
      if (!Number.isInteger(index) || index < 0 || index >= frames.length) {
        fail(
          "invalid_argument",
          `Order contains ${String(index)}, which is not a frame index. Valid indices are 0-${String(frames.length - 1)}.`,
        );
      }
      if (seen.has(index)) {
        fail(
          "invalid_argument",
          `Order lists frame ${String(index)} more than once. Every index must appear exactly once.`,
        );
      }
      seen.add(index);
    }

    if (order.every((from, to) => from === to)) return;

    const selected = frames[this.#frame] as Frame;
    const reordered = order.map((from) => frames[from] as Frame);
    frames.splice(0, frames.length, ...reordered);
    // Follow the frame the human had selected rather than holding its old slot.
    this.#frame = Math.max(0, frames.indexOf(selected));
    this.#commitFrameChange("Reorder frames", { op: "reorder", order: [...order] });
  }

  /** Sets how long a frame is held, in milliseconds. */
  setFrameDuration(index: number, ms: number): void {
    this.#requireFrameIndex(index);
    requirePositiveInteger(ms, "ms");

    const from = (this.#frames[index] as Frame).durationMs;
    if (from === ms) return;
    this.#writeDuration(index, ms);
    this.#commitFrameChange("Set frame duration", { op: "duration", index, from, to: ms });
  }

  // ---------------------------------------------------------------- history

  /**
   * Groups everything `run` does into one undo entry.
   *
   * This is what makes a drag stroke undo as a stroke. Per-pixel undo during a
   * freehand drag is unusable, and the fix has to be explicit — coalescing by
   * timing or by guessing the caller's intent is how granularity goes wrong.
   */
  transaction<T>(label: string, run: () => T): T {
    this.begin(label);
    try {
      const result = run();
      this.commit();
      return result;
    } catch (error) {
      this.abort();
      throw error;
    }
  }

  begin(label: string): void {
    if (this.#transaction === null) {
      this.#transaction = { label, depth: 1, steps: [] };
      return;
    }
    this.#transaction.depth += 1;
  }

  commit(): void {
    const open = this.#transaction;
    if (open === null) {
      fail("no_transaction", "commit() was called with no open transaction. Call begin(label) first.");
    }
    open.depth -= 1;
    if (open.depth > 0) return;

    this.#transaction = null;
    const entries = this.#entriesFor(open);
    if (entries.length === 0) return;

    this.#push(
      entries.length === 1
        ? (entries[0] as HistoryEntry)
        : { kind: "compound", id: nextId("entry"), label: open.label, steps: entries },
    );
    this.#notify();
  }

  /** Rolls the open transaction back to where it began and discards it. */
  abort(): void {
    const open = this.#transaction;
    if (open === null) {
      fail("no_transaction", "abort() was called with no open transaction. Call begin(label) first.");
    }
    this.#transaction = null;
    const entries = this.#entriesFor(open);
    for (let i = entries.length - 1; i >= 0; i -= 1) this.#revert(entries[i] as HistoryEntry);
    if (entries.length > 0) {
      this.#revision += 1;
      this.#notify();
    }
  }

  get inTransaction(): boolean {
    return this.#transaction !== null;
  }

  get canUndo(): boolean {
    return this.#undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.#redoStack.length > 0;
  }

  /** Labels oldest-first. Drives the history panel and makes tests readable. */
  history(): readonly string[] {
    return this.#undoStack.map((entry) => entry.label);
  }

  /** Returns the label of the undone entry, or `null` when there was nothing to undo. */
  undo(): string | null {
    this.#assertNoOpenTransaction("undo");
    const entry = this.#undoStack.pop();
    if (entry === undefined) return null;
    this.#revert(entry);
    this.#redoStack.push(entry);
    this.#revision += 1;
    this.#notify();
    return entry.label;
  }

  redo(): string | null {
    this.#assertNoOpenTransaction("redo");
    const entry = this.#redoStack.pop();
    if (entry === undefined) return null;
    this.#reapply(entry);
    this.#undoStack.push(entry);
    this.#revision += 1;
    this.#notify();
    return entry.label;
  }

  clearHistory(): void {
    this.#undoStack.length = 0;
    this.#redoStack.length = 0;
  }

  // ------------------------------------------------------------ subscription

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  // ---------------------------------------------------------------- internals

  /**
   * The chokepoint. Every mutation in this class routes through here.
   *
   * `run` computes changes against a live grid but never writes, so validation
   * happens before a single cell moves — a rejected mutation leaves no partial
   * state behind.
   */
  #apply(
    label: string,
    run: (grid: Grid, target: ResolvedTarget) => CellChange[],
    target?: Target,
  ): number {
    const resolved = this.#resolve(target);
    const grid = this.#gridAt(resolved);
    const changes = run(grid, resolved);
    if (changes.length === 0) return 0;

    // Invariant 1, enforced here rather than in each mutation, so a new mutation
    // cannot forget to check and a tool call cannot bypass it.
    const palette = this.#document.palette;
    for (const item of changes) {
      if (!isCellInPalette(palette, item.to)) {
        const x = item.offset % this.#document.width;
        const y = (item.offset / this.#document.width) | 0;
        fail(
          "invalid_index",
          `Rejected: cell (${String(x)}, ${String(y)}) would become ${String(item.to)}, which is not a palette index 0-${String(palette.colors.length - 1)} or -1 (transparent). Palette '${palette.name}' has ${String(palette.colors.length)} colours.`,
        );
      }
    }

    const patches: PixelPatch[] = changes.map((item) => ({
      frame: resolved.frame,
      layer: resolved.layer,
      offset: item.offset,
      from: item.from,
      to: item.to,
    }));
    for (const patch of patches) this.#write(patch, "to");

    if (this.#transaction !== null) {
      this.#coalesce(patches);
    } else {
      this.#push({ kind: "pixels", id: nextId("entry"), label, patches });
    }
    this.#revision += 1;
    this.#notify();
    return patches.length;
  }

  /** Keeps the original `from` and the latest `to` per cell — one entry per stroke. */
  #coalesce(patches: readonly PixelPatch[]): void {
    const open = this.#transaction as OpenTransaction;
    const last = open.steps[open.steps.length - 1];
    let step: TransactionStep;
    if (last !== undefined && last.kind === "pixels") {
      step = last;
    } else {
      step = { kind: "pixels", patches: new Map<string, PixelPatch>() };
      open.steps.push(step);
    }
    const target = (step as { patches: Map<string, PixelPatch> }).patches;

    for (const patch of patches) {
      const key = `${String(patch.frame)}:${String(patch.layer)}:${String(patch.offset)}`;
      const existing = target.get(key);
      target.set(key, existing === undefined ? patch : { ...existing, to: patch.to });
    }
  }

  /**
   * The live frame array.
   *
   * `PixelDocument` types `frames` readonly for callers, which is the contract
   * we want outside the store. Inside it, this array is ours to splice.
   */
  get #frames(): Frame[] {
    return this.#document.frames as Frame[];
  }

  #requireFrameIndex(index: number): void {
    const frames = this.#frames;
    if (!Number.isInteger(index) || index < 0 || index >= frames.length) {
      fail(
        "unknown_target",
        `Frame ${String(index)} does not exist. This document has ${String(frames.length)} frame(s), indices 0-${String(frames.length - 1)}.`,
      );
    }
  }

  #writeDuration(index: number, ms: number): void {
    const frames = this.#frames;
    // Replaced rather than mutated: `Frame.durationMs` is readonly, and the
    // spread keeps the same layer and grid objects, so pixel state is untouched.
    frames[index] = { ...(frames[index] as Frame), durationMs: ms };
  }

  #commitFrameChange(label: string, change: FrameChange): void {
    if (this.#transaction !== null) {
      this.#transaction.steps.push({ kind: "frames", change });
    } else {
      this.#push({ kind: "frames", id: nextId("entry"), label, change });
    }
    this.#revision += 1;
    this.#notify();
  }

  /** Flattens an open transaction into the entries it would commit, in order. */
  #entriesFor(open: OpenTransaction): HistoryEntry[] {
    const entries: HistoryEntry[] = [];
    for (const step of open.steps) {
      if (step.kind === "frames") {
        entries.push({ kind: "frames", id: nextId("entry"), label: open.label, change: step.change });
        continue;
      }
      const patches = [...step.patches.values()].filter((patch) => patch.from !== patch.to);
      if (patches.length > 0) {
        entries.push({ kind: "pixels", id: nextId("entry"), label: open.label, patches });
      }
    }
    return entries;
  }

  /** Keeps the selection inside the document after frames appear or disappear. */
  #clampSelection(): void {
    const frames = this.#frames;
    this.#frame = Math.min(Math.max(this.#frame, 0), frames.length - 1);
    const layers = (frames[this.#frame] as Frame).layers;
    this.#layer = Math.min(Math.max(this.#layer, 0), layers.length - 1);
  }

  #revert(entry: HistoryEntry): void {
    if (entry.kind === "compound") {
      for (let i = entry.steps.length - 1; i >= 0; i -= 1) this.#revert(entry.steps[i] as HistoryEntry);
      return;
    }
    if (entry.kind === "pixels") {
      for (let i = entry.patches.length - 1; i >= 0; i -= 1) {
        this.#write(entry.patches[i] as PixelPatch, "from");
      }
      return;
    }

    const frames = this.#frames;
    const change = entry.change;
    switch (change.op) {
      case "add":
        frames.splice(change.index, 1);
        break;
      case "delete":
        frames.splice(change.index, 0, change.frame);
        break;
      case "reorder": {
        // Invert the permutation: what moved to `to` came from `from`.
        const current = [...frames];
        const restored: Frame[] = new Array<Frame>(current.length);
        change.order.forEach((from, to) => {
          restored[from] = current[to] as Frame;
        });
        frames.splice(0, frames.length, ...restored);
        break;
      }
      case "duration":
        this.#writeDuration(change.index, change.from);
        break;
    }
    this.#clampSelection();
  }

  #reapply(entry: HistoryEntry): void {
    if (entry.kind === "compound") {
      for (const step of entry.steps) this.#reapply(step);
      return;
    }
    if (entry.kind === "pixels") {
      for (const patch of entry.patches) this.#write(patch, "to");
      return;
    }

    const frames = this.#frames;
    const change = entry.change;
    switch (change.op) {
      case "add":
        frames.splice(change.index, 0, change.frame);
        break;
      case "delete":
        frames.splice(change.index, 1);
        break;
      case "reorder": {
        const current = [...frames];
        frames.splice(0, frames.length, ...change.order.map((from) => current[from] as Frame));
        break;
      }
      case "duration":
        this.#writeDuration(change.index, change.to);
        break;
    }
    this.#clampSelection();
  }

  #push(entry: HistoryEntry): void {
    this.#undoStack.push(entry);
    this.#redoStack.length = 0;
    while (this.#undoStack.length > this.#historyLimit) this.#undoStack.shift();
  }

  #write(patch: PixelPatch, direction: "from" | "to"): void {
    const frame = this.#document.frames[patch.frame] as Frame;
    const layer = frame.layers[patch.layer] as Layer;
    layer.grid.cells[patch.offset] = patch[direction];
  }

  #resolve(target?: Target): ResolvedTarget {
    const frame = target?.frame ?? this.#frame;
    const frames = this.#document.frames;
    if (!Number.isInteger(frame) || frame < 0 || frame >= frames.length) {
      fail(
        "unknown_target",
        `Frame ${String(frame)} does not exist. This document has ${String(frames.length)} frame(s), indices 0-${String(frames.length - 1)}.`,
      );
    }
    const layers = (frames[frame] as Frame).layers;
    const layer = target?.layer ?? Math.min(this.#layer, layers.length - 1);
    if (!Number.isInteger(layer) || layer < 0 || layer >= layers.length) {
      fail(
        "unknown_target",
        `Layer ${String(layer)} does not exist in frame ${String(frame)}. That frame has ${String(layers.length)} layer(s), indices 0-${String(layers.length - 1)}.`,
      );
    }
    return { frame, layer };
  }

  #gridAt(target: ResolvedTarget): Grid {
    return ((this.#document.frames[target.frame] as Frame).layers[target.layer] as Layer).grid;
  }

  #cellAt(grid: Grid, x: number, y: number): Cell {
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= grid.width || y >= grid.height) {
      fail(
        "out_of_bounds",
        `(${String(x)}, ${String(y)}) is outside the ${String(grid.width)}x${String(grid.height)} canvas. Valid x is 0-${String(grid.width - 1)}, valid y is 0-${String(grid.height - 1)}, origin top-left.`,
      );
    }
    return grid.cells[y * grid.width + x] as Cell;
  }

  #assertNoOpenTransaction(action: string): void {
    if (this.#transaction !== null) {
      fail(
        "invalid_argument",
        `Cannot ${action} while a transaction is open. Call commit() or abort() first.`,
      );
    }
  }

  #notify(): void {
    for (const listener of this.#listeners) listener();
  }
}

export function createStore(document: PixelDocument, options?: DocumentStoreOptions): DocumentStore {
  return new DocumentStore(document, options);
}
