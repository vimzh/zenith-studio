import { describe, expect, test } from "bun:test";
import {
  EMPTY_SCOPE,
  TOOLS,
  scopeApplies,
  scopeStatus,
  scopeKey,
  toolsForContext,
  type ScopeContext,
} from "./index";

function context(overrides: Partial<ScopeContext> = {}): ScopeContext {
  return {
    assetId: "asset_001",
    assetType: "tile",
    frameCount: 1,
    ...overrides,
  };
}

describe("scopeApplies", () => {
  test("always-scoped tools survive an empty library", () => {
    expect(scopeApplies("always", EMPTY_SCOPE)).toBe(true);
  });

  test("everything else needs an open asset", () => {
    for (const scope of ["editor", "animation", "character", "tile"] as const) {
      expect(scopeApplies(scope, EMPTY_SCOPE)).toBe(false);
    }
  });

  test("animation waits for a second frame", () => {
    expect(scopeApplies("animation", context({ frameCount: 1 }))).toBe(false);
    expect(scopeApplies("animation", context({ frameCount: 2 }))).toBe(true);
  });

  test("character tools are character-only", () => {
    expect(scopeApplies("character", context({ assetType: "character" }))).toBe(
      true,
    );
    expect(scopeApplies("character", context({ assetType: "tile" }))).toBe(
      false,
    );
  });

  test("textures get tile capabilities, characters do not", () => {
    expect(scopeApplies("tile", context({ assetType: "tile" }))).toBe(true);
    expect(scopeApplies("tile", context({ assetType: "texture" }))).toBe(true);
    expect(scopeApplies("tile", context({ assetType: "character" }))).toBe(
      false,
    );
    expect(scopeApplies("tile", context({ assetType: "item" }))).toBe(false);
  });
});

describe("scopeKey", () => {
  test("changes only when scoping could differ", () => {
    expect(scopeKey(context())).toBe(scopeKey(context()));
    expect(scopeKey(context())).not.toBe(scopeKey(context({ frameCount: 2 })));
    expect(scopeKey(context())).not.toBe(
      scopeKey(context({ assetType: "character" })),
    );
    expect(scopeKey(context())).not.toBe(
      scopeKey(context({ assetId: "asset_002" })),
    );
  });
});

/** Phase 05's criterion: the registered count changes between library and editor. */
describe("toolsForContext", () => {
  /**
   * A property, not a list: the library screen offers exactly the tools that
   * declare they need no open asset. Naming them individually meant every new
   * always-scoped tool failed a test that had nothing wrong with it.
   */
  test("the library screen offers exactly the tools that need no open asset", () => {
    const offered = new Set(
      toolsForContext(EMPTY_SCOPE).map((tool) => tool.name),
    );
    const expected = new Set(
      TOOLS.filter((tool) => tool.scope === "always").map((tool) => tool.name),
    );
    expect(offered).toEqual(expected);
    // Making a first asset must be reachable with nothing open, or the library
    // is a dead end for an agent.
    expect(offered.has("create_asset")).toBe(true);
    expect(offered.has("list_assets")).toBe(true);
  });

  test("opening an asset offers strictly more", () => {
    const library = toolsForContext(EMPTY_SCOPE).length;
    const editor = toolsForContext(context()).length;
    expect(editor).toBeGreaterThan(library);
  });

  test("a tile is not offered character tools, and vice versa", () => {
    const tile = toolsForContext(context({ assetType: "tile" })).map(
      (tool) => tool.name,
    );
    const character = toolsForContext(context({ assetType: "character" })).map(
      (tool) => tool.name,
    );

    expect(tile).toContain("check_seamless_tiling");
    expect(tile).toContain("derive_variant");
    expect(tile).toContain("inpaint_region");
    expect(tile).toContain("generate_variation_set");
    expect(character).not.toContain("check_seamless_tiling");
    expect(character).toContain("derive_variant");
    expect(character).toContain("inpaint_region");
    expect(character).toContain("generate_variation_set");
  });

  /**
   * A tool offered where it cannot work is worse than a missing one: two of
   * these are paid calls. `rotate_character` was offered on a tile, which is a
   * model call to turn a cobblestone around; `assemble_map` needs a 47-tile
   * sheet and was offered everywhere *except* on one, because a sheet is typed
   * `tileset` and nothing scoped to it.
   */
  test("facing belongs to characters, and map assembly to tile sheets", () => {
    const tile = toolsForContext(context({ assetType: "tile" })).map((tool) => tool.name);
    const character = toolsForContext(context({ assetType: "character" })).map((tool) => tool.name);
    const sheet = toolsForContext(context({ assetType: "tileset" })).map((tool) => tool.name);

    for (const name of [
      "get_directions",
      "select_direction",
      "derive_direction_by_mirror",
      "rotate_character",
      "generate_direction_set",
    ]) {
      expect({ name, character: character.includes(name), tile: tile.includes(name) }).toEqual({
        name,
        character: true,
        tile: false,
      });
    }

    expect(sheet).toContain("assemble_map");
    expect(tile).not.toContain("assemble_map");
    expect(character).not.toContain("assemble_map");
    // The map a sheet produces is a tile, and that is what grows.
    expect(tile).toContain("extend_map");
    expect(character).not.toContain("extend_map");
    // A sheet is not a tile: deriving another sheet from one is not a call.
    expect(sheet).not.toContain("generate_tileset");
  });

  test("every tool is reachable from some context", () => {
    const reachable = new Set(
      [
        EMPTY_SCOPE,
        context({ assetType: "tile", frameCount: 4 }),
        context({ assetType: "character", frameCount: 4 }),
        context({ assetType: "tileset", frameCount: 4 }),
        context({ assetType: "item", frameCount: 4 }),
      ].flatMap((each) => toolsForContext(each).map((tool) => tool.name)),
    );
    expect(
      [...TOOLS]
        .map((tool) => tool.name)
        .filter((name) => !reachable.has(name)),
    ).toEqual([]);
  });

  test("preserves registry order, so registration is stable", () => {
    const names = toolsForContext(context()).map((tool) => tool.name);
    const expected = TOOLS.filter((tool) => names.includes(tool.name)).map(
      (tool) => tool.name,
    );
    expect(names).toEqual(expected);
  });
});

/**
 * An empty scope has three causes and they are not interchangeable.
 *
 * Reporting a route/session disagreement as "no asset is open" is the message
 * that is definitely wrong, and it is the one that cost a debugging session:
 * the surface correctly went quiet, and the console announced an empty library
 * while an asset sat on screen.
 */
describe("scopeStatus", () => {
  test("is ready when the route and session agree on an existing asset", () => {
    expect(scopeStatus("asset_001", "asset_001", true)).toBe("ready");
  });

  test("is library, not empty, when there is no editor route", () => {
    expect(scopeStatus(null, null, false)).toBe("library");
    // Even with an asset active — the human is browsing, not editing.
    expect(scopeStatus(null, "asset_001", true)).toBe("library");
  });

  test("names a route/session disagreement as divergence", () => {
    expect(scopeStatus("asset_001", "asset_004", true)).toBe("diverged");
    expect(scopeStatus("asset_001", null, false)).toBe("diverged");
  });

  test("distinguishes a missing asset from a disagreement", () => {
    expect(scopeStatus("asset_001", "asset_001", false)).toBe("missing");
  });

  test("every cause is distinguishable from every other", () => {
    const causes = [
      scopeStatus("asset_001", "asset_001", true),
      scopeStatus(null, null, false),
      scopeStatus("asset_001", "asset_004", true),
      scopeStatus("asset_001", "asset_001", false),
    ];
    expect(new Set(causes).size).toBe(causes.length);
  });
});
