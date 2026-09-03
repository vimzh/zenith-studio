// Exercises live chat capability changes through the real conversation and tool handlers.
import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { session } from "@/lib/editor";
import { __allowPaidRequestsForTest } from "./api";
import { buildSystemPrompt, conversation } from "./conversation";
import { transcript } from "./transcript";
import type { ChatMessage } from "./chat";
import type { OpenAiTool } from "./chat-tools";

const originalFetch = globalThis.fetch;

beforeEach(() => {
  conversation.clear();
  transcript.clear();
  for (const asset of session.list()) session.close(asset.id);
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  __allowPaidRequestsForTest(false);
  conversation.clear();
});

test("an explicit tile-to-character correction unlocks rotation in the same request", async () => {
  const id = session.create({ name: "merchant", type: "tile", preset: "tile-32" });
  session.active?.setPixels([{ x: 10, y: 6, index: 2 }]);
  const pixels = session.active?.encode(0);
  const history = session.active?.history();
  const offered: string[][] = [];
  const replies: ChatMessage[] = [
    { role: "assistant", content: null, tool_calls: [{ id: "correct_type", type: "function", function: { name: "set_asset_type", arguments: '{"type":"character"}' } }] },
    { role: "assistant", content: null, tool_calls: [{ id: "directions", type: "function", function: { name: "get_directions", arguments: '{"set":"cardinal4"}' } }] },
    { role: "assistant", content: "Character tools are available." },
  ];
  globalThis.fetch = mock(async (input: unknown, init?: RequestInit) => {
    if (!String(input).endsWith("/v1/chat")) throw new Error("Unexpected image request");
    const body = JSON.parse(String(init?.body)) as { tools: OpenAiTool[] };
    offered.push(body.tools.map((tool) => tool.function.name));
    return Response.json({ message: replies[offered.length - 1], model: "test" });
  }) as unknown as typeof fetch;
  __allowPaidRequestsForTest(true);

  await conversation.send("This is a character, not a tile. Change its type and list its directions.", {
    assetId: id, assetType: "tile", frameCount: 1,
  }, null);

  expect(offered[0]).toContain("set_asset_type");
  expect(offered[0]).not.toContain("rotate_character");
  expect(offered[1]).toContain("rotate_character");
  expect(offered[1]).not.toContain("check_seamless_tiling");
  expect(session.list().find((asset) => asset.id === id)?.type).toBe("character");
  expect(session.active?.encode(0)).toBe(pixels);
  expect(session.active?.history()).toEqual(history);
  expect(conversation.state.status).toBe("idle");
  expect(conversation.state.error).toBeNull();
  expect(conversation.state.messages.find((message) => message.tool_call_id === "directions")?.content).toContain("Directions for");
  expect(transcript.list().map((call) => call.tool)).toEqual(["get_directions", "set_asset_type"]);
});

test("orientation and local edits are not treated as whole-canvas redraw requests", () => {
  session.create({ name: "merchant", type: "tile", preset: "tile-32" });
  const prompt = buildSystemPrompt();
  expect(prompt).toContain("rotate_character");
  expect(prompt).toContain("set_asset_type");
  expect(prompt).toContain("explicitly confirms");
  expect(prompt).toContain("read_canvas after");
  expect(prompt).toContain("Do not claim visual success");
  expect(prompt).toContain("free deterministic recolor_region");
  expect(prompt).toContain("unmapped outlines");
  expect(prompt).toContain("@hex");
});
