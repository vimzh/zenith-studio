import { beforeEach, describe, expect, test } from "bun:test";
import { session } from "@/lib/editor";
import { AUTHORING_TOOLS } from "./authoring";
import { assetNavigation } from "../navigation";
import { runTool } from "../run";
import { transcript } from "../transcript";
import type { ToolArgs, ToolDefinition } from "../types";

/**
 * The authoring tools — the deferred asset-generation half of the catalog.
 *
 * Every assertion runs through `runTool`, the same path `document.modelContext`
 * and the Agent Console's Run button take. Calling `execute` directly would
 * prove less, because the point of the tool layer is that there is one path.
 */

function resetSession(): void {
  for (const asset of session.list()) session.close(asset.id);
  transcript.clear();
  assetNavigation.clear();
}

beforeEach(resetSession);

function tool(name: string): ToolDefinition {
  const found = AUTHORING_TOOLS.find((entry) => entry.name === name);
  if (found === undefined) throw new Error(`No authoring tool '${name}'`);
  return found;
}

async function call(name: string, args: ToolArgs = {}): Promise<string> {
  const outcome = await runTool(tool(name), args, "console");
  if (!outcome.ok) throw new Error(outcome.text);
  return outcome.text;
}

async function callExpectingError(name: string, args: ToolArgs = {}): Promise<string> {
  const outcome = await runTool(tool(name), args, "console");
  expect(outcome.ok).toBe(false);
  return outcome.text;
}

/** A tile with two colours actually painted, so palette work has something to match. */
function openTile(type: "tile" | "character" = "tile"): string {
  const id = session.create({ name: "fixture", type, preset: "tile-32" });
  const store = session.get(id);
  if (store === undefined) throw new Error("fixture missing");
  store.transaction("paint fixture", () => {
    const pixels = [];
    for (let y = 8; y < 24; y += 1) {
      for (let x = 8; x < 24; x += 1) {
        pixels.push({ x, y, index: ((x + y) % 2) as 0 | 1 });
      }
    }
    store.setPixels(pixels);
  });
  session.open(id);
  return id;
}

describe("the authoring tool surface", () => {
  test("every tool has a unique name, a schema and an example", () => {
    const names = AUTHORING_TOOLS.map((entry) => entry.name);
    expect(new Set(names).size).toBe(names.length);
    for (const entry of AUTHORING_TOOLS) {
      expect(entry.inputSchema.type).toBe("object");
      expect(entry.example).toBeDefined();
      expect(entry.description.length).toBeGreaterThan(40);
    }
  });

  /**
   * The two read-only tools must not touch the document.
   *
   * `readOnly` sets `readOnlyHint` on the MCP surface, which a client may use to
   * skip a confirmation prompt. A tool that lies here mutates without asking.
   */
  test("read-only tools leave the revision untouched", async () => {
    const id = openTile("character");
    const store = session.get(id);
    if (store === undefined) throw new Error("fixture missing");

    for (const entry of AUTHORING_TOOLS.filter((candidate) => candidate.readOnly === true)) {
      const before = store.revision;
      await runTool(entry, entry.example ?? {}, "console");
      expect({ tool: entry.name, revision: store.revision }).toEqual({
        tool: entry.name,
        revision: before,
      });
    }
  });

  test("the two image tools are the only ones needing a browser", () => {
    const browserOnly = AUTHORING_TOOLS.filter((entry) => entry.scope === "always").map((entry) => entry.name);
    expect(browserOnly).toEqual(["import_image", "build_character_from_reference"]);
  });
});

describe("generate_tileset", () => {
  test("derives a 47-tile sheet from one tile without a model", async () => {
    openTile();
    const before = session.list().length;
    const summary = await call("generate_tileset");

    expect(summary).toContain("47");
    expect(summary).toContain("No model");
    expect(session.list().length).toBe(before + 1);
  });

  test("rejects an edge index outside the palette", async () => {
    openTile();
    expect(await callExpectingError("generate_tileset", { edge_index: 99 })).toContain("edge_index");
  });
});

describe("set_palette", () => {
  test("remaps into a named palette and reports the match", async () => {
    const id = openTile();
    const summary = await call("set_palette", { palette: "gb-dmg" });

    expect(summary).toContain("Game Boy DMG");
    const store = session.get(id);
    expect(store?.palette.colors.length).toBe(4);
  });

  test("accepts an explicit hex list", async () => {
    const id = openTile();
    await call("set_palette", { colors: ["#000000", "#ffffff"] });
    expect(session.get(id)?.palette.colors.length).toBe(2);
  });

  /** A bad hex is the agent's mistake to correct, so the message must name the index. */
  test("names the offending entry rather than failing vaguely", async () => {
    openTile();
    const message = await callExpectingError("set_palette", { colors: ["#000000", "not-a-colour"] });
    expect(message).toContain("colors[1]");
  });

  test("refuses a palette that cannot be indexed in one hex character", async () => {
    openTile();
    const seventeen = Array.from({ length: 17 }, (_, index) => `#0000${index.toString(16).padStart(2, "0")}`);
    expect(await callExpectingError("set_palette", { colors: seventeen })).toContain("2 to 16");
  });
});

describe("estimate_skeleton", () => {
  test("reports joints normalised into the content bounds", async () => {
    openTile("character");
    const summary = await call("estimate_skeleton");

    expect(summary).toContain("bipedal");
    expect(summary).toContain("head");

    // Normalised against the content bounds, not pixels. The tolerance is the
    // library's own documented one (skeleton.test.ts): limbs are hung off the
    // measured shoulder and hip spread, so on a square silhouette a hand lands
    // just outside the bounds it was measured from. The tool description says
    // so and tells the agent to clamp, rather than this test quietly widening.
    for (const [, x, y] of summary.matchAll(/\((-?\d\.\d\d), (-?\d\.\d\d)\)/g)) {
      expect(Number(x)).toBeLessThanOrEqual(1.1);
      expect(Number(x)).toBeGreaterThanOrEqual(-0.1);
      expect(Number(y)).toBeLessThanOrEqual(1.1);
    }
  });

  /**
   * An empty sprite has no silhouette, and a pose centred on nothing would be
   * worse than an error: the agent would act on invented joint positions.
   */
  test("refuses an empty sprite instead of inventing a pose", async () => {
    const id = session.create({ name: "empty", type: "character", preset: "tile-32" });
    session.open(id);
    expect(await callExpectingError("estimate_skeleton")).toContain("empty");
  });
});

describe("list_pose_templates", () => {
  test("names every template with its pose count", async () => {
    openTile("character");
    const summary = await call("list_pose_templates");
    expect(summary).toContain("walk");
    expect(summary).toMatch(/\(\d+ poses?, (bipedal|quadrupedal)\)/);
  });
});

/**
 * The pixelisation decode is browser-only by design, so headlessly these fail
 * with a message that says so rather than a stack trace. Worth pinning: the
 * message is what an agent receives, and "cannot run server-side" is actionable
 * where a TypeError is not.
 */
describe("the image tools headlessly", () => {
  test("say plainly that decoding needs a browser", async () => {
    for (const name of ["import_image", "build_character_from_reference"]) {
      const message = await callExpectingError(name, tool(name).example ?? {});
      expect({ name, browser: message.includes("browser") }).toEqual({ name, browser: true });
    }
  });
});
