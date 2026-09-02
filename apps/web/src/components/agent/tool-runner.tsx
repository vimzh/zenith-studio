"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Play } from "lucide-react";
import { TOOL_GROUPS, findTool, runTool, toolRunnerState, useToolRunnerState } from "@/lib/webmcp";
import { agentConsoleCopy } from "@/data/agent";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const { runner } = agentConsoleCopy;

/**
 * Runs any tool by hand, through the same handler an agent calls.
 *
 * Two jobs. It is the demo fallback for a judge whose browser has no WebMCP
 * client, which the hackathon rules make a real possibility — and because it
 * shares `runTool` with the agent path, what it proves is the actual tool
 * surface rather than a parallel implementation that might drift from it.
 *
 * The selection lives in `toolRunnerState` rather than here so the command
 * palette can jump straight to a tool, and so it survives the remount that a
 * route change causes.
 */
export function ToolRunner() {
  const { name, args, focusRequest } = useToolRunnerState();
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const argsRef = useRef<HTMLTextAreaElement | null>(null);

  const definition = useMemo(() => findTool(name), [name]);

  // Only when something asked for it — the palette. Selecting from the dropdown
  // must not yank focus out of the dropdown.
  useEffect(() => {
    if (focusRequest === 0) return;
    argsRef.current?.focus();
    argsRef.current?.select();
  }, [focusRequest]);

  const onRun = useCallback(async () => {
    if (definition === undefined) return;

    let parsed: unknown;
    try {
      parsed = args.trim() === "" ? {} : JSON.parse(args);
    } catch (parseError) {
      setError(parseError instanceof Error ? parseError.message : runner.invalidJson);
      return;
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      setError(runner.invalidJson);
      return;
    }

    setError(null);
    setRunning(true);
    try {
      // Failures are not thrown here: `runTool` records them in the transcript,
      // which is where the human is already looking.
      await runTool(definition, parsed as Record<string, unknown>, "console");
    } finally {
      setRunning(false);
    }
  }, [args, definition]);

  return (
    <section className="flex flex-col gap-1.5 border-t border-border px-2.5 py-2">
      <div className="flex items-baseline gap-2">
        <h3 className="text-xs font-medium">{runner.heading}</h3>
        {definition?.readOnly === true ? (
          <span className="rounded-sm bg-muted px-1 font-mono text-[0.65rem] text-muted-foreground">
            {runner.readOnlyBadge}
          </span>
        ) : null}
      </div>
      <p className="text-[0.7rem] leading-snug text-muted-foreground">{runner.hint}</p>

      <label className="sr-only" htmlFor="agent-tool-select">
        {runner.toolLabel}
      </label>
      <Select
        onValueChange={(value) => {
          setError(null);
          toolRunnerState.select(value);
        }}
        value={name}
      >
        <SelectTrigger className="w-full" id="agent-tool-select" size="sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent align="start" position="popper">
          {TOOL_GROUPS.map((group) => (
            <SelectGroup key={group.group}>
              <SelectLabel>{group.group}</SelectLabel>
              {group.tools.map((tool) => (
                <SelectItem key={tool.name} value={tool.name}>
                  {tool.name}
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>

      <label className="sr-only" htmlFor="agent-tool-args">
        {runner.argumentsLabel}
      </label>
      <Textarea
        className="max-h-40 min-h-14 resize-y font-mono text-[0.7rem] leading-snug"
        id="agent-tool-args"
        ref={argsRef}
        spellCheck={false}
        value={args}
        onChange={(event) => toolRunnerState.setArgs(event.target.value)}
      />

      {error === null ? null : <p className="text-[0.7rem] text-destructive">{error}</p>}

      <Button className="self-start" size="sm" onClick={() => void onRun()} disabled={running}>
        <Play data-icon="inline-start" />
        {running ? runner.runningLabel : runner.runLabel}
      </Button>
    </section>
  );
}
