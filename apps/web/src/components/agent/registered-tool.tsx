"use client";

import { useEffect } from "react";
import {
  registerModelContextTool,
  registrationStatus,
  runToolForAgent,
  type ModelContextSurface,
  type ToolArgs,
  type ToolDefinition,
} from "@/lib/webmcp";

/**
 * Registers one tool with the browser's model context for as long as it is mounted.
 *
 * One component per tool gives each registration its own lifecycle and leaves
 * no ghost tools in the inspector when the editor unmounts.
 */
export function RegisteredTool({
  definition,
  surface,
}: {
  definition: ToolDefinition;
  surface: ModelContextSurface;
}) {
  useEffect(() => {
    if (surface === "none") {
      registrationStatus.set(definition.name, { supported: false, registered: false, error: null });
      return () => registrationStatus.clear(definition.name);
    }

    const controller = new AbortController();
    try {
      registerModelContextTool(
        {
          name: definition.name,
          description: definition.description,
          inputSchema: definition.inputSchema,
          annotations: { readOnlyHint: definition.readOnly === true },
          async execute(args: ToolArgs | undefined) {
            try {
              const text = await runToolForAgent(definition, args ?? {});
              return { content: [{ type: "text", text }] };
            } catch (error) {
              return {
                content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
                isError: true,
              };
            }
          },
        },
        controller.signal,
        (error) =>
          registrationStatus.set(definition.name, {
            supported: true,
            registered: false,
            error: error instanceof Error ? error : new Error(String(error)),
          })
      );
      registrationStatus.set(definition.name, { supported: true, registered: true, error: null });
    } catch (error) {
      registrationStatus.set(definition.name, {
        supported: true,
        registered: false,
        error: error instanceof Error ? error : new Error(String(error)),
      });
    }

    return () => {
      controller.abort();
      registrationStatus.clear(definition.name);
    };
  }, [definition, surface]);

  return null;
}
