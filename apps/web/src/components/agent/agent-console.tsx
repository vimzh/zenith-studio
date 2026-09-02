"use client";

import { MessageSquare, ScrollText, Wrench } from "lucide-react";
import type { Region } from "@zenith/core";
import { agentConsoleCopy } from "@/data/agent";
import { toolRunnerState, useToolRunnerState, type AgentPanel } from "@/lib/webmcp";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AgentChat } from "./agent-chat";
import { AgentNavigation } from "./agent-navigation";
import { ToolRunner } from "./tool-runner";
import { ToolTranscript } from "./tool-transcript";
import { WebMCPStatusBadge } from "./webmcp-status-badge";

/**
 * The agent's half of the editor.
 *
 * Registration lives in the app shell so tools remain available when this
 * panel is collapsed; this component only renders status and controls.
 *
 * `selection` is required, not optional with a null default. It was optional
 * once, and both call sites forgot it: the chat typechecked, ran, and told the
 * model there was no selection every time while a marquee sat on the canvas.
 * Requiring it turns that into a compile error instead of a silent lie.
 */
export function AgentConsole({ selection }: { selection: Region | null }) {
  // The visible panel lives in `toolRunnerState`, not here. Two things drive it
  // — the user clicking a tab and the command palette jumping to a tool — and
  // deriving it from `focusRequest` in an effect meant setting state from an
  // effect. Revealing the runner is part of the jump, not something to observe
  // after the fact: an inactive tab panel is unmounted, so focusing an argument
  // field on a hidden panel focuses nothing.
  const { panel } = useToolRunnerState();

  return (
    <aside className="flex h-full min-h-0 flex-col bg-background">
      <AgentNavigation />

      <header className="flex flex-col gap-1.5 border-b border-border px-2.5 py-2">
        <div className="flex items-baseline gap-2">
          <h2 className="text-xs font-semibold tracking-wide uppercase">
            {agentConsoleCopy.title}
          </h2>
          <p className="truncate text-[0.7rem] text-muted-foreground">
            {agentConsoleCopy.subtitle}
          </p>
        </div>
        <WebMCPStatusBadge />
      </header>

      <Tabs
        onValueChange={(next) => toolRunnerState.setPanel(next as AgentPanel)}
        className="min-h-0 flex-1 gap-0"
        value={panel}
      >
        <TabsList
          aria-label="Agent sidebar sections"
          className="h-9 w-full shrink-0 justify-start rounded-none border-b border-border px-2"
          variant="line"
        >
          <TabsTrigger className="font-mono text-[11px]" value="chat">
            <MessageSquare aria-hidden data-icon="inline-start" />
            Chat
          </TabsTrigger>
          <TabsTrigger className="font-mono text-[11px]" value="activity">
            <ScrollText aria-hidden data-icon="inline-start" />
            Activity
          </TabsTrigger>
          <TabsTrigger className="font-mono text-[11px]" value="tools">
            <Wrench aria-hidden data-icon="inline-start" />
            Tools
          </TabsTrigger>
        </TabsList>

        <TabsContent className="m-0 flex min-h-0 flex-col" value="chat">
          <AgentChat selection={selection} />
        </TabsContent>
        <TabsContent className="m-0 flex min-h-0 flex-col" value="activity">
          <ToolTranscript />
        </TabsContent>
        <TabsContent className="m-0 min-h-0 overflow-y-auto" value="tools">
          <ToolRunner />
        </TabsContent>
      </Tabs>
    </aside>
  );
}
