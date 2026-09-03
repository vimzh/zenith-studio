import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ensureSeeded } from "./seed";
import { session } from "./session";
import { assetStorage } from "./storage";

/**
 * A cold visitor must land on artwork, and a deliberate clean-out must stay clean.
 *
 * Both halves have bitten this codebase already. Seeding lived only in the flat
 * library — a screen reachable by query string — so the front door greeted a
 * first visit with "No projects yet" and nothing to look at. And seeding on an
 * empty library alone means deleting everything brings it all back next visit,
 * which is a nuisance at three examples and unacceptable at forty.
 */

const KEY = "zenith.seeded.v1";

// Bun's runtime has no localStorage. The production guards tolerate that, but a
// test that skipped the marker would never exercise the case the marker exists
// for, so this stands one in.
const store = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
  } as unknown as Storage,
});

/**
 * Pretends persistence is working, for the tests that are about the marker.
 *
 * `state` is a class getter, so an own property on the singleton shadows it
 * and is removed afterwards. Without this every marker test would run in a
 * runtime with no IndexedDB, where declining to mark is the correct behaviour
 * and the marker is never set.
 */
async function withStorageReady<T>(run: () => Promise<T>): Promise<T> {
  Object.defineProperty(assetStorage, "state", { configurable: true, get: () => "ready" });
  try {
    return await run();
  } finally {
    delete (assetStorage as unknown as Record<string, unknown>)["state"];
  }
}

function reset(): void {
  for (const asset of session.list()) session.close(asset.id);
  localStorage.removeItem(KEY);
}

beforeEach(reset);
afterEach(reset);

describe("ensureSeeded", () => {
  test("fills an empty library and records that it did", async () => {
    expect(session.size).toBe(0);
    const created = await withStorageReady(() => ensureSeeded());

    // The tiles are built in code and always land; the character pack is
    // fetched, so it may be absent in a runtime without the static file.
    expect(created).toBeGreaterThanOrEqual(3);
    expect(session.size).toBe(created);
    expect(localStorage.getItem(KEY)).not.toBeNull();

    const names = session.list().map((asset) => asset.name);
    expect(names).toContain("Cobblestone");
  });

  test("does nothing on a second call, so examples are not duplicated", async () => {
    await withStorageReady(async () => {
      await ensureSeeded();
      const after = session.size;

      expect(await ensureSeeded()).toBe(0);
      expect(session.size).toBe(after);
    });
  });

  /**
   * The marker must not outlive the data it records.
   *
   * Marking unconditionally means one failed persist leaves an empty library
   * that never seeds again — localStorage and IndexedDB fail independently, so
   * a surviving marker proves nothing about the assets. In this runtime there
   * is no IndexedDB at all, so storage never reaches "ready" and the marker
   * must stay unset.
   */
  test("does not record a seed the storage layer could not keep", async () => {
    await ensureSeeded();
    expect(session.size).toBeGreaterThanOrEqual(3);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  /**
   * The inversion this file caught on its first run.
   *
   * `localStorage?.getItem(k) !== null` reads as "no marker" and evaluates to
   * `undefined !== null` where storage is absent — true — so a runtime without
   * localStorage decided it had already seeded and shipped an empty library.
   * The stub above hides that, so this test removes storage entirely.
   */
  test("seeds even where localStorage does not exist", async () => {
    const saved = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: undefined });
    try {
      expect(await ensureSeeded()).toBeGreaterThanOrEqual(3);
      expect(session.size).toBeGreaterThanOrEqual(3);
    } finally {
      if (saved !== undefined) Object.defineProperty(globalThis, "localStorage", saved);
    }
  });

  /** The trap the marker exists for: an emptied library must stay empty. */
  test("does not refill a library the human deliberately emptied", async () => {
    await withStorageReady(async () => {
      await ensureSeeded();
      for (const asset of session.list()) session.close(asset.id);
      expect(session.size).toBe(0);

      expect(await ensureSeeded()).toBe(0);
      expect(session.size).toBe(0);
    });
  });
});
