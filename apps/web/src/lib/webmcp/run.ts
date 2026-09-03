import { transcript, type ToolCallSource } from "./transcript";
import { ToolError, type ToolArgs, type ToolDefinition, type ToolOutcome } from "./types";
import { session } from "@/lib/editor/session";
import { assetRouteId } from "./navigation";

/**
 * The single path every tool call takes.
 *
 * Both front doors come through here — a WebMCP agent and a human clicking Run
 * in the Agent Console — so the transcript is a complete record and the console
 * is a genuine fallback rather than a parallel implementation that might behave
 * differently on the day.
 */
export async function runTool(
  definition: ToolDefinition,
  args: ToolArgs,
  source: ToolCallSource,
): Promise<ToolOutcome> {
  const started = performance.now();
  try {
    if (typeof window !== "undefined" && definition.scope !== "always") {
      const visibleId = assetRouteId(window.location.pathname);
      if (visibleId === null || visibleId !== session.activeId || session.get(visibleId) === undefined) {
        throw new ToolError("The visible asset and active editing target do not agree. Wait for navigation to finish or reopen the asset before running editor tools.");
      }
    }
    const text = await definition.execute(args);
    const outcome: ToolOutcome = { ok: true, text };
    transcript.record({
      tool: definition.name,
      source,
      args,
      status: "ok",
      result: text,
      durationMs: performance.now() - started,
    });
    return outcome;
  } catch (error) {
    // Never let a raw exception reach the agent: a stack trace is unactionable,
    // and the store's own messages already say what to do instead.
    const text = error instanceof Error ? error.message : String(error);
    transcript.record({
      tool: definition.name,
      source,
      args,
      status: "error",
      result: text,
      durationMs: performance.now() - started,
    });
    return { ok: false, text };
  }
}

/** Runs a tool for WebMCP, rethrowing failures so the hook marks the result `isError`. */
export async function runToolForAgent(definition: ToolDefinition, args: ToolArgs): Promise<string> {
  const outcome = await runTool(definition, args, "agent");
  if (!outcome.ok) throw new ToolError(outcome.text);
  return outcome.text;
}
