/**
 * The agentic loop.
 *
 * The model runs on the server; the tools run here. One user message can take
 * several turns — read the canvas, make an edit, check the result, fix it — and
 * every one of those tool calls executes locally against the same store the
 * human is drawing on, through the same `runTool` the Agent Console uses. So the
 * transcript shows agent and human calls side by side, and `Ctrl+Z` undoes the
 * agent's work, because there was never a second code path to diverge.
 *
 * The server sees messages and tool schemas. It never sees the canvas.
 */

import { API_BASE, paidChatRequest } from "./api";
import { toOpenAiTools, type OpenAiTool } from "./chat-tools";
import { runTool } from "./run";
import { ToolError, type ToolDefinition } from "./types";

/** Bounds a runaway conversation. Eight turns is far more than any real request needs. */
export const MAX_TURNS = 8;

export interface ToolCall {
  readonly id: string;
  readonly type: "function";
  readonly function: { readonly name: string; readonly arguments: string };
}

export interface ChatMessage {
  readonly role: "system" | "user" | "assistant" | "tool";
  readonly content: string | null;
  readonly tool_calls?: readonly ToolCall[];
  readonly tool_call_id?: string;
}

export interface ChatTurn {
  readonly message: ChatMessage;
  readonly finishReason: string | null;
  readonly model: string;
}

interface ChatFailure {
  readonly error?: { readonly code?: string; readonly message?: string };
}

/**
 * Asks the relay for one model turn.
 *
 * Failures are described rather than thrown raw: the difference between "this
 * deployment cannot chat" and "the model errored" changes what the human should
 * do, and only the first is worth abandoning over.
 */
export async function requestTurn(
  messages: readonly ChatMessage[],
  tools: readonly OpenAiTool[],
): Promise<ChatTurn> {
  let response: Response;
  try {
    // Through the paid guard, not a bare fetch. A chat turn costs money and the
    // loop makes up to eight per user message — this was outside the guard
    // entirely, which meant no timeout and, worse, nothing stopping a test that
    // forgot to mock fetch from buying completions.
    response = await paidChatRequest((signal) =>
      fetch(`${API_BASE}/v1/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages, tools }),
        signal,
      }),
    );
  } catch (error) {
    if (error instanceof ToolError) throw error;
    throw new ToolError(
      `Could not reach the chat service at ${API_BASE}: ${error instanceof Error ? error.message : String(error)}. ` +
        `The editor and every tool still work; only chat is unavailable.`,
    );
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ChatFailure;
    const code = body.error?.code ?? "unknown";
    const message = body.error?.message ?? `The chat service returned ${String(response.status)}.`;
    if (code === "rate_limited") {
      throw new ToolError(`${message} This limit exists so a public URL cannot run up a bill.`);
    }
    throw new ToolError(message);
  }

  const body = (await response.json()) as {
    message?: ChatMessage;
    finishReason?: string | null;
    model?: string;
  };
  if (body.message === undefined) {
    throw new ToolError("The chat service returned no message.");
  }
  return {
    message: body.message,
    finishReason: body.finishReason ?? null,
    model: body.model ?? "unknown",
  };
}

export interface ChatRunOptions {
  /** A live provider refreshes capabilities after type, frame, or direction changes. */
  readonly tools: readonly ToolDefinition[] | (() => readonly ToolDefinition[]);
  /** Called after every appended message, so the UI can render as it goes. */
  readonly onMessage?: (message: ChatMessage) => void;
  readonly maxTurns?: number;
  readonly signal?: AbortSignal;
}

export interface ChatRunResult {
  readonly messages: readonly ChatMessage[];
  /** True when the loop stopped because it ran out of turns rather than finishing. */
  readonly exhausted: boolean;
}

function parseArguments(call: ToolCall): Record<string, unknown> {
  if (call.function.arguments.trim() === "") return {};
  try {
    const parsed: unknown = JSON.parse(call.function.arguments);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("arguments must be a JSON object");
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    // Returned to the model as a tool result rather than thrown: a malformed
    // call is something it can correct on the next turn, and abandoning the
    // whole conversation over one bad argument list would be worse.
    throw new ToolError(
      `Could not parse arguments for ${call.function.name}: ${error instanceof Error ? error.message : String(error)}. ` +
        `Send a JSON object matching the tool's schema.`,
    );
  }
}

/**
 * Runs the conversation until the model stops asking for tools.
 *
 * Returns every message appended, including tool results, so the caller can
 * render the whole exchange rather than only the final answer — watching the
 * agent read, edit and re-check is most of what makes it trustworthy.
 */
export async function runChat(
  history: readonly ChatMessage[],
  options: ChatRunOptions,
): Promise<ChatRunResult> {
  const messages: ChatMessage[] = [...history];
  const appended: ChatMessage[] = [];
  const maxTurns = options.maxTurns ?? MAX_TURNS;

  const append = (message: ChatMessage): void => {
    messages.push(message);
    appended.push(message);
    options.onMessage?.(message);
  };

  for (let turn = 0; turn < maxTurns; turn += 1) {
    if (options.signal?.aborted === true) break;

    const tools = typeof options.tools === "function" ? options.tools() : options.tools;
    const schemas = toOpenAiTools(tools);
    const byName = new Map(tools.map((tool) => [tool.name, tool]));
    const result = await requestTurn(messages, schemas);
    append(result.message);

    const calls = result.message.tool_calls ?? [];
    if (calls.length === 0) {
      return { messages: appended, exhausted: false };
    }

    for (const call of calls) {
      const definition = byName.get(call.function.name);
      if (definition === undefined) {
        append({
          role: "tool",
          tool_call_id: call.id,
          content: `No tool named '${call.function.name}' is available here. Available: ${[...byName.keys()].join(", ")}.`,
        });
        continue;
      }

      let text: string;
      try {
        const args = parseArguments(call);
        const outcome = await runTool(definition, args, "agent");
        text = outcome.ok ? outcome.text : `Error: ${outcome.text}`;
      } catch (error) {
        text = `Error: ${error instanceof Error ? error.message : String(error)}`;
      }
      append({ role: "tool", tool_call_id: call.id, content: text });
    }
  }

  return { messages: appended, exhausted: true };
}
