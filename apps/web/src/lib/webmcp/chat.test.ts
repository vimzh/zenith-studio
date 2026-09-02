import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { session } from "@/lib/editor";
import {
  CHAT_TOOL_NAMES,
  EMPTY_SCOPE,
  TOOLS,
  chatTools,
  findTool,
  __allowPaidRequestsForTest,
  generateImage,
  paidRequestInFlight,
  runChat,
  toOpenAiTools,
  transcript,
  type ChatMessage,
  type ScopeContext,
  type ToolDefinition,
} from "./index";

function context(overrides: Partial<ScopeContext> = {}): ScopeContext {
  return {
    assetId: "asset_001",
    assetType: "tile",
    frameCount: 1,
    ...overrides,
  };
}

/** Replies the fake relay hands back, in order. */
function relay(
  ...turns: { content: string | null; tool_calls?: unknown[] }[]
): () => void {
  let index = 0;
  const original = globalThis.fetch;
  globalThis.fetch = mock(async () => {
    const turn = turns[Math.min(index, turns.length - 1)];
    index += 1;
    return new Response(
      JSON.stringify({
        message: { role: "assistant", ...turn },
        finishReason: "stop",
        model: "test",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as unknown as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

beforeEach(() => {
  for (const asset of session.list()) session.close(asset.id);
  transcript.clear();
  session.create({ name: "tile", type: "tile", preset: "tile-32" });
});

describe("chat tool curation", () => {
  test("offers far fewer tools than the registry", () => {
    expect(CHAT_TOOL_NAMES.length).toBeLessThan(TOOLS.length);
  });

  test("every allowlisted name is a real tool", () => {
    for (const name of CHAT_TOOL_NAMES) {
      expect({ name, exists: findTool(name) !== undefined }).toEqual({
        name,
        exists: true,
      });
    }
  });

  /** Unrelated generation, downloads and asset switching stay deliberate UI actions. */
  test("excludes unrelated generation, downloads, and asset switching", () => {
    for (const excluded of [
      "export_png",
      "generate_asset",
      "create_asset",
      "open_asset",
      "pixelize",
    ]) {
      expect(CHAT_TOOL_NAMES).not.toContain(excluded);
    }
  });

  test("includes the checkers, so the agent can verify its own work", () => {
    expect(CHAT_TOOL_NAMES).toContain("check_seamless_tiling");
    expect(CHAT_TOOL_NAMES).toContain("check_animation_coherence");
    expect(CHAT_TOOL_NAMES).toContain("animate_with_skeleton");
    expect(CHAT_TOOL_NAMES).toContain("undo");
  });

  test("offers source-conditioned variations through chat", () => {
    expect(CHAT_TOOL_NAMES).toContain("derive_variant");
    expect(CHAT_TOOL_NAMES).toContain("inpaint_region");
    expect(CHAT_TOOL_NAMES).toContain("generate_variation_set");
  });

  /**
   * Without this the chat cannot generate at all, and the failure is not an
   * error — the model quietly hand-draws the subject with set_pixels, spends
   * every turn it has, and leaves a blob behind. That happened in the product.
   */
  test("can draw the open canvas from a description", () => {
    expect(CHAT_TOOL_NAMES).toContain("draw_from_prompt");
    expect(chatTools(context()).map((tool) => tool.name)).toContain("draw_from_prompt");
  });

  test("narrows to what the current view can act on", () => {
    const tile = chatTools(context()).map((tool) => tool.name);
    const character = chatTools(context({ assetType: "character" })).map(
      (tool) => tool.name,
    );

    expect(tile).toContain("check_seamless_tiling");
    expect(character).not.toContain("check_seamless_tiling");
    // Single-frame assets are not offered frame diffing.
    expect(tile).not.toContain("read_frames_diff");
    expect(chatTools(context({ frameCount: 4 })).map((t) => t.name)).toContain(
      "read_frames_diff",
    );
  });

  test("offers nothing with no asset open", () => {
    expect(chatTools(EMPTY_SCOPE)).toEqual([]);
  });

  test("converts to OpenAI's function shape with the schema intact", () => {
    const [tool] = toOpenAiTools([findTool("bucket_fill") as ToolDefinition]);
    expect(tool?.type).toBe("function");
    expect(tool?.function.name).toBe("bucket_fill");
    expect(tool?.function.description.length).toBeGreaterThan(80);
    expect((tool?.function.parameters as { type: string }).type).toBe("object");
  });
});

describe("the agentic loop", () => {
  // These drive the real loop with fetch mocked, so they exercise the paid path
  // deliberately and opt in. The refusal they are opting out of is what stops a
  // test that forgot to mock from buying completions.
  beforeEach(() => {
    __allowPaidRequestsForTest(true);
  });
  afterEach(() => {
    __allowPaidRequestsForTest(false);
  });

  const tools = () => chatTools(context());

  test("returns the answer when the model calls no tools", async () => {
    const restore = relay({ content: "A cobblestone tile is 32x32 here." });
    try {
      const result = await runChat(
        [{ role: "user", content: "how big is it?" }],
        { tools: tools() },
      );
      expect(result.exhausted).toBe(false);
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0]?.content).toContain("32x32");
    } finally {
      restore();
    }
  });

  /** The point of the whole architecture: the tool runs here, on the human's canvas. */
  test("executes a tool call against the live store", async () => {
    const restore = relay(
      {
        content: null,
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: {
              name: "fill_region",
              arguments: '{"x":0,"y":0,"width":4,"height":4,"index":2}',
            },
          },
        ],
      },
      { content: "Filled the corner." },
    );
    try {
      const result = await runChat(
        [{ role: "user", content: "fill the corner" }],
        { tools: tools() },
      );

      expect(session.active?.colorAt(0, 0)).toBe(2);
      expect(result.exhausted).toBe(false);

      const toolResult = result.messages.find(
        (message) => message.role === "tool",
      );
      expect(toolResult?.content).toContain("16 pixel(s) changed");
      expect(toolResult?.tool_call_id).toBe("call_1");
    } finally {
      restore();
    }
  });

  test("agent tool calls land in the shared transcript and undo stack", async () => {
    const restore = relay(
      {
        content: null,
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: {
              name: "bucket_fill",
              arguments: '{"x":0,"y":0,"index":5}',
            },
          },
        ],
      },
      { content: "Done." },
    );
    try {
      await runChat([{ role: "user", content: "fill it" }], { tools: tools() });

      expect(transcript.list()[0]?.source).toBe("agent");
      expect(transcript.list()[0]?.tool).toBe("bucket_fill");
      // One entry, so the human's Ctrl+Z takes it back in one press.
      expect(session.active?.history()).toEqual(["bucket_fill"]);
    } finally {
      restore();
    }
  });

  /** A failed tool call is information for the model, not the end of the conversation. */
  test("hands a tool failure back to the model rather than aborting", async () => {
    const restore = relay(
      {
        content: null,
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: {
              name: "bucket_fill",
              arguments: '{"x":999,"y":0,"index":1}',
            },
          },
        ],
      },
      { content: "I used a coordinate outside the canvas; retrying." },
    );
    try {
      const result = await runChat([{ role: "user", content: "fill it" }], {
        tools: tools(),
      });
      const toolResult = result.messages.find(
        (message) => message.role === "tool",
      );
      expect(toolResult?.content).toContain("Error:");
      expect(toolResult?.content).toContain("above the maximum");
      expect(result.exhausted).toBe(false);
    } finally {
      restore();
    }
  });

  test("tells the model when it invents a tool", async () => {
    const restore = relay(
      {
        content: null,
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "make_it_nice", arguments: "{}" },
          },
        ],
      },
      { content: "Understood." },
    );
    try {
      const result = await runChat([{ role: "user", content: "improve it" }], {
        tools: tools(),
      });
      const toolResult = result.messages.find(
        (message) => message.role === "tool",
      );
      expect(toolResult?.content).toContain("No tool named 'make_it_nice'");
      expect(toolResult?.content).toContain("Available:");
    } finally {
      restore();
    }
  });

  test("reports malformed arguments back to the model", async () => {
    const restore = relay(
      {
        content: null,
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "fill_region", arguments: "not json" },
          },
        ],
      },
      { content: "Retrying." },
    );
    try {
      const result = await runChat([{ role: "user", content: "fill" }], {
        tools: tools(),
      });
      expect(result.messages.find((m) => m.role === "tool")?.content).toContain(
        "Could not parse arguments",
      );
    } finally {
      restore();
    }
  });

  /** A model that keeps calling tools must not loop forever on someone's bill. */
  test("stops after the turn cap and says so", async () => {
    const restore = relay({
      content: null,
      tool_calls: [
        {
          id: "call_n",
          type: "function",
          function: { name: "read_canvas", arguments: "{}" },
        },
      ],
    });
    try {
      const result = await runChat(
        [{ role: "user", content: "look forever" }],
        {
          tools: tools(),
          maxTurns: 3,
        },
      );
      expect(result.exhausted).toBe(true);
      // Three assistant turns, each with its tool result.
      expect(
        result.messages.filter((message) => message.role === "assistant"),
      ).toHaveLength(3);
    } finally {
      restore();
    }
  });

  test("streams messages as they arrive", async () => {
    const seen: ChatMessage[] = [];
    const restore = relay(
      {
        content: null,
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "read_canvas", arguments: "{}" },
          },
        ],
      },
      { content: "It is empty." },
    );
    try {
      await runChat([{ role: "user", content: "what is there?" }], {
        tools: tools(),
        onMessage: (message) => seen.push(message),
      });
      expect(seen.map((message) => message.role)).toEqual([
        "assistant",
        "tool",
        "assistant",
      ]);
    } finally {
      restore();
    }
  });

  test("surfaces an unreachable service as an actionable message", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = mock(async () => {
      throw new Error("connection refused");
    }) as unknown as typeof fetch;
    try {
      await expect(
        runChat([{ role: "user", content: "hi" }], { tools: tools() }),
      ).rejects.toThrow(/only chat is unavailable/);
    } finally {
      globalThis.fetch = original;
    }
  });
});

/**
 * Generation takes minutes with nothing to look at, so a user who cannot tell
 * slow from stuck clicks again — and each click is an image bought. These guard
 * the money, not the correctness.
 */
describe("paid request guarding", () => {
  // These are the tests that genuinely exercise the paid path, so they opt in
  // explicitly. Everything else refuses, which is why a forgotten skip is free.
  beforeEach(() => {
    __allowPaidRequestsForTest(true);
  });
  afterEach(() => {
    __allowPaidRequestsForTest(false);
  });

  function okResponse(): Response {
    return new Response(JSON.stringify({ image: "AA==", model: "test" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  test("refuses a concurrent paid call and says how long the first has run", async () => {
    const original = globalThis.fetch;
    let settle: (value: Response) => void = () => undefined;
    const pending = new Promise<Response>((resolve) => {
      settle = resolve;
    });
    globalThis.fetch = mock(async () => await pending) as unknown as typeof fetch;

    try {
      const first = generateImage({ prompt: "a knight" });
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(paidRequestInFlight()).toBe(true);

      let refusal = "";
      try {
        await generateImage({ prompt: "another knight" });
      } catch (error) {
        refusal = error instanceof Error ? error.message : String(error);
      }
      expect(refusal).toContain("still running");
      expect(refusal).toContain("paid image generation");

      settle(okResponse());
      await first;
      expect(paidRequestInFlight()).toBe(false);
    } finally {
      globalThis.fetch = original;
    }
  });

  test("allows a second call once the first finishes", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = mock(async () => okResponse()) as unknown as typeof fetch;
    try {
      await generateImage({ prompt: "one" });
      await generateImage({ prompt: "two" });
      expect(paidRequestInFlight()).toBe(false);
    } finally {
      globalThis.fetch = original;
    }
  });

  /** A failure must not lock generation out for the rest of the session. */
  test("releases the guard when a call fails", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = mock(async () => {
      throw new Error("connection refused");
    }) as unknown as typeof fetch;
    try {
      let failed = false;
      try {
        await generateImage({ prompt: "one" });
      } catch {
        failed = true;
      }
      expect(failed).toBe(true);
      expect(paidRequestInFlight()).toBe(false);
    } finally {
      globalThis.fetch = original;
    }
  });
});

/**
 * The guard of last resort.
 *
 * Every test-level skip is a thing someone has to remember, and that has already
 * failed twice: a `network` flag covered two tests and not a third, and a newly
 * added paid tool bought an image from a run that reported green. This asserts
 * the refusal that does not depend on remembering.
 */
describe("no test run can spend money", () => {
  test("a paid call is refused even with fetch mocked to succeed", async () => {
    const original = globalThis.fetch;
    let called = false;
    globalThis.fetch = mock(async () => {
      called = true;
      return new Response(JSON.stringify({ image: "AA==", model: "test" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    try {
      let refusal = "";
      try {
        await generateImage({ prompt: "an expensive mistake" });
      } catch (error) {
        refusal = error instanceof Error ? error.message : String(error);
      }
      expect(refusal).toContain("Refusing to make a paid");
      // The request never left, so nothing could have been charged.
      expect(called).toBe(false);
    } finally {
      globalThis.fetch = original;
    }
  });

});

/**
 * The chat loop is a paid path too, and was outside the guard entirely.
 *
 * Its tools declared `network: true`, but the declaration protects the tool —
 * the spending happens in `requestTurn`, and nothing guarded that. A test
 * touching the loop without mocking `fetch` would have bought completions from
 * a run that reported green. This is the same hole one level down from the two
 * undeclared tools, and it was in my own file.
 */
describe("the chat loop is guarded too", () => {
  test("a chat turn is refused from a test run, even with fetch mocked", async () => {
    const original = globalThis.fetch;
    let called = false;
    globalThis.fetch = mock(async () => {
      called = true;
      return new Response(JSON.stringify({ message: { role: "assistant", content: "hi" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    try {
      let refusal = "";
      try {
        await runChat([{ role: "user", content: "hello" }], { tools: [] });
      } catch (error) {
        refusal = error instanceof Error ? error.message : String(error);
      }
      expect(refusal).toContain("Refusing to make a paid");
      expect(called).toBe(false);
    } finally {
      globalThis.fetch = original;
    }
  });

  /**
   * Categories are separate on purpose: a generation runs for minutes, and
   * blocking the assistant behind it would make chat unusable exactly when
   * someone is waiting and most likely to ask a question.
   */
  test("a running generation does not block a chat turn", async () => {
    __allowPaidRequestsForTest(true);
    const original = globalThis.fetch;
    let settle: (value: Response) => void = () => undefined;
    const pending = new Promise<Response>((resolve) => {
      settle = resolve;
    });

    let calls = 0;
    globalThis.fetch = mock(async (input: unknown) => {
      calls += 1;
      if (String(input).includes("/v1/generate")) return await pending;
      return new Response(JSON.stringify({ message: { role: "assistant", content: "answered" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    try {
      const generation = generateImage({ prompt: "a slow knight" });
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(paidRequestInFlight("image")).toBe(true);

      // The chat turn goes through while the image is still in flight.
      const result = await runChat([{ role: "user", content: "hello" }], { tools: [] });
      expect(result.messages[0]?.content).toBe("answered");

      settle(
        new Response(JSON.stringify({ image: "AA==", model: "test" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
      await generation;
      expect(calls).toBe(2);
    } finally {
      globalThis.fetch = original;
      __allowPaidRequestsForTest(false);
    }
  });
});
