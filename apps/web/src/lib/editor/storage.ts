import type { SerializedDocument } from "@zenith/core";
import type { AssetType } from "./session";

/**
 * IndexedDB persistence for the asset library.
 *
 * Deliberately not server SQLite: Cloud Run's filesystem is ephemeral and a
 * login wall costs us judges who need to reach a working URL — see
 * `docs/idea.md` §12. Everything here is best-effort. Storage can be missing
 * (SSR), blocked (private browsing), or full (quota), and none of those may lose
 * the user's work silently: the library falls back to memory and says so.
 */

export interface StoredAsset {
  readonly id: string;
  readonly name: string;
  readonly type: AssetType;
  /** Insertion order, so the library renders in a stable sequence. */
  readonly order: number;
  /** Core's serialised form — grids are packed text rows, not JSON arrays. */
  readonly document: SerializedDocument;
}

export type StorageState = "unknown" | "ready" | "saving" | "unavailable";

const DB_NAME = "zenith-studio";
/**
 * v2 adds the project tree. The upgrade is purely additive: it creates a second
 * store and touches nothing in `assets`, so an existing library opens unchanged
 * with every asset loose. Phase 14's exit criteria require exactly that —
 * projects are additive, never a migration.
 */
const DB_VERSION = 2;
const STORE = "assets";
const TREE_STORE = "projects";
/** The single record holding the whole tree. It is small and always read whole. */
const TREE_KEY = "tree";
/** Coalesces a burst of edits into one write. A drag stroke is one revision, but a session is many. */
const FLUSH_DELAY_MS = 600;
/**
 * Ceiling on how long a queued write may wait for an idle moment.
 *
 * Kept well under the debounce plus a page transition: a queued write that is
 * still waiting when the tab goes away is lost work, and `pagehide` cannot wait
 * for an idle callback.
 */
const IDLE_TIMEOUT_MS = 400;
/**
 * How long to wait for IndexedDB to open before giving up on it.
 *
 * `indexedDB.open()` can hang indefinitely rather than erroring — a pending
 * `deleteDatabase`, another tab holding an upgrade, or a browser in a bad state
 * will all leave it unsettled. Without a ceiling the library waits on that
 * promise forever and renders "Loading…" with no way out, which is worse than
 * running from memory and saying so.
 */
const OPEN_TIMEOUT_MS = 3000;

function idleCallback(run: () => void): void {
  if (typeof requestIdleCallback === "function") {
    requestIdleCallback(run, { timeout: IDLE_TIMEOUT_MS });
  } else {
    setTimeout(run, 0);
  }
}

export class AssetStorage {
  #db: IDBDatabase | null = null;
  #state: StorageState = "unknown";
  #reason: string | null = null;
  #listeners = new Set<() => void>();
  #pending = new Map<string, StoredAsset>();
  #inFlight = new Set<Promise<void>>();
  #removals = new Set<string>();
  #timer: ReturnType<typeof setTimeout> | null = null;
  #unloadBound = false;

  get state(): StorageState {
    return this.#state;
  }

  /** Why persistence is unavailable, for the warning the library shows. */
  get reason(): string | null {
    return this.#reason;
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /**
   * Writes anything queued before the page goes away.
   *
   * Without this a delete or edit made in the last second before a navigation
   * is simply lost: the debounce plus idle callback can hold a write for most
   * of a second, and nothing flushes it on unload. `pagehide` is the reliable
   * signal — `beforeunload` does not fire on mobile Safari, and `unload` is not
   * fired at all in modern browsers.
   *
   * The write cannot be awaited here, but starting the transaction is enough:
   * the browser keeps an open IndexedDB transaction alive through the
   * transition in practice.
   */
  #installUnloadFlush(): void {
    if (typeof window === "undefined" || this.#unloadBound) {
      return;
    }
    this.#unloadBound = true;

    const flushNow = () => {
      if (this.#timer !== null) {
        clearTimeout(this.#timer);
        this.#timer = null;
      }
      void this.#write();
    };

    window.addEventListener("pagehide", flushNow);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        flushNow();
      }
    });
  }

  async open(): Promise<boolean> {
    if (this.#db !== null) {
      return true;
    }
    if (typeof indexedDB === "undefined") {
      this.#fail("This browser does not expose IndexedDB.");
      return false;
    }

    try {
      this.#db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        let timedOut = false;

        const timer = setTimeout(() => {
          timedOut = true;
          reject(new Error("IndexedDB did not respond."));
        }, OPEN_TIMEOUT_MS);

        const settle = (run: () => void) => {
          clearTimeout(timer);
          run();
        };

        request.onupgradeneeded = () => {
          const db = request.result;
          // Both guarded by `contains`, so this runs correctly from no database
          // at all, from v1, and from a v2 that somehow lost a store.
          if (!db.objectStoreNames.contains(STORE)) {
            db.createObjectStore(STORE, { keyPath: "id" });
          }
          if (!db.objectStoreNames.contains(TREE_STORE)) {
            db.createObjectStore(TREE_STORE);
          }
        };
        request.onsuccess = () =>
          settle(() => {
            // A request that resolves after the timeout still hands back a live
            // connection. Abandoning it leaks a handle that blocks every future
            // `deleteDatabase` and upgrade — permanently, since nothing else
            // holds a reference to close it.
            if (timedOut) {
              request.result.close();
              return;
            }
            resolve(request.result);
          });
        request.onerror = () =>
          settle(() => reject(request.error ?? new Error("IndexedDB refused to open.")));
        request.onblocked = () =>
          settle(() => reject(new Error("IndexedDB is blocked by another tab.")));
      });
      this.#installUnloadFlush();
      this.#set("ready");
      return true;
    } catch (error) {
      // Private browsing in some browsers rejects open() outright.
      this.#fail(error instanceof Error ? error.message : "IndexedDB could not be opened.");
      return false;
    }
  }

  async loadAll(): Promise<StoredAsset[]> {
    if (this.#db === null) {
      return [];
    }
    try {
      const records = await this.#run<StoredAsset[]>("readonly", (store) => store.getAll());
      return [...records].sort((a, b) => a.order - b.order);
    } catch (error) {
      this.#fail(error instanceof Error ? error.message : "Could not read stored assets.");
      return [];
    }
  }

  /**
   * Reads the project tree.
   *
   * One record rather than a store per entity: the whole tree is a few hundred
   * bytes, it is always read whole, and a partial tree is not a useful state to
   * be able to represent. Returns null on a v1 database that has no tree yet,
   * which is the normal case for every existing browser.
   */
  async loadTree(): Promise<unknown> {
    if (this.#db === null) return null;
    try {
      return await this.#runOn<unknown>(TREE_STORE, "readonly", (store) => store.get(TREE_KEY));
    } catch {
      // A missing tree is not a failure worth marking storage unavailable for —
      // assets still load, and every asset simply reads as loose.
      return null;
    }
  }

  /**
   * Writes the tree immediately rather than through the debounce.
   *
   * Structural edits are rare and deliberate — creating a folder, dragging an
   * asset — where a pixel stroke is neither. Coalescing them would risk losing
   * the one kind of change a user expects to stick the moment they make it.
   */
  async saveTree(snapshot: unknown): Promise<void> {
    if (this.#db === null || this.#state === "unavailable") return;
    try {
      await this.#track(this.#runOn<void>(TREE_STORE, "readwrite", (store) => {
        store.put(snapshot, TREE_KEY);
      }));
    } catch (error) {
      this.#fail(error instanceof Error ? error.message : "Could not save the project tree.");
    }
  }

  /** Queues a write. Repeated calls for the same id collapse to the latest value. */
  save(asset: StoredAsset): void {
    if (this.#state === "unavailable") {
      return;
    }
    this.#removals.delete(asset.id);
    this.#pending.set(asset.id, asset);
    this.#schedule();
  }

  remove(id: string): void {
    if (this.#state === "unavailable") {
      return;
    }
    this.#pending.delete(id);
    this.#removals.add(id);
    this.#schedule();
  }

  /** Writes everything queued immediately. Used by tests and before export. */
  async flush(): Promise<void> {
    if (this.#timer !== null) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
    await this.#write();
    // A previous write may have drained the queue but not committed yet.
    while (this.#inFlight.size > 0) await Promise.all([...this.#inFlight]);
  }

  #schedule(): void {
    if (this.#timer !== null) {
      return;
    }
    this.#set("saving");
    this.#timer = setTimeout(() => {
      this.#timer = null;
      idleCallback(() => {
        void this.#write();
      });
    }, FLUSH_DELAY_MS);
  }

  #write(): Promise<void> {
    if (this.#db === null || (this.#pending.size === 0 && this.#removals.size === 0)) return Promise.resolve();
    return this.#track(this.#writePending());
  }

  #track(write: Promise<void>): Promise<void> {
    this.#set("saving");
    const operation = write.finally(() => {
      this.#inFlight.delete(operation);
      if (this.#db !== null && this.#state !== "unavailable" && this.#inFlight.size === 0 && this.#pending.size === 0 && this.#removals.size === 0) {
        this.#set("ready");
      }
    });
    this.#inFlight.add(operation);
    return operation;
  }

  async #writePending(): Promise<void> {
    if (this.#db === null || (this.#pending.size === 0 && this.#removals.size === 0)) {
      return;
    }

    const writes = [...this.#pending.values()];
    const deletes = [...this.#removals];
    this.#pending.clear();
    this.#removals.clear();

    try {
      await this.#run<void>("readwrite", (store) => {
        for (const asset of writes) {
          store.put(asset);
        }
        for (const id of deletes) {
          store.delete(id);
        }
        return store.count();
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.#fail(
        /quota/i.test(message)
          ? "Storage is full, so changes are no longer being saved."
          : `Changes could not be saved: ${message}`
      );
    }
  }

  #run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest | void): Promise<T> {
    return this.#runOn<T>(STORE, mode, work);
  }

  /**
   * The same transaction wrapper, over any store.
   *
   * Resolution waits on `oncomplete`, not on the request, so a write is only
   * reported saved once the transaction has actually committed.
   */
  #runOn<T>(
    storeName: string,
    mode: IDBTransactionMode,
    work: (store: IDBObjectStore) => IDBRequest | void
  ): Promise<T> {
    const db = this.#db;
    if (db === null) {
      return Promise.reject(new Error("IndexedDB is not open."));
    }
    if (!db.objectStoreNames.contains(storeName)) {
      return Promise.reject(new Error(`This database has no '${storeName}' store.`));
    }

    return new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(storeName, mode);
      const request = work(transaction.objectStore(storeName));
      transaction.onerror = () => reject(transaction.error ?? new Error("Transaction failed."));
      transaction.onabort = () => reject(transaction.error ?? new Error("Transaction aborted."));
      transaction.oncomplete = () => resolve((request?.result ?? undefined) as T);
    });
  }

  #set(state: StorageState): void {
    if (this.#state === state) {
      return;
    }
    this.#state = state;
    this.#notify();
  }

  #fail(reason: string): void {
    this.#reason = reason;
    this.#db = null;
    this.#pending.clear();
    this.#removals.clear();
    this.#set("unavailable");
  }

  #notify(): void {
    for (const listener of this.#listeners) {
      listener();
    }
  }
}

export const assetStorage = new AssetStorage();
