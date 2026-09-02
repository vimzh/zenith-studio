"use client";

import { useMemo } from "react";
import { toolsForContext, useModelContextSurface, useScopeContext } from "@/lib/webmcp";
import { RegisteredTool } from "./registered-tool";

/**
 * Registers the tools the current view can act on, and only those.
 *
 * Not every tool, every time: a flat catalogue past forty measurably degrades an
 * agent's choice of which to call, so a character is never offered tileset
 * tools and a single-frame tile is never offered frame diffing. Because each
 * tool is its own component keyed by name, React unmounts the ones that leave
 * scope, and their `AbortSignal` unregisters them — the list shrinks and grows
 * with the view rather than being registered once and filtered after.
 */
export function WebMCPTools() {
  const surface = useModelContextSurface();
  const context = useScopeContext();
  const tools = useMemo(() => toolsForContext(context), [context]);

  return (
    <>
      {tools.map((definition) => (
        <RegisteredTool definition={definition} key={definition.name} surface={surface} />
      ))}
    </>
  );
}
