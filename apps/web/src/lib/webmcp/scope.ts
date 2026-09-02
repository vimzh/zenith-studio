/**
 * Which tools an agent can see, given what is open.
 *
 * A flat list of every tool measurably degrades an agent's choice of which to
 * call — `AGENTS.md` says so, and the full catalogue is past forty. Registering
 * only what the current view can act on keeps the list legible and makes wrong
 * calls impossible rather than merely unlikely: a character has no tileset, so
 * an agent editing one should not be offered `assemble_map`.
 *
 * This is also phase 05's "registered tool count changes between library and
 * editor" criterion.
 */

/** Where a tool is usable. Defaults to `editor` — most tools need an open asset. */
export type ToolScope =
  /** Always available, including on the library screen with nothing open. */
  | "always"
  /** Needs an open asset. */
  | "editor"
  /** Needs an open asset with more than one frame. */
  | "animation"
  /** Characters only — directions and skeletons. */
  | "character"
  /** Tiles and textures only — seam checking and tileset derivation. */
  | "tile"
  /**
   * Derived 47-tile sheets only — map assembly.
   *
   * Separate from `tile` because the two are opposites: `generate_tileset`
   * turns one tile into a sheet, `assemble_map` turns a sheet into a map, and
   * offering either on the other's input is offering a call that cannot work.
   * A sheet is its own asset type for exactly this reason.
   */
  | "tileset";

export interface ScopeContext {
  readonly assetId: string | null;
  readonly assetType: string | null;
  readonly frameCount: number;
}

export const EMPTY_SCOPE: ScopeContext = Object.freeze({
  assetId: null,
  assetType: null,
  frameCount: 0,
});

/** Types that get tile capabilities. A texture tiles for the same reasons a tile does. */
const TILE_TYPES = new Set(["tile", "texture"]);

export function scopeApplies(scope: ToolScope, context: ScopeContext): boolean {
  if (scope === "always") return true;
  if (context.assetId === null) return false;

  switch (scope) {
    case "editor":
      return true;
    case "animation":
      // More than one frame, because diffing or summarising a single frame
      // tells an agent nothing it could not get from read_canvas.
      return context.frameCount > 1;
    case "character":
      return context.assetType === "character";
    case "tile":
      return context.assetType !== null && TILE_TYPES.has(context.assetType);
    case "tileset":
      return context.assetType === "tileset";
  }
}

/** A stable key for the context, so a snapshot only changes when scoping would. */
export function scopeKey(context: ScopeContext): string {
  return `${context.assetId ?? "-"}|${context.assetType ?? "-"}|${String(context.frameCount)}`;
}

/**
 * Why the tool surface is in the state it is in.
 *
 * An empty scope has three quite different causes, and reporting all of them as
 * "no asset is open" tells the user the one thing that is not true. That cost a
 * real debugging session: a by-product asset moved `activeId`, the route stayed
 * put, the surface correctly went quiet, and the console announced an empty
 * library while an asset sat on screen.
 */
export type ScopeStatus =
  /** An asset is open and the route agrees. Tools are available. */
  | "ready"
  /** Not on an editor route — the library or settings. Nothing to edit, correctly. */
  | "library"
  /** The route and the session disagree about which asset is open. A bug, not a state. */
  | "diverged"
  /** On an editor route, but the asset is gone. */
  | "missing";

export function scopeStatus(
  routeAssetId: string | null,
  activeId: string | null,
  hasStore: boolean,
): ScopeStatus {
  if (routeAssetId === null) return "library";
  if (activeId !== routeAssetId) return "diverged";
  if (!hasStore) return "missing";
  return "ready";
}
