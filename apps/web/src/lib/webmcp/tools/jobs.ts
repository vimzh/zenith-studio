/** Async front door for the existing paid catalogue; the resolver avoids a registry import cycle. */
import { readString } from "../args";
import { ToolJobs } from "../jobs";
import { ToolError, type ToolArgs, type ToolDefinition } from "../types";

export function createToolJobTools(resolve: (name: string) => ToolDefinition | undefined): {
  readonly startToolJob: ToolDefinition;
  readonly getToolJob: ToolDefinition;
} {
  const jobs = new ToolJobs();
  return {
    startToolJob: {
      name: "start_tool_job",
      scope: "always",
      network: true,
      description: "Start an available paid tool with normal arguments; returns JSON job_id/status immediately. request_id (1–128 chars) deduplicates same-input retries. One job at once: poll get_tool_job. Keep page open: 50 records until reload. No automatic retry/cancel; direct paid calls untracked.",
      inputSchema: {
        type: "object",
        properties: {
          tool: { type: "string", description: "Name of an existing paid tool available in the current view, such as animate_with_text or generate_asset." },
          arguments: { type: "object", description: "The selected tool's normal JSON arguments, unchanged." },
          request_id: { type: "string", minLength: 1, maxLength: 128, description: "Stable id for this one operation. Reuse it when retrying or recovering a timed-out start call." },
        },
        required: ["tool", "arguments", "request_id"],
      },
      example: { tool: "generate_asset", arguments: { prompt: "a bronze sword", type: "item", name: "Bronze sword" }, request_id: "bronze-sword-1" },
      execute: (args) => {
        const name = readString(args, "tool");
        const definition = resolve(name);
        if (definition === undefined) throw new ToolError(`Unknown tool '${name}'. Choose a paid tool from the registered catalogue.`);
        const parameters = args["arguments"];
        if (parameters === null || typeof parameters !== "object" || Array.isArray(parameters)) {
          throw new ToolError("'arguments' must be a JSON object containing the selected tool's normal inputs.");
        }
        return JSON.stringify(jobs.start(definition, parameters as ToolArgs, readString(args, "request_id")));
      },
    },
    getToolJob: {
      name: "get_tool_job",
      scope: "always",
      readOnly: true,
      description: "Read session-job JSON status, result/error, timestamps and visible/active/requested asset context. Never starts/retries/cancels calls. Reload loses tracking; unknown ID does not mean cancelled.",
      inputSchema: { type: "object", properties: { job_id: { type: "string", description: "job_id returned by start_tool_job in this page session." } }, required: ["job_id"] },
      example: { job_id: "job_id_from_start_tool_job" },
      execute: (args) => JSON.stringify(jobs.get(readString(args, "job_id"))),
    },
  };
}
