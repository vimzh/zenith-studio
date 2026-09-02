/**
 * The tool layer's shared vocabulary.
 *
 * A tool is a plain definition — name, description, schema, handler. Nothing in
 * here knows about WebMCP or React, which is what lets the same definition serve
 * two callers: `document.modelContext.registerTool` for an agent, and the Agent
 * Console for a human on a browser without WebMCP.
 */

import type { ToolScope } from "./scope";

/** A JSON Schema object, as `registerTool` expects it. */
export interface ToolInputSchema {
  readonly type: "object";
  readonly properties: Readonly<Record<string, unknown>>;
  readonly required?: readonly string[];
}

export type ToolArgs = Readonly<Record<string, unknown>>;

export interface ToolDefinition {
  readonly name: string;
  /** Where this tool is offered. Defaults to `editor`. See `scope.ts`. */
  readonly scope?: ToolScope;
  /**
   * What the agent reads. Names the page state it acts on, the coordinate
   * origin for anything positional, and the valid range of every argument.
   */
  readonly description: string;
  readonly inputSchema: ToolInputSchema;
  /** Sets `readOnlyHint`. True for anything that only perceives. */
  readonly readOnly?: boolean;
  /**
   * True when the handler calls a paid model through the API.
   *
   * Declared rather than inferred from the name, so tests can refuse to run
   * these — a suite that spends money is a suite nobody runs — and so the cost
   * is visible at the definition instead of remembered in a pattern elsewhere.
   */
  readonly network?: boolean;
  /** Returns text an agent can act on. Throws {@link ToolError} to fail. */
  readonly execute: (args: ToolArgs) => string | Promise<string>;
  /** Prefilled arguments for the Agent Console runner, so it is usable without typing JSON. */
  readonly example?: Readonly<Record<string, unknown>>;
}

/**
 * A tool failure with a message the agent can act on.
 *
 * Handlers throw this rather than returning an error string: registration turns
 * it into `isError: true`, and an error that reads as success is worse than none.
 */
export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolError";
  }
}

export interface ToolOutcome {
  readonly ok: boolean;
  readonly text: string;
}
