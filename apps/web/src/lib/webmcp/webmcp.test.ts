import { beforeEach, describe, expect, test } from "bun:test";
import { projects, session } from "@/lib/editor";
import * as contextTools from "./tools/context";
import * as editingTools from "./tools/editing";
import * as framesTools from "./tools/frames";
import * as animationTools from "./tools/animation";
import * as projectTools from "./tools/projects";
import * as generationTools from "./tools/generation";
import * as perceptionTools from "./tools/perception";
import * as viewportTools from "./tools/viewport";
import * as historyTools from "./tools/history";
import * as validationTools from "./tools/validation";
import * as inpaintTools from "./tools/inpaint";
import * as exportTools from "./tools/export";
import * as projectIoTools from "./tools/project-io";
import { listExportFiles, releaseExportFile, retainExportFiles } from "./artifacts";
import {
  TOOLS,
  TOOL_GROUPS,
  assetRouteId,
  findTool,
  assetNavigation,
  routeForRequestedAsset,
  runTool,
  toolsForContext,
  transcript,
} from "./index";
import type { ToolArgs, ToolDefinition } from "./types";

/**
 * Phase 03 exit criteria, exercised through the same path both front doors use.
 *
 * Every assertion here runs `runTool`, which is what `document.modelContext`
 * calls and what the Agent Console's Run button calls. Testing the definitions
 * directly would prove less: the point is that there is only one path.
 */

async function call(name: string, args: ToolArgs = {}): Promise<string> {
  const definition = findTool(name);
  if (definition === undefined) throw new Error(`No tool '${name}'`);
  const outcome = await runTool(definition, args, "console");
  if (!outcome.ok) throw new Error(outcome.text);
  return outcome.text;
}

/** Runs a tool expecting failure, and returns the message the agent would receive. */
async function callExpectingError(
  name: string,
  args: ToolArgs = {},
): Promise<string> {
  const definition = findTool(name);
  if (definition === undefined) throw new Error(`No tool '${name}'`);
  const outcome = await runTool(definition, args, "console");
  expect(outcome.ok).toBe(false);
  return outcome.text;
}

function resetSession(): void {
  for (const file of listExportFiles()) releaseExportFile(file.artifact_id);
  for (const asset of session.list()) session.close(asset.id);
  transcript.clear();
  assetNavigation.clear();
}

beforeEach(resetSession);

/**
 * Properties, not an inventory.
 *
 * This suite used to assert the exact list of tool names. Every new tool broke
 * three assertions that had nothing wrong with them, and the noise buried two
 * real defects — a tool whose description named neither the coordinate origin
 * nor the frame it acts on, and examples that could never validate. An
 * inventory test fails loudest exactly when it matters least.
 *
 * So: the properties every tool must hold are asserted for all of them, and a
 * separate small test pins only the handful of names that are load-bearing
 * elsewhere and must never silently change.
 */
describe("the tool surface", () => {
  test("every tool has a unique name", () => {
    const names = TOOLS.map((tool) => tool.name);
    const duplicates = names.filter(
      (name, index) => names.indexOf(name) !== index,
    );
    expect(duplicates).toEqual([]);
  });

  test("every tool has an object schema whose required fields exist", () => {
    for (const tool of TOOLS) {
      expect({ tool: tool.name, type: tool.inputSchema.type }).toEqual({
        tool: tool.name,
        type: "object",
      });
      for (const required of tool.inputSchema.required ?? []) {
        expect({
          tool: tool.name,
          required,
          declared: Object.keys(tool.inputSchema.properties),
        }).toEqual({
          tool: tool.name,
          required,
          declared: expect.arrayContaining([required]) as unknown as string[],
        });
      }
    }
  });

  /**
   * A description is the agent's entire understanding of a tool. `tools.md`
   * Part 5 requires it to name the page state it acts on and the valid range of
   * every argument, which does not fit in a sentence.
   */
  test("every description is substantial enough to name its page state", () => {
    const thin = TOOLS.filter((tool) => tool.description.length <= 80).map(
      (tool) => `${tool.name} (${String(tool.description.length)} chars)`,
    );
    expect(thin).toEqual([]);
  });

  /** The likeliest source of subtle agent errors, per the phase 03 risk table. */
  test("every positional tool states the coordinate origin", () => {
    const positional = TOOLS.filter((tool) =>
      ["x", "y", "region"].some((key) => key in tool.inputSchema.properties),
    );
    expect(positional.length).toBeGreaterThan(5);

    const silent = positional
      .filter((tool) => !/top-left/.test(tool.description))
      .map((tool) => tool.name);
    expect(silent).toEqual([]);
  });

  /**
   * Asserted by running them, not by pattern-matching their names.
   *
   * The previous version tested a regex over tool names against `readOnly`,
   * which said nothing about behaviour and produced false positives the moment
   * a name did not fit the pattern. `readOnlyHint` is a promise to the agent
   * that a call is safe to make; the only honest way to check it is to make one.
   */
  test("a tool marked read-only does not change the document", async () => {
    const offenders: string[] = [];

    for (const tool of TOOLS) {
      if (tool.readOnly !== true) continue;
      // Declared, not inferred — this test had only the name check, so a
      // read-only tool that calls a model would have spent money here.
      if (tool.network === true) continue;
      if (/^(export_|get_viewport)/.test(tool.name)) continue; // need a canvas or the editor

      resetSession();
      for (const project of projects.listProjects()) projects.deleteProject(project.id);
      const projectId = projects.createProject("readonly-fixture-project");
      const id = session.create({
        name: "readonly-fixture",
        type: "tile",
        preset: "tile-32",
      });
      const store = session.active;
      projects.place(id, projectId);
      store?.addFrame();
      store?.fillRegion({ x: 2, y: 2, width: 12, height: 12 }, 4);
      store?.fillRegion({ x: 6, y: 6, width: 4, height: 4 }, 9, { frame: 1 });

      const before = [0, 1].map((frame) => store?.encode(frame)).join("|");
      const example = tool.example ?? {};
      const args: Record<string, unknown> = { ...example };
      if ("asset_id" in args) args["asset_id"] = id;
      if ("project_id" in args) args["project_id"] = projects.activeProjectId;
      await runTool(tool as ToolDefinition, args, "console");
      const after = [0, 1].map((frame) => store?.encode(frame)).join("|");

      if (before !== after) offenders.push(tool.name);
    }

    expect(offenders).toEqual([]);
  });

  /**
   * Catches a tool that was written but never registered.
   *
   * "Groups every tool exactly once" cannot: `TOOLS` is derived from
   * `TOOL_GROUPS`, so a definition missing from the registry is missing from
   * both and the comparison passes. That is not hypothetical — eight project
   * tools were written, imported, and left out of `TOOL_GROUPS` by a failed
   * edit, and every test stayed green because nothing looked at the modules
   * themselves.
   */
  test("every exported tool definition is registered", () => {
    const registered = new Set(TOOLS.map((tool) => tool.name));
    const unregistered: string[] = [];

    for (const [moduleName, module] of Object.entries(TOOL_MODULES)) {
      for (const [exportName, value] of Object.entries(module)) {
        if (!isToolDefinition(value)) continue;
        if (!registered.has(value.name)) {
          unregistered.push(`${moduleName}.${exportName} ("${value.name}")`);
        }
      }
    }
    expect(unregistered).toEqual([]);
  });

  test("groups every tool exactly once", () => {
    const grouped = TOOL_GROUPS.flatMap((group) => group.tools);
    expect(grouped).toHaveLength(TOOLS.length);
    expect(new Set(grouped)).toEqual(new Set(TOOLS));
  });

  /**
   * The names other code depends on by string. Everything else may come and go;
   * changing one of these breaks the chat allowlist, the scope rules or a test
   * elsewhere, so it should be a deliberate edit here.
   */
  test("pins the load-bearing names", () => {
    for (const name of [
      "list_assets",
      "create_asset",
      "open_asset",
      "read_canvas",
      "get_palette",
      "write_region",
      "set_pixels",
      "fill_region",
      "bucket_fill",
      "replace_color",
      "derive_variant",
      "inpaint_region",
      "generate_variation_set",
      "undo",
      "redo",
      "check_seamless_tiling",
      "export_png",
      "get_viewport",
      "focus_viewport",
      "read_frames_diff",
      "generate_asset",
      "list_projects",
      "create_project",
      "open_project",
      "get_style_profile",
      "set_style_profile",
      "add_style_reference",
      "check_style_consistency",
      "conform_to_style",
      "draw_from_prompt",
      "export_project",
      "start_tool_job",
      "get_tool_job",
      "list_exports",
      "read_export",
      "release_export",
      "import_project",
      "get_storage_status",
      "flush_storage",
    ]) {
      expect({ name, present: findTool(name) !== undefined }).toEqual({
        name,
        present: true,
      });
    }
  });

  /**
   * Each example runs against a fresh two-frame asset.
   *
   * Order-independence matters: the examples mutate state, and a shared fixture
   * made this assert "valid in this sequence" rather than "valid".
   */
  test("every example validates against its own tool", async () => {
    for (const tool of TOOLS) {
      // A paid tool declares itself, so this needs no maintenance when one is
      // added. Without it a new generative tool runs its example against the
      // real image model and buys an image every time the suite runs.
      if (tool.network === true) continue;

      // The rest need a browser canvas or the editor wired to the viewport
      // channel — neither of which a fixture can stand in for, and neither of
      // which the `network` flag describes.
      if (
        /^(export_|flush_storage|get_tool_job|generate_asset|generate_variation_set|generate_texture|generate_isometric_tile|generate_direction_set|rotate_character|select_direction|derive_variant|pixelize|get_viewport|focus_viewport|import_image|build_character_from_reference|assemble_map)/.test(
          tool.name,
        )
      )
        continue;

      // A different reason, worth separating: these three are *correct* to fail
      // in a fresh fixture. undo_delete has nothing to restore until something
      // is deleted, delete_folder names a folder that does not exist yet, and
      // delete_project would remove the fixture the remaining examples run
      // against. Their refusals are asserted directly in project-tools.test.ts,
      // where the state they need can be built first.
      if (/^(undo_delete|delete_folder|delete_project)$/.test(tool.name)) continue;

      resetSession();
      // Projects are a second singleton and leak across the loop exactly as the
      // session used to: create_project's own example runs earlier in registry
      // order, so without this the project tools passed on state borrowed from
      // it rather than on a fixture of their own.
      for (const project of projects.listProjects()) projects.deleteProject(project.id);
      const projectId = projects.createProject("example-fixture-project");
      // A folder too, so any tool taking folder_id gets a live one substituted
      // rather than an id that cannot exist in a fresh fixture.
      const folderId = projects.createFolder(projectId, "example-fixture-folder");
      const id = session.create({
        name: "example-fixture",
        type: "tile",
        preset: "tile-32",
      });
      session.active?.fillRegion({ x: 12, y: 8, width: 8, height: 16 }, 1);
      projects.place(id, projectId);
      // Two frames: the smallest fixture every example is valid against,
      // including reorder_frames' [1, 0], which must be a full permutation.
      session.active?.addFrame({ copyFrom: 0 });

      // An example naming an asset or project id means a plausible one for an
      // agent to read, which cannot exist in a fresh fixture — ids increment for
      // the life of the process. Substitute the live ones rather than
      // special-casing each tool, so the next one is covered automatically.
      const example = tool.example ?? {};
      const args: Record<string, unknown> = { ...example };
      if ("asset_id" in args) args["asset_id"] = id;
      if ("project_id" in args) args["project_id"] = projects.activeProjectId;

      if ("folder_id" in args) args["folder_id"] = folderId;
      if ("artifact_id" in args) args["artifact_id"] = retainExportFiles([{ filename: "fixture.txt", blob: new Blob(["example"]) }])[0]?.artifact_id;

      const outcome = await runTool(tool as ToolDefinition, args, "console");
      expect({
        tool: tool.name,
        ok: outcome.ok,
        why: outcome.ok ? "" : outcome.text,
      }).toEqual({
        tool: tool.name,
        ok: true,
        why: "",
      });
    }
  });
});

describe("context tools", () => {
  test("report an empty library rather than failing", async () => {
    expect(await call("list_assets")).toContain("The library is empty");
  });

  test("create_asset opens the new asset and reports its size", async () => {
    const result = await call("create_asset", {
      name: "cobblestone",
      type: "tile",
      preset: "tile-32",
    });
    expect(result).toContain("32x32");
    expect(result).toContain("16-colour palette");
    expect(session.size).toBe(1);
    expect(session.active?.width).toBe(32);
  });

  test("list_assets marks which asset is open and filters", async () => {
    await call("create_asset", { name: "cobblestone", type: "tile" });
    await call("create_asset", {
      name: "hero",
      type: "character",
      preset: "modern-64",
    });

    const all = await call("list_assets");
    expect(all).toContain("cobblestone");
    expect(all).toContain("hero");
    expect(all).toContain("[open]");

    expect(await call("list_assets", { type: "character" })).not.toContain(
      "cobblestone",
    );
    expect(await call("list_assets", { query: "COBBLE" })).toContain(
      "cobblestone",
    );
    expect(await call("list_assets", { query: "nothing" })).toContain(
      "No assets match",
    );
  });

  test("open_asset switches the target of every editing tool", async () => {
    const first = session.create({ name: "one" });
    const second = session.create({ name: "two" });
    expect(session.activeId).toBe(second);

    await call("open_asset", { asset_id: first });
    expect(session.activeId).toBe(first);
  });

  test("open_asset on an unknown id lists the ids that exist", async () => {
    await call("create_asset", { name: "cobblestone" });
    const message = await callExpectingError("open_asset", {
      asset_id: "asset_999",
    });
    expect(message).toContain("No asset 'asset_999'");
    expect(message).toContain("Known ids:");
  });

  test("create_asset rejects an unknown preset and names the valid ones", async () => {
    const message = await callExpectingError("create_asset", {
      name: "x",
      preset: "gb-8",
    });
    expect(message).toContain("tile-32");
  });
});

describe("perception", () => {
  beforeEach(() => {
    session.create({ name: "cobblestone", preset: "gb-4" });
  });

  test("read_canvas returns a header and the indexed grid", async () => {
    const result = await call("read_canvas");
    expect(result).toContain("asset: cobblestone (tile)");
    expect(result).toContain("size: 16x16   origin: top-left, x right, y down");
    expect(result).toContain("frame: 1/1");
    expect(result).toContain(".=transparent");

    const grid = result.slice(result.indexOf("grid:\n") + 6).split("\n");
    expect(grid).toHaveLength(16);
    expect(grid.every((row) => row.length === 16)).toBe(true);
  });

  test("read_canvas reflects an edit immediately", async () => {
    await call("fill_region", { x: 0, y: 0, width: 4, height: 4, index: 2 });
    const grid = (await call("read_canvas")).split("grid:\n")[1] ?? "";
    expect(grid.split("\n")[0]).toBe("2222............");
  });

  test("get_palette reports hex and live usage counts", async () => {
    await call("fill_region", { x: 0, y: 0, width: 16, height: 8, index: 1 });
    const result = await call("get_palette");
    expect(result).toContain("#306230");
    expect(result).toContain("128 px (50.0%)");
    expect(result).toContain("transparent");
  });

  test("both perception tools fail helpfully with nothing open", async () => {
    resetSession();
    for (const name of ["read_canvas", "get_palette"]) {
      expect(await callExpectingError(name)).toContain("No asset is open");
    }
  });
});

describe("editing", () => {
  beforeEach(() => {
    session.create({ name: "tile", preset: "tile-32" });
  });

  test("write_region stamps a block and reports what changed", async () => {
    const result = await call("write_region", { x: 2, y: 2, grid: "01\n23" });
    expect(result).toContain("2x2 block at (2, 2)");
    expect(result).toContain("4 pixel(s) changed");
    expect(session.active?.colorAt(3, 3)).toBe(3);
  });

  test("write_region rejects an overflow with the offset that would fit", async () => {
    const message = await callExpectingError("write_region", {
      x: 30,
      y: 30,
      grid: "0000\n0000\n0000\n0000",
    });
    expect(message).toContain("extends past");
    expect(message).toContain("(28, 28)");
  });

  test("write_region rejects a ragged grid", async () => {
    expect(
      await callExpectingError("write_region", { x: 0, y: 0, grid: "000\n00" }),
    ).toContain("Every row must be the same width");
  });

  test("write_region rejects a character the format does not define", async () => {
    const message = await callExpectingError("write_region", {
      x: 0,
      y: 0,
      grid: "0G\n00",
    });
    expect(message).toContain("not a valid cell character");
    expect(message).toContain("row 0, column 1");
  });

  test("set_pixels writes only what changed", async () => {
    expect(
      await call("set_pixels", { pixels: [{ x: 1, y: 1, index: 4 }] }),
    ).toContain("1 changed");
    expect(
      await call("set_pixels", { pixels: [{ x: 1, y: 1, index: 4 }] }),
    ).toContain("0 changed");
  });

  test("set_pixels rejects an index the palette does not define", async () => {
    session.create({ name: "gb", preset: "gb-4" });
    const message = await callExpectingError("set_pixels", {
      pixels: [{ x: 0, y: 0, index: 9 }],
    });
    expect(message).toContain("not a palette index 0-3");
  });

  /**
   * The square check has to run before the model call, not after.
   *
   * Generation is metered and paid; discovering the canvas cannot hold the
   * result once an image has been bought is a refund nobody gets. This asserts
   * the refusal by its message, which is only reachable when nothing was spent.
   */
  /**
   * Type decides which tools exist for an asset, so being unable to change it
   * stranded work. Every generative entry point defaults to `tile`: a character
   * generated from a prompt arrived typed as a tile, and directions, animation
   * and skeletons — all `scope: "character"` — were unreachable for it.
   */
  test("changing an asset's type changes the tools it has, and keeps its pixels", async () => {
    const id = session.create({ name: "hero", type: "tile", preset: "tile-32" });
    session.open(id);
    session.active?.fillRegion({ x: 4, y: 4, width: 8, height: 8 }, 2);
    const before = session.active?.encode(0);

    const asTile = toolsForContext({ assetId: id, assetType: "tile", frameCount: 1 }).map((t) => t.name);
    expect(asTile).not.toContain("estimate_skeleton");
    expect(asTile).toContain("check_seamless_tiling");

    expect(await call("set_asset_type", { type: "character" })).toContain("character");
    expect(session.list().find((asset) => asset.id === id)?.type).toBe("character");
    // Metadata, not a document rebuild: the art and its history survive.
    expect(session.active?.encode(0)).toBe(before as string);

    const asCharacter = toolsForContext({ assetId: id, assetType: "character", frameCount: 1 }).map((t) => t.name);
    expect(asCharacter).toContain("estimate_skeleton");
    expect(asCharacter).not.toContain("check_seamless_tiling");
  });

  test("set_asset_type validates the type and supports an unchanged type", async () => {
    const id = session.create({ name: "hero", type: "character", preset: "tile-32" });
    const revision = session.revision;
    expect(await call("set_asset_type", { type: "character" })).toContain("already");
    expect(session.revision).toBe(revision);
    expect(await callExpectingError("set_asset_type", { type: "merchant" })).toContain("type");
    expect(session.list().find((asset) => asset.id === id)?.type).toBe("character");
    expect(await callExpectingError("set_asset_type")).toContain("type");
    resetSession();
    expect(await callExpectingError("set_asset_type", { type: "character" })).toContain("No asset is open");
  });

  /**
   * One game is one resolution, so an asset added to a project is the project's
   * size without being told. Choosing 64x64 for a project and then adding an
   * asset to it produced a 32x32 canvas — and generation draws at the canvas's
   * own size, so everything after that was 32x32 too.
   */
  test("create_asset takes the open project's resolution", async () => {
    for (const project of projects.listProjects()) projects.deleteProject(project.id);
    projects.createProject("Deep Caves", {
      canvasSizes: { character: 64, tile: 64, texture: 64, item: 64, ui: 64 },
    });

    await call("create_asset", { name: "cave wall", type: "tile" });
    expect(session.active?.width).toBe(64);

    // A named preset is a size chosen for this one asset, and still wins.
    await call("create_asset", { name: "icon", type: "item", preset: "gb-4" });
    expect(session.active?.width).toBe(16);
  });

  /**
   * The explorer's selection is the only thing that knows where "here" is, and
   * `create_asset` runs outside React. Before this a new asset always appeared
   * at the project root while the human was looking at a folder.
   */
  test("create_asset lands in the folder the explorer has selected", async () => {
    for (const project of projects.listProjects()) projects.deleteProject(project.id);
    const projectId = projects.createProject("Moss Hollow");
    const folderId = projects.createFolder(projectId, "Props");
    if (folderId === null) throw new Error("no folder");
    projects.openFolder(folderId);

    await call("create_asset", { name: "chest", type: "item" });

    const created = session.list().find((asset) => asset.name === "chest");
    if (created === undefined) throw new Error("create_asset made nothing");
    expect(projects.placementOf(created.id)).toEqual({ projectId, folderId });
  });

  test("draw_from_prompt refuses a non-square canvas before spending anything", async () => {
    const id = session.create({ name: "banner", width: 32, height: 16 });
    session.open(id);
    const message = await callExpectingError("draw_from_prompt", { prompt: "a bush" });
    expect(message).toContain("32x16");
    expect(message).not.toContain("Refusing to make a paid");
  });

  test("fill_region clips to the canvas instead of failing", async () => {
    expect(
      await call("fill_region", {
        x: 28,
        y: 28,
        width: 16,
        height: 16,
        index: 1,
      }),
    ).toContain("16 pixel(s) changed");
  });

  test("fill_region with index -1 clears to transparent", async () => {
    await call("fill_region", { x: 0, y: 0, width: 4, height: 4, index: 1 });
    expect(
      await call("fill_region", { x: 0, y: 0, width: 2, height: 2, index: -1 }),
    ).toContain("transparent");
    expect(session.active?.colorAt(0, 0)).toBe(-1);
  });

  test("bucket_fill floods the connected run and names what it replaced", async () => {
    await call("write_region", { x: 0, y: 0, grid: "0010\n0010\n1110\n0000" });
    const result = await call("bucket_fill", { x: 0, y: 0, index: 4 });
    expect(result).toContain("connected run");
    expect(result).toContain("4 pixel(s) changed");
  });

  test("bucket_fill with contiguous false recolours every match", async () => {
    await call("write_region", { x: 0, y: 0, grid: "0010\n0010\n1110\n0000" });
    const result = await call("bucket_fill", {
      x: 0,
      y: 0,
      index: 4,
      contiguous: false,
    });
    expect(result).toContain("every matching pixel");
  });

  test("bucket_fill on an unchanged cell says so rather than reporting success", async () => {
    expect(await call("bucket_fill", { x: 0, y: 0, index: -1 })).toContain(
      "Nothing changed",
    );
  });

  test("replace_color restyles globally", async () => {
    await call("fill_region", { x: 0, y: 0, width: 32, height: 4, index: 1 });
    expect(
      await call("replace_color", { from_index: 1, to_index: 5 }),
    ).toContain("128 pixel(s) changed");
  });

  test("replace_color refuses a no-op and says why", async () => {
    expect(
      await callExpectingError("replace_color", { from_index: 2, to_index: 2 }),
    ).toContain("would change nothing");
  });

  test("replace_color on an unused index points at get_palette", async () => {
    expect(
      await call("replace_color", { from_index: 7, to_index: 8 }),
    ).toContain("get_palette");
  });
});

describe("argument validation", () => {
  beforeEach(() => {
    session.create({ name: "tile", preset: "tile-32" });
  });

  test("rejects a fractional coordinate", async () => {
    const message = await callExpectingError("bucket_fill", {
      x: 1.5,
      y: 0,
      index: 1,
    });
    expect(message).toContain("'x' must be an integer");
    expect(message).toContain("whole numbers");
  });

  test("rejects a coordinate outside the canvas with the bound", async () => {
    expect(
      await callExpectingError("bucket_fill", { x: 40, y: 0, index: 1 }),
    ).toContain("above the maximum of 31");
  });

  test("rejects a missing required argument", async () => {
    expect(await callExpectingError("write_region", { x: 0, y: 0 })).toContain(
      "'grid' must be a non-empty string",
    );
  });

  test("rejects a malformed pixels array", async () => {
    expect(await callExpectingError("set_pixels", { pixels: [] })).toContain(
      "non-empty array",
    );
    expect(await callExpectingError("set_pixels", { pixels: [3] })).toContain(
      "pixels[0] must be an object",
    );
  });

  test("rejects an out-of-range enum with the allowed values", async () => {
    expect(
      await callExpectingError("list_assets", { type: "monster" }),
    ).toContain("'character'");
  });

  test("never surfaces a raw exception", async () => {
    for (const tool of TOOLS) {
      // Skipped for the same reason as above: with junk arguments these would
      // still reach the model, and a validation test must not buy an image.
      if (tool.network === true) continue;
      const outcome = await runTool(
        tool as ToolDefinition,
        { x: "no", y: null, grid: 7 },
        "console",
      );
      expect(outcome.text).not.toContain("at Object.");
      expect(outcome.text.length).toBeGreaterThan(10);
    }
  });
});

describe("history", () => {
  beforeEach(() => {
    session.create({ name: "tile", preset: "tile-32" });
  });

  /** The exit criterion: Ctrl+Z undoes an agent's edit. */
  test("one tool call is one undo entry", async () => {
    await call("write_region", { x: 0, y: 0, grid: "0123\n4567\n89AB\nCDEF" });
    expect(session.active?.history()).toEqual(["write_region"]);

    await call("set_pixels", {
      pixels: [
        { x: 0, y: 0, index: 5 },
        { x: 1, y: 0, index: 5 },
      ],
    });
    expect(session.active?.history()).toEqual(["write_region", "set_pixels"]);
  });

  test("undo reverses an agent edit completely", async () => {
    const before = session.active?.encode();
    await call("write_region", { x: 0, y: 0, grid: "0123\n4567\n89AB\nCDEF" });
    expect(session.active?.encode()).not.toBe(before);

    expect(await call("undo")).toContain("write_region");
    expect(session.active?.encode()).toBe(before as string);
  });

  test("redo replays it", async () => {
    await call("fill_region", { x: 0, y: 0, width: 4, height: 4, index: 2 });
    const after = session.active?.encode();
    await call("undo");
    expect(await call("redo")).toContain("fill_region");
    expect(session.active?.encode()).toBe(after as string);
  });

  test("an empty history reports rather than fails", async () => {
    expect(await call("undo")).toContain("Nothing to undo");
    expect(await call("redo")).toContain("Nothing to redo");
  });

  test("the agent shares the human's stack", async () => {
    // A "human" edit straight on the store, then an agent edit through a tool.
    session.active?.transaction("Pencil stroke", () => {
      session.active?.setPixels([{ x: 0, y: 0, index: 1 }]);
    });
    await call("bucket_fill", { x: 5, y: 5, index: 2 });

    expect(session.active?.history()).toEqual(["Pencil stroke", "bucket_fill"]);
    await call("undo");
    expect(session.active?.history()).toEqual(["Pencil stroke"]);
  });
});

describe("check_seamless_tiling", () => {
  /** The exit criterion: fail, fix, re-check, pass — driven only through tools. */
  test("an agent can close the loop from fail to pass", async () => {
    session.create({ name: "gradient", preset: "gb-4" });

    // A left-to-right ramp: every row wraps the lightest onto the darkest.
    const rows = Array.from({ length: 16 }, () => "0000111122223333");
    await call("write_region", { x: 0, y: 0, grid: rows.join("\n") });

    const failure = await call("check_seamless_tiling");
    expect(failure).toContain("does NOT tile seamlessly");
    expect(failure).toContain("left/right edge: FAIL");
    expect(failure).toContain("(15, 0)='3' wraps onto (0, 0)='0'");
    expect(failure).toContain("check_seamless_tiling again");

    // Mirror the ramp so the wrap lands on a pairing the tile already contains.
    const fixed = Array.from({ length: 16 }, () => "0011223333221100");
    await call("write_region", { x: 0, y: 0, grid: fixed.join("\n") });

    const pass = await call("check_seamless_tiling");
    expect(pass).toContain("tiles seamlessly");
    expect(pass).toContain("left/right edge: PASS");
  });

  test("reports coordinates, not a boolean", async () => {
    session.create({ name: "gradient", preset: "gb-4" });
    await call("write_region", {
      x: 0,
      y: 0,
      grid: Array.from({ length: 16 }, () => "0000111122223333").join("\n"),
    });

    const result = await call("check_seamless_tiling");
    for (let y = 0; y < 16; y += 1) {
      expect(result).toContain(`row ${String(y)}: (15, ${String(y)})`);
    }
  });

  test("passes a flat fill", async () => {
    session.create({ name: "flat", preset: "gb-4" });
    await call("fill_region", { x: 0, y: 0, width: 16, height: 16, index: 2 });
    expect(await call("check_seamless_tiling")).toContain("tiles seamlessly");
  });
});

describe("export_png", () => {
  test("provides complete agent-readable bytes without a DOM canvas", async () => {
    session.create({ name: "tile", preset: "tile-32" });
    const manifest = JSON.parse(await call("export_png", { scale: 1 }));
    expect(manifest.delivery).toBe("artifact");
    expect(manifest.files[0].mime_type).toBe("image/png");
    const chunk = JSON.parse(await call("read_export", { artifact_id: manifest.files[0].artifact_id }));
    expect(chunk.eof).toBe(true);
    expect(Buffer.from(chunk.data, "base64").subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  });

  test("rejects a non-integer scale before touching the canvas", async () => {
    session.create({ name: "tile", preset: "tile-32" });
    expect(await callExpectingError("export_png", { scale: 3 })).toContain(
      "must be one of 1, 2, 4, 8, 16",
    );
  });
});

describe("transcript", () => {
  test("records both callers, with arguments, result and duration", async () => {
    session.create({ name: "tile", preset: "tile-32" });

    const definition = findTool("fill_region") as ToolDefinition;
    await runTool(
      definition,
      { x: 0, y: 0, width: 2, height: 2, index: 1 },
      "agent",
    );
    await runTool(
      definition,
      { x: 4, y: 4, width: 2, height: 2, index: 1 },
      "console",
    );

    const records = transcript.list();
    expect(records).toHaveLength(2);
    // Newest first.
    expect(records[0]?.source).toBe("console");
    expect(records[1]?.source).toBe("agent");
    expect(records[0]?.tool).toBe("fill_region");
    expect(records[0]?.status).toBe("ok");
    expect(records[0]?.args).toEqual({
      x: 4,
      y: 4,
      width: 2,
      height: 2,
      index: 1,
    });
    expect(records[0]?.durationMs).toBeGreaterThanOrEqual(0);
  });

  test("records failures as failures", async () => {
    await callExpectingError("read_canvas");
    expect(transcript.list()[0]?.status).toBe("error");
    expect(transcript.list()[0]?.result).toContain("No asset is open");
  });

  test("clear empties it", async () => {
    session.create({ name: "tile" });
    await call("list_assets");
    expect(transcript.list()).not.toHaveLength(0);
    transcript.clear();
    expect(transcript.list()).toHaveLength(0);
  });
});

describe("route and session agreement", () => {
  test("stays put when the route already shows the requested asset", () => {
    expect(routeForRequestedAsset("/asset/asset_001", "asset_001")).toBeNull();
  });

  test("navigates when a tool asks for a different asset", () => {
    expect(routeForRequestedAsset("/asset/asset_001", "asset_002")).toBe(
      "/asset/asset_002",
    );
  });

  test("opens an explicitly requested asset from the library but leaves settings alone", () => {
    expect(routeForRequestedAsset("/home", "asset_002")).toBe("/asset/asset_002");
    expect(routeForRequestedAsset("/settings", "asset_002")).toBeNull();
  });

  test("stays put when nothing was requested", () => {
    expect(routeForRequestedAsset("/asset/asset_001", null)).toBeNull();
  });

  test("reads the asset id out of an editor route only", () => {
    expect(assetRouteId("/asset/asset_001")).toBe("asset_001");
    expect(assetRouteId("/asset/asset_001/")).toBe("asset_001");
    expect(assetRouteId("/asset/asset_001/frames")).toBeNull();
    expect(assetRouteId("/home")).toBeNull();
    expect(assetRouteId("/")).toBeNull();
  });

  /** The divergence itself: what the tool reports must be what the human is shown. */
  test("open_asset requests the view move to the asset it reports opening", async () => {
    const first = session.create({ name: "cobblestone" });
    const second = session.create({ name: "grass" });
    session.open(first);
    assetNavigation.clear();

    const result = await call("open_asset", { asset_id: second });
    expect(result).toContain(second);
    expect(assetNavigation.peek()).toBe(second);
    expect(
      routeForRequestedAsset(`/asset/${first}`, assetNavigation.peek()),
    ).toBe(`/asset/${second}`);
  });

  test("create_asset requests the view move to the asset it just made", async () => {
    const existing = session.create({ name: "cobblestone" });
    assetNavigation.clear();

    await call("create_asset", { name: "crate", type: "item" });
    expect(assetNavigation.peek()).toBe(session.activeId);
    expect(assetNavigation.peek()).not.toBe(existing);
  });

  /**
   * The regression this design exists to prevent: inferring navigation from a
   * session/route mismatch bounced the human off the asset they just clicked,
   * because on mount the two legitimately disagree for one commit.
   */
  test("opening an asset the session does not consider active requests nothing", () => {
    session.create({ name: "cobblestone" });
    const last = session.create({ name: "crate" });
    assetNavigation.clear();

    // The human clicks Cobblestone while `activeId` is still Crate. No tool ran,
    // so nothing is requested and the route is left to reconcile itself.
    expect(session.activeId).toBe(last);
    expect(assetNavigation.peek()).toBeNull();
    expect(
      routeForRequestedAsset("/asset/asset_001", assetNavigation.peek()),
    ).toBeNull();
  });

  test("a spent request does not fire again", async () => {
    session.create({ name: "cobblestone" });
    const second = session.create({ name: "grass" });
    await call("open_asset", { asset_id: second });
    expect(assetNavigation.peek()).toBe(second);

    assetNavigation.clear();
    expect(assetNavigation.peek()).toBeNull();
  });
});

const TOOL_MODULES: Record<string, Record<string, unknown>> = {
  context: contextTools,
  editing: editingTools,
  frames: framesTools,
  animation: animationTools,
  projects: projectTools,
  generation: generationTools,
  perception: perceptionTools,
  viewport: viewportTools,
  history: historyTools,
  validation: validationTools,
  inpaint: inpaintTools,
  export: exportTools,
  projectIo: projectIoTools,
};

function isToolDefinition(value: unknown): value is ToolDefinition {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<ToolDefinition>;
  return typeof candidate.name === "string" && typeof candidate.execute === "function";
}

/**
 * Which tools spend money, decided by running them rather than by their names.
 *
 * The flag is what every test-level skip keys on, so an undeclared paid tool is
 * a hole in all of them at once — and that is not hypothetical: `generate_texture`
 * and `generate_isometric_tile` delegate to `generate_asset` and declared
 * nothing, so both would have run in two suites.
 *
 * A name pattern cannot catch that, because delegation is invisible in a name.
 * This runs each undeclared tool and asks whether it reached the paid guard,
 * which is the only thing that actually answers the question.
 */
describe("paid tools are declared", () => {
  test("no undeclared tool reaches a paid call", async () => {
    const undeclared: string[] = [];

    for (const tool of TOOLS) {
      if (tool.network === true) continue;

      resetSession();
      for (const project of projects.listProjects()) projects.deleteProject(project.id);
      const projectId = projects.createProject("paid-probe-project");
      const id = session.create({ name: "paid-probe", type: "tile", preset: "tile-32" });
      projects.place(id, projectId);
      session.active?.addFrame();
      session.active?.fillRegion({ x: 4, y: 4, width: 16, height: 16 }, 3, { frame: 0 });

      const example = tool.example ?? {};
      const args: Record<string, unknown> = { ...example };
      if ("asset_id" in args) args["asset_id"] = id;
      if ("project_id" in args) args["project_id"] = projects.activeProjectId;

      const outcome = await runTool(tool as ToolDefinition, args, "console");
      if (!outcome.ok && outcome.text.includes("Refusing to make a paid")) {
        undeclared.push(tool.name);
      }
    }

    expect(undeclared).toEqual([]);
  });
});
