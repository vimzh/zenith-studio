/** Stable registration must never let tools edit an asset other than the visible route. */
import { afterEach, beforeEach, expect, test } from "bun:test";
import { session } from "@/lib/editor";
import { runTool } from "./run";
import { EMPTY_SCOPE } from "./scope";
import { findTool, toolsForContext } from "./tools";
import { readScopeContext } from "./use-webmcp";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");

beforeEach(() => {
  for (const asset of session.list()) session.close(asset.id);
});

afterEach(() => {
  if (originalWindow === undefined) Reflect.deleteProperty(globalThis, "window");
  else Object.defineProperty(globalThis, "window", originalWindow);
});

function show(id: string | null): void {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { location: { pathname: id === null ? "/home" : `/asset/${id}` } },
  });
}

test("a pending same-type navigation retains the visible route's complete tool surface", () => {
  const visible = session.create({ name: "Visible", type: "character", preset: "tile-32" });
  const before = toolsForContext(readScopeContext(visible));
  const next = session.create({ name: "Next", type: "character", preset: "tile-32" });
  const during = toolsForContext(readScopeContext(visible));
  expect(during.length).toBe(before.length);
  for (const [index, definition] of before.entries()) expect(during[index]).toBe(definition);
  const after = toolsForContext(readScopeContext(next));
  for (const [index, definition] of before.entries()) expect(after[index]).toBe(definition);
});

test("scope reads frames from the visible asset instead of the active transition target", () => {
  const visible = session.create({ name: "Visible", type: "character", preset: "tile-32" });
  session.get(visible)!.addFrame();
  session.create({ name: "Next", type: "tile", preset: "tile-32" });
  expect(readScopeContext(visible)).toEqual({ assetId: visible, assetType: "character", frameCount: 2 });
  expect(readScopeContext(null)).toBe(EMPTY_SCOPE);
  session.close(visible);
  expect(readScopeContext(visible)).toBe(EMPTY_SCOPE);
});

test("editor calls cannot mutate the unseen active asset while navigation is pending", async () => {
  const visible = session.create({ name: "Visible", preset: "tile-32" });
  const next = session.create({ name: "Next", preset: "tile-32" });
  show(visible);
  const tool = findTool("set_pixels")!;
  const args = { pixels: [{ x: 0, y: 0, index: 0 }] };
  const outcome = await runTool(tool, args, "agent");
  expect(outcome.ok).toBe(false);
  expect(outcome.text).toContain("visible asset");
  expect(session.get(next)!.colorAt(0, 0)).toBe(-1);
  expect(session.get(visible)!.colorAt(0, 0)).toBe(-1);
  show(next);
  expect((await runTool(tool, args, "agent")).ok).toBe(true);
  expect(session.get(next)!.colorAt(0, 0)).toBe(0);
});

test("every asset-dependent scope refuses missing or mismatched routes before executing", async () => {
  const id = session.create({ name: "Hidden", preset: "tile-32" });
  for (const path of [null, "missing"]) {
    show(path);
    for (const scope of [undefined, "editor", "character", "animation", "tile", "tileset"] as const) {
      let executed = false;
      const outcome = await runTool({
        name: "probe", description: "probe", scope,
        inputSchema: { type: "object", properties: {} },
        execute: () => { executed = true; return "ok"; },
      }, {}, "console");
      expect({ ok: outcome.ok, executed }).toEqual({ ok: false, executed: false });
    }
  }
  show(id);
  session.close(id);
  expect((await runTool(findTool("read_canvas")!, {}, "agent")).ok).toBe(false);
});

test("always-scoped library navigation remains available during route transitions", async () => {
  const visible = session.create({ name: "Visible", preset: "tile-32" });
  session.create({ name: "Next", preset: "tile-32" });
  show(visible);
  expect((await runTool(findTool("list_assets")!, {}, "agent")).ok).toBe(true);
  expect((await runTool(findTool("open_asset")!, { asset_id: visible }, "agent")).ok).toBe(true);
  expect(session.activeId).toBe(visible);
});
