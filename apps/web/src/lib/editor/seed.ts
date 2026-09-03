import { TRANSPARENT, createGrid, type Cell, type Grid } from "@zenith/core";
import { session } from "./session";
import { assetStorage } from "./storage";
import { importLibrary } from "./transfer";

/**
 * Example assets, generated at startup.
 *
 * A cold visitor — a hackathon judge following a link — must see real pixel art
 * immediately, not an empty canvas (docs/requirements.md §6). Persistence lands
 * in phase 05; until then these are regenerated on every load.
 *
 * Both tiles are built to wrap: every pattern is computed modulo the tile size,
 * so `check_seamless_tiling` passes on them out of the box and the failure case
 * has to be created deliberately.
 *
 * Indices refer to the `GENERAL_16` palette in `lib/pixel/presets.ts`:
 * 0-5 neutral ramp dark→light, 6-8 warm, 9-11 cool, 12-14 foliage, 15 accent.
 */

/** Deterministic per-cell hash, so the same tile is produced on every load. */
function hash(x: number, y: number): number {
  const value = Math.sin(x * 127.1 + y * 311.7) * 43_758.545_3;
  return value - Math.floor(value);
}

function set(grid: Grid, x: number, y: number, cell: Cell): void {
  grid.cells[y * grid.width + x] = cell;
}

/**
 * Cobblestone: a 16x8 running-bond brick pattern, offset every other course.
 *
 * 32 divides by both, so the pattern closes on itself at the edges. Each stone
 * gets a top-left highlight and bottom-right shadow — the convention that reads
 * as a light source above-left.
 */
export function cobblestone(): Grid {
  const size = 32;
  const grid = createGrid(size, size, 1);
  const stoneWidth = 16;
  const stoneHeight = 8;

  for (let y = 0; y < size; y += 1) {
    const course = Math.floor(y / stoneHeight);
    const offset = (course % 2) * (stoneWidth / 2);

    for (let x = 0; x < size; x += 1) {
      const shifted = (x + offset) % size;
      const localX = shifted % stoneWidth;
      const localY = y % stoneHeight;

      // Mortar channel on the stone's right and bottom edge.
      if (localX >= stoneWidth - 1 || localY >= stoneHeight - 1) {
        set(grid, x, y, 0);
        continue;
      }

      const stoneX = Math.floor(shifted / stoneWidth);
      const noise = hash(stoneX + course * 7, course);
      const base: Cell = noise > 0.66 ? 3 : noise > 0.33 ? 2 : 3;

      let cell: Cell = base;
      if (localX === 0 || localY === 0) {
        cell = (base + 1) as Cell;
      } else if (localX === stoneWidth - 2 || localY === stoneHeight - 2) {
        cell = (base - 1) as Cell;
      } else if (hash(x * 3, y * 5) > 0.88) {
        cell = (base + 1) as Cell;
      }

      set(grid, x, y, Math.max(1, Math.min(5, cell)) as Cell);
    }
  }

  return grid;
}

/** Grass: a foliage base with scattered blades, wrapped so the edges meet. */
export function grass(): Grid {
  const size = 32;
  const grid = createGrid(size, size, 12);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const noise = hash(x, y);
      let cell: Cell = 12;
      if (noise > 0.82) {
        cell = 14;
      } else if (noise > 0.5) {
        cell = 13;
      }

      // Blades: short vertical strokes, positions wrapped to keep the seam clean.
      if (hash(x * 11, Math.floor(y / 3) * 17) > 0.9) {
        cell = 14;
        if (y + 1 < size) {
          set(grid, x, (y + 1) % size, 13);
        }
      }

      set(grid, x, y, cell);
    }
  }

  return grid;
}

/** A crate: 16x16, transparent background, warm ramp with corner bracing. */
export function crate(): Grid {
  const size = 16;
  const grid = createGrid(size, size, TRANSPARENT);

  for (let y = 1; y < size - 1; y += 1) {
    for (let x = 1; x < size - 1; x += 1) {
      const isEdge = x === 1 || y === 1 || x === size - 2 || y === size - 2;
      const isBrace = Math.abs(x - y) <= 1 || Math.abs(x + y - (size - 1)) <= 1;

      let cell: Cell = 7;
      if (isEdge) {
        cell = 6;
      } else if (isBrace) {
        cell = 8;
      }
      set(grid, x, y, cell);
    }
  }

  // Top edge catches the light, bottom sits in shadow.
  for (let x = 1; x < size - 1; x += 1) {
    set(grid, x, 1, 8);
    set(grid, x, size - 2, 6);
  }

  return grid;
}

export interface SeedAsset {
  readonly name: string;
  readonly type: "tile" | "item";
  readonly preset: string;
  readonly grid: Grid;
}

export const SEED_ASSETS: readonly SeedAsset[] = [
  { name: "Cobblestone", type: "tile", preset: "tile-32", grid: cobblestone() },
  { name: "Grass", type: "tile", preset: "tile-32", grid: grass() },
  { name: "Crate", type: "item", preset: "item-16", grid: crate() },
];

/**
 * The generated character pack, fetched rather than bundled.
 *
 * Forty sprites is 274KB of serialised documents — 63KB over the wire — and
 * putting that in the JS bundle would cost every visit to pay for something
 * only the first one uses. It lives in `public/` and is fetched once, when the
 * library turns out to be empty.
 */
const CHARACTER_PACK = "/seed/characters.json";

/**
 * Remembers that seeding already happened, so an emptied library stays empty.
 *
 * Seeding on `size === 0` alone means deleting every asset brings them all
 * back on the next visit — a nuisance with three examples and unacceptable
 * with forty. The marker is per-browser, which is the same scope as the
 * library itself, and losing it (private window, cleared site data) only
 * re-seeds a library that is empty anyway.
 */
const SEEDED_KEY = "zenith.seeded.v1";

function alreadySeeded(): boolean {
  try {
    // Read the storage out before comparing. `localStorage?.getItem(k) !== null`
    // reads as "no marker" but evaluates to `undefined !== null`, which is true
    // — so anywhere without localStorage would decide it had already seeded and
    // silently never seed at all.
    const storage: Storage | undefined = globalThis.localStorage;
    return storage !== undefined && storage.getItem(SEEDED_KEY) !== null;
  } catch {
    // Storage can throw outright rather than return null — a browser set to
    // block site data, or a sandboxed frame. Treat it as "not seeded".
    return false;
  }
}

function markSeeded(): void {
  try {
    globalThis.localStorage?.setItem(SEEDED_KEY, new Date().toISOString());
  } catch {
    // Nothing to do: the worst case is seeding again on the next empty visit.
  }
}

/**
 * Fills an empty library once, so a cold visitor lands on artwork.
 *
 * Hydration first and always, because seeding a library that has not finished
 * loading is how deleted assets come back to life under their original ids —
 * `session.hydrate` returns its in-flight promise for exactly this reason.
 *
 * The tiles are built in code because they demonstrate seam checking and must
 * tile exactly; the characters are generated art shipped as data. A judge
 * opening the deployed URL sees both without touching anything.
 */
export async function ensureSeeded(): Promise<number> {
  await session.hydrate();
  if (session.size > 0 || alreadySeeded()) return 0;

  for (const asset of SEED_ASSETS) session.create(asset);
  let created = SEED_ASSETS.length;

  try {
    const response = await fetch(CHARACTER_PACK);
    if (response.ok) {
      // Through `importLibrary`, so the pack is read by the same validator a
      // human-supplied bundle is; a malformed pack skips assets rather than
      // leaving the library half-built.
      created += importLibrary(await response.json()).imported;
    }
  } catch {
    // The pack is a nicety, not a requirement. A visitor offline or behind a
    // proxy that eats it still gets the tiles and a working editor.
  }

  // Only remember it if the library can actually keep it. Marking
  // unconditionally means one failed persist — storage blocked, a private
  // window, a delete still pending behind an open connection — leaves an empty
  // library that will never seed again, because the marker outlives the data it
  // was recording. localStorage and IndexedDB fail independently, so the marker
  // surviving proves nothing about the assets.
  await assetStorage.flush();
  if (assetStorage.state === "ready") markSeeded();
  return created;
}
