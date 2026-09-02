"use client";

import { Bot, SlidersHorizontal } from "lucide-react";
import type { Cell, DocumentStore } from "@zenith/core";
import { AgentConsole } from "@/components/agent";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { AssetType } from "@/lib/editor";
import type { Pose } from "@/lib/skeleton";
import { useToolRunnerState } from "@/lib/webmcp";
import { AssetPanel } from "./asset-panel";
import { PalettePanel } from "./palette-panel";
import { TilePreview } from "./tile-preview";

/** One tabbed secondary sidebar for asset controls and agent collaboration. */
export function EditorSecondarySidebar({
  assetId,
  onPaletteSelect,
  onOpacity,
  opacity,
  onSkeleton,
  onSkeletonBake,
  paletteIndex,
  revision,
  selection,
  skeleton,
  store,
  type,
}: {
  assetId: string;
  onPaletteSelect: (index: Cell) => void;
  onOpacity: (opacity: number) => void;
  opacity: number;
  onSkeleton: (pose: Pose | null) => void;
  onSkeletonBake: () => string;
  paletteIndex: Cell;
  revision: number;
  selection: Parameters<typeof AgentConsole>[0]["selection"];
  skeleton: Pose | null;
  store: DocumentStore;
  type: AssetType;
}) {
  const { focusRequest } = useToolRunnerState();

  return (
    <div className="flex h-full min-h-0 flex-col border-l border-border bg-card">
      <Tabs
        className="min-h-0 flex-1 gap-0"
        defaultValue={focusRequest === 0 ? "asset" : "agent"}
        key={focusRequest}
      >
        <TabsList
          aria-label="Secondary sidebar sections"
          className="h-9 w-full shrink-0 justify-start rounded-none border-b border-border px-2"
          variant="line"
        >
          <TabsTrigger className="font-mono text-[11px]" value="asset">
            <SlidersHorizontal aria-hidden data-icon="inline-start" />
            Asset
          </TabsTrigger>
          <TabsTrigger className="font-mono text-[11px]" value="agent">
            <Bot aria-hidden data-icon="inline-start" />
            Agent
          </TabsTrigger>
        </TabsList>

        <TabsContent className="m-0 min-h-0 overflow-y-auto" value="asset">
          <div className="flex flex-col items-center gap-2 p-3">
            <TilePreview key={revision} store={store} />
            <span className="font-mono text-[11px] text-muted-foreground">
              tiling preview
            </span>
          </div>
          <PalettePanel
            onOpacity={onOpacity}
            onSelect={onPaletteSelect}
            opacity={opacity}
            selected={paletteIndex}
            store={store}
          />
          <AssetPanel
            assetId={assetId}
            onSkeleton={onSkeleton}
            onSkeletonBake={onSkeletonBake}
            selection={selection}
            skeleton={skeleton}
            store={store}
            type={type}
          />
        </TabsContent>

        <TabsContent className="m-0 min-h-0" value="agent">
          <AgentConsole selection={selection} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
