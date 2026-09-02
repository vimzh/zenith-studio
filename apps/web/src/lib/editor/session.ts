import {
  TRANSPARENT,
  conformToStyle,
  createPalette,
  createDocument,
  createFrame,
  createLayer,
  createStore,
  deserializeDocument,
  nearestIndex,
  serializeDocument,
  type DocumentStore,
  type Grid,
  type PixelDocument,
  type StyleProfile,
} from "@zenith/core";
import { CANVAS_PRESETS, DEFAULT_PRESET_ID, findPreset } from "@/lib/pixel";
import { assetStorage, type StoredAsset } from "./storage";

/**
 * App-level state: which assets exist, and which one is open.
 *
 * An **asset** is any single pixel-art thing — a grass block, a cobblestone
 * texture, a character sprite, a sword icon. One flat library, no projects or
 * workspaces (deferred to phase 14). `@zenith/core` calls the underlying value
 * a `PixelDocument`; "asset" is the product-level name for the same thing.
 *
 * Shared by two consumers that must not disagree:
 *  - the editor UI (phase 02 / 04)
 *  - the WebMCP tool layer (phase 03) — `list_assets`, `create_asset`, `open_asset`
 *
 * Like `DocumentStore`, this is deliberately not React state: tools mutate it
 * from outside the render tree. Bind with `useSyncExternalStore` via
 * `useSession` / `useSessionSelector`. Persistence is phase 05; this is in-memory.
 */

export type AssetType =
  | "character"
  | "tile"
  | "texture"
  /** A derived autotile set — a sheet of tiles, not a single tile. */
  | "tileset"
  | "item"
  | "ui";

export interface AssetSummary {
  readonly id: string;
  readonly name: string;
  readonly type: AssetType;
  readonly width: number;
  readonly height: number;
  readonly frameCount: number;
}

export interface CreateAssetInput {
  readonly name?: string;
  readonly type?: AssetType;
  /** A `CANVAS_PRESETS` id. Defaults to `tile-32`. */
  readonly preset?: string;
  /** Initial content. Must match the resolved dimensions. Used to seed examples. */
  readonly grid?: Grid;
  /**
   * Palette to use instead of the preset's.
   *
   * A generated asset arrives with a palette the pipeline extracted from the
   * image. Remapping that onto a preset's colours is right when it must match
   * existing work, and wrong for a first standalone asset — it discards the
   * only palette anyone chose deliberately.
   */
  readonly palette?: readonly string[];
  /** Dimensions to use instead of the preset's. Both are required together. */
  readonly width?: number;
  readonly height?: number;
}

interface AssetEntry {
  readonly store: DocumentStore;
  /**
   * What the asset is, which decides which capabilities apply to it.
   *
   * Mutable alongside `name`, and for the same reason: both are metadata about
   * the document rather than part of it, so changing either needs no rebuild
   * and costs no undo history.
   */
  type: AssetType;
  /** Held here rather than on the store: `DocumentStore.name` is read-only. */
  name: string;
  order: number;
  /**
   * Bumped whenever this asset's store object is *replaced* rather than mutated.
   *
   * Components hold a `DocumentStore` reference; replacing it leaves every one
   * of them subscribed to an object nobody writes to any more, which renders
   * stale silently. The editor keys on this so a replacement remounts it.
   */
  generation: number;
  /** Unsubscribes this entry's store listener. Called on close. */
  unwatch: () => void;
}

/** A closed asset, retained so the deletion can be undone. */
interface DeletedAsset {
  readonly record: StoredAsset;
  readonly wasActive: boolean;
}

let sequence = 0;

function nextAssetId(): string {
  sequence += 1;
  return `asset_${String(sequence).padStart(3, "0")}`;
}

/** Keeps generated ids clear of anything already restored from storage. */
function reserveId(id: string): void {
  const match = /^asset_(\d+)$/.exec(id);
  if (match !== null) {
    sequence = Math.max(sequence, Number(match[1]));
  }
}

export class EditorSession {
  readonly #assets = new Map<string, AssetEntry>();
  readonly #listeners = new Set<() => void>();
  #activeId: string | null = null;
  #revision = 0;
  #order = 0;
  #loaded = false;
  #hydration: Promise<void> | null = null;
  #lastDeleted: DeletedAsset | null = null;

  /** True once storage has been read, so the library can tell empty from not-yet-loaded. */
  get hydrated(): boolean {
    return this.#loaded;
  }

  /** The most recent deletion, if it can still be undone. */
  get lastDeleted(): { id: string; name: string } | null {
    return this.#lastDeleted === null
      ? null
      : { id: this.#lastDeleted.record.id, name: this.#lastDeleted.record.name };
  }

  /** Bumps on any session-level change: create, open, close, rename. */
  get revision(): number {
    return this.#revision;
  }

  get activeId(): string | null {
    return this.#activeId;
  }

  /** The open asset's store, or null when the library is empty. */
  get active(): DocumentStore | null {
    return this.#activeId === null ? null : (this.#assets.get(this.#activeId)?.store ?? null);
  }

  get size(): number {
    return this.#assets.size;
  }

  list(): readonly AssetSummary[] {
    return [...this.#assets.entries()]
      .sort(([, a], [, b]) => a.order - b.order)
      .map(([id, entry]) => ({
        id,
        name: entry.name,
        type: entry.type,
        width: entry.store.width,
        height: entry.store.height,
        frameCount: entry.store.frameCount,
      }));
  }

  /** The store for one asset, or undefined. Does not change the active asset. */
  get(id: string): DocumentStore | undefined {
    return this.#assets.get(id)?.store;
  }

  /**
   * How many times this asset's store has been replaced.
   *
   * Key the editor on it: a replacement hands out a new `DocumentStore`, and
   * anything still holding the old one is subscribed to an object that will
   * never change again.
   */
  generationOf(id: string): number {
    return this.#assets.get(id)?.generation ?? 0;
  }

  has(id: string): boolean {
    return this.#assets.has(id);
  }

  create(input: CreateAssetInput = {}): string {
    const presetId = input.preset ?? DEFAULT_PRESET_ID;
    const preset = findPreset(presetId);
    if (preset === undefined) {
      const available = CANVAS_PRESETS.map((candidate) => candidate.id).join(", ");
      throw new Error(`No preset '${presetId}'. Available: ${available}.`);
    }

    if ((input.width === undefined) !== (input.height === undefined)) {
      throw new Error(
        "width and height must be given together, or neither — a half-specified size has no sensible default."
      );
    }

    const id = nextAssetId();
    const document: PixelDocument = createDocument({
      id,
      name: input.name ?? preset.name,
      width: input.width ?? preset.width,
      height: input.height ?? preset.height,
      palette: input.palette ?? preset.colors,
    });

    const store = createStore(document);
    if (input.grid !== undefined) {
      // Seeded content is the starting state, not an edit — clearing history
      // means the first Ctrl+Z cannot rub out the example the user opened.
      store.writeRegion(0, 0, input.grid);
      store.clearHistory();
    }

    this.#insert(id, store, input.type ?? "tile", document.name);
    this.#activeId = id;
    this.#persist(id);
    this.#bump();
    return id;
  }

  /**
   * Registers an asset and starts persisting its edits.
   *
   * Each store gets a subscriber so that pixel changes — which never touch
   * session state — still reach storage. `assetStorage.save` coalesces, so a
   * revision per painted stroke is one write per burst, not one per stroke.
   */
  #insert(
    id: string,
    store: DocumentStore,
    type: AssetType,
    name: string,
    /** Restores an asset to its original position. Omitted for genuinely new assets. */
    order?: number,
    /**
     * Store-replacement counter. Must be passed explicitly by `#replace`:
     * reading it from the map here would always see 0, because `#replace`
     * deletes the entry before re-inserting it.
     */
    generation = 0
  ): void {
    const position = order ?? (this.#order += 1);
    this.#order = Math.max(this.#order, position);

    const unwatch = store.subscribe(() => {
      this.#persist(id);
    });
    this.#assets.set(id, { store, type, name, order: position, generation, unwatch });
    reserveId(id);
  }

  #persist(id: string): void {
    const entry = this.#assets.get(id);
    if (entry !== undefined) {
      assetStorage.save(this.#recordFor(id, entry));
    }
  }

  #recordFor(id: string, entry: AssetEntry): StoredAsset {
    return {
      id,
      name: entry.name,
      type: entry.type,
      order: entry.order,
      document: serializeDocument(entry.store.snapshot()),
    };
  }

  /** Makes an asset the open one. Returns false when the id is unknown. */
  open(id: string): boolean {
    if (!this.#assets.has(id)) {
      return false;
    }
    if (this.#activeId !== id) {
      this.#activeId = id;
      this.#bump();
    }
    return true;
  }

  /**
   * Removes an asset. Reassigns `activeId` when the closed asset was active.
   *
   * **That reassignment moves the session without moving the route.** The route
   * owns which asset is open (see `asset-editor.tsx`), so a caller that closes
   * the active asset while the editor is showing it must move the route too —
   * either by navigating, or via `assetNavigation.request(nextId)` from
   * `lib/webmcp/navigation.ts`. Skipping that leaves the agent editing an asset
   * the human is not looking at, which fails silently.
   *
   * Relevant when phase 05 adds delete from the library.
   */
  close(id: string): boolean {
    const entry = this.#assets.get(id);
    if (entry === undefined) {
      return false;
    }

    this.#lastDeleted = { record: this.#recordFor(id, entry), wasActive: this.#activeId === id };
    entry.unwatch();
    this.#assets.delete(id);
    assetStorage.remove(id);

    if (this.#activeId === id) {
      this.#activeId = this.#assets.keys().next().value ?? null;
    }
    this.#bump();
    return true;
  }

  /**
   * Changes what an asset *is*.
   *
   * Type is metadata, not a document invariant — it decides which capabilities
   * apply, so this needs no rebuild and keeps undo history. It matters because
   * every generative entry point defaults to `tile`: a character generated from
   * a prompt arrives typed as a tile, the editor hides the Directions panel
   * because that panel is character-only, and the whole directional workflow is
   * unreachable for an asset that plainly is a character. Before this the only
   * fix was to draw it again.
   */
  setType(id: string, type: AssetType): boolean {
    const entry = this.#assets.get(id);
    if (entry === undefined || entry.type === type) {
      return false;
    }
    entry.type = type;
    this.#persist(id);
    this.#bump();
    return true;
  }

  rename(id: string, name: string): boolean {
    const entry = this.#assets.get(id);
    if (entry === undefined) {
      return false;
    }
    entry.name = name;
    this.#persist(id);
    this.#bump();
    return true;
  }

  /** Copies an asset, including its pixels. The copy becomes active. */
  duplicate(id: string, name?: string): string | null {
    const entry = this.#assets.get(id);
    if (entry === undefined) {
      return null;
    }

    const copyId = nextAssetId();
    const source = entry.store.snapshot();
    const store = createStore({ ...source, id: copyId, name: name ?? `${entry.name} copy` });

    this.#insert(copyId, store, entry.type, name ?? `${entry.name} copy`);
    this.#activeId = copyId;
    this.#persist(copyId);
    this.#bump();
    return copyId;
  }

  /**
   * Restores the most recent deletion.
   *
   * Deleting work the user cannot get back is the one destructive action in the
   * library, so `close()` keeps the serialised record rather than dropping it.
   */
  undoDelete(): string | null {
    const deleted = this.#lastDeleted;
    if (deleted === null || this.#assets.has(deleted.record.id)) {
      return null;
    }

    const { record } = deleted;
    const store = createStore(deserializeDocument(record.document));
    // Restore the original position: an undone deletion should put the asset
    // back where it was, not append it to the end of the library.
    this.#insert(record.id, store, record.type, record.name, record.order);
    if (deleted.wasActive) {
      this.#activeId = record.id;
    }
    this.#lastDeleted = null;
    this.#persist(record.id);
    this.#bump();
    return record.id;
  }

  /**
   * Adds an existing document under a fresh id. Used by import.
   *
   * A new id rather than the document's own, so importing a bundle exported
   * from this library duplicates instead of silently overwriting.
   */
  adopt(document: PixelDocument, meta: { name?: string; type?: AssetType } = {}): string {
    const id = nextAssetId();
    const name = meta.name ?? document.name;
    const store = createStore({ ...document, id, name });

    this.#insert(id, store, meta.type ?? "tile", name);
    this.#activeId = id;
    this.#persist(id);
    this.#bump();
    return id;
  }

  /**
   * Replaces an asset's document, keeping its id, name, type and position.
   *
   * The store deliberately has no palette setter and forbids dimension changes
   * — a document's size and palette are invariants, not fields. Operations that
   * genuinely change them (recolour, resize, rotate) therefore rebuild the
   * document rather than mutating it.
   *
   * The cost is that undo history does not survive, which is why this is never
   * used for anything a pixel mutation could express. Callers should say so.
   */
  #replace(id: string, document: PixelDocument): boolean {
    const entry = this.#assets.get(id);
    if (entry === undefined) {
      return false;
    }

    const nextGeneration = entry.generation + 1;
    entry.unwatch();
    this.#assets.delete(id);
    this.#insert(id, createStore(document), entry.type, entry.name, entry.order, nextGeneration);
    this.#persist(id);
    this.#bump();
    return true;
  }

  /** Remaps every layer into a new palette using perceptual Oklab distance. */
  recolor(id: string, colors: readonly string[]): boolean {
    const entry = this.#assets.get(id);
    if (entry === undefined) {
      return false;
    }

    const snapshot = entry.store.snapshot();
    const palette = createPalette({ colors });
    const lookup = snapshot.palette.colors.map((color) => nearestIndex(palette, color.hex));
    const frames = snapshot.frames.map((frame) => ({
      ...frame,
      layers: frame.layers.map((layer) => {
        const cells = new Int8Array(layer.grid.cells.length);
        for (let index = 0; index < cells.length; index += 1) {
          const source = layer.grid.cells[index] as number;
          cells[index] = source === TRANSPARENT ? TRANSPARENT : (lookup[source] as number);
        }
        return { ...layer, grid: { ...layer.grid, cells } };
      }),
    }));
    return this.#replace(id, createDocument({ ...snapshot, palette, frames }));
  }

  /** Replaces one palette entry without remapping indices. Rebuilds the store because palettes are immutable. */
  setPaletteColor(id: string, index: number, hex: string): boolean {
    const entry = this.#assets.get(id);
    if (entry === undefined) return false;
    const snapshot = entry.store.snapshot();
    if (!Number.isInteger(index) || index < 0 || index >= snapshot.palette.colors.length) {
      throw new Error(`Palette index ${String(index)} is outside 0-${String(snapshot.palette.colors.length - 1)}.`);
    }
    const colors = snapshot.palette.colors.map((color) => color.hex);
    colors[index] = hex;
    return this.#replace(id, createDocument({ ...snapshot, palette: createPalette({ colors }) }));
  }

  /** Rebuilds every frame through `transform`, which may change dimensions. */
  reshape(
    id: string,
    transform: (frames: readonly Grid[]) => { width: number; height: number; frames: Grid[] }
  ): boolean {
    const entry = this.#assets.get(id);
    if (entry === undefined) {
      return false;
    }

    const snapshot = entry.store.snapshot();
    const source = snapshot.frames.map((_, index) => entry.store.readComposite(index));
    const { width, height, frames } = transform(source);

    return this.#replace(
      id,
      createDocument({
        id,
        name: snapshot.name,
        width,
        height,
        palette: snapshot.palette,
        frames: frames.map((grid) =>
          createFrame(width, height, { layers: [createLayer(width, height, { grid })] })
        ),
      })
    );
  }

  /** Rebuilds one asset against a project style in a single deterministic replacement. */
  conformStyle(
    id: string,
    style: StyleProfile,
    type: AssetType,
  ): { changed: number; resized: boolean } | null {
    const entry = this.#assets.get(id);
    if (entry === undefined) return null;

    const snapshot = entry.store.snapshot();
    const results = snapshot.frames.map((_, frame) =>
      conformToStyle(entry.store.readComposite(frame), style, type, snapshot.palette),
    );
    const first = results[0];
    if (first === undefined) return null;
    const changed = results.reduce((total, result) => total + result.changed, 0);
    const paletteChanged =
      snapshot.palette.colors.map((colour) => colour.hex).join() !==
      style.palette.colors.map((colour) => colour.hex).join();
    if (!first.resized && !paletteChanged && changed === 0) {
      return { changed: 0, resized: false };
    }

    this.#replace(
      id,
      createDocument({
        id,
        name: snapshot.name,
        width: first.grid.width,
        height: first.grid.height,
        palette: style.palette,
        frames: results.map(({ grid }, frame) =>
          createFrame(grid.width, grid.height, {
            durationMs: snapshot.frames[frame]?.durationMs,
            layers: [createLayer(grid.width, grid.height, { grid })],
          }),
        ),
      }),
    );
    return { changed, resized: first.resized };
  }

  /**
   * Hydrates from IndexedDB.
   *
   * Returns the same in-flight promise on every call rather than a resolved one
   * — React Strict Mode invokes effects twice in development, and a second call
   * that returned early would let the caller observe an empty session while the
   * first load was still running. The caller seeds when the library is empty, so
   * that raced into re-seeding deleted assets back to life under their original
   * ids.
   */
  hydrate(): Promise<void> {
    this.#hydration ??= this.#load();
    return this.#hydration;
  }

  async #load(): Promise<void> {
    if (await assetStorage.open()) {
      for (const record of await assetStorage.loadAll()) {
        if (this.#assets.has(record.id)) {
          continue;
        }
        try {
          this.#insert(
            record.id,
            createStore(deserializeDocument(record.document)),
            record.type,
            record.name,
            record.order
          );
        } catch {
          // A record written by an older format. Skip it rather than refusing
          // to start; the rest of the library still loads.
        }
      }
      this.#activeId ??= this.#assets.keys().next().value ?? null;
    }

    this.#loaded = true;
    this.#bump();
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  #bump(): void {
    this.#revision += 1;
    for (const listener of this.#listeners) {
      listener();
    }
  }
}

/**
 * The one session for the running app.
 *
 * A module singleton rather than React context because the WebMCP tool layer
 * reaches it from outside the render tree — a context would only be readable
 * from inside a component.
 */
export const session = new EditorSession();
