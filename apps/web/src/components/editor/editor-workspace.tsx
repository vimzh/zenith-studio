"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Download,
  Grid3x3,
  PanelRight,
  Redo2,
  Undo2,
} from "lucide-react";
import Link from "next/link";
import {
  TRANSPARENT,
  paletteHexes,
  type Cell,
  type DocumentStore,
} from "@zenith/core";
import { Button } from "@/components/ui/button";
import { useStoreRevision, useStoreSelector } from "@/lib/pixel";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { useNarrowViewport } from "@/hooks/use-narrow-viewport";
import { cn } from "@/lib/utils";
import type { AssetType } from "@/lib/editor";
import { EditorSecondarySidebar } from "./editor-secondary-sidebar";
import { useSkeletonRig } from "./use-skeleton-rig";
import { ExportDialog } from "./export-dialog";
import { FrameTimeline } from "./frame-timeline";
import { PixelCanvas } from "./pixel-canvas";
import { ToolRail } from "./tool-rail";
import { clampPaletteIndex, SHORTCUT_TO_TOOL, type ToolId } from "./tools";
import { useEditorController } from "./use-editor-controller";

const selectPalette = (store: DocumentStore) => paletteHexes(store.palette);

export function EditorWorkspace({
  assetId,
  name,
  store,
  type,
}: {
  assetId: string;
  name: string;
  store: DocumentStore;
  type: AssetType;
}) {
  const [tool, setTool] = useState<ToolId>("pencil");
  const [index, setIndex] = useState<Cell>(0);
  const [showGrid, setShowGrid] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [onionSkin, setOnionSkin] = useState(false);
  const [brushSize, setBrushSize] = useState(1);
  const [opacity, setOpacity] = useState(100);
  const spaceHeld = useRef(false);
  const rig = useSkeletonRig(store);
  const { controller: skeleton } = rig;

  // Below ~1100px the secondary sidebar becomes an overlay drawer rather than
  // squeezing the canvas to nothing.
  const isNarrow = useNarrowViewport();

  const revision = useStoreRevision(store);
  const palette = useStoreSelector(store, selectPalette);
  const selectedIndex = clampPaletteIndex(index, palette.length);

  const onPickColor = useCallback((picked: Cell) => {
    setIndex(picked);
    setTool("pencil");
  }, []);

  const controller = useEditorController({
    store,
    tool,
    index: selectedIndex,
    onPickColor,
    brushSize,
    opacity,
  });

  // Centre the document the first time the canvas reports a real size. Only
  // once: re-fitting on every resize would fight the user's own pan and zoom.
  // The controller needs the surface size continuously — focus_viewport
  // computes a zoom from it, and auto-fit re-runs until the user takes over.
  const { setViewSize } = controller;

  // Keyboard: tool shortcuts, undo/redo, palette cycling.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA") {
        return;
      }

      const key = event.key.toLowerCase();

      if (key === " ") {
        spaceHeld.current = true;
        event.preventDefault();
        return;
      }

      if (key === "e" && spaceHeld.current) {
        event.preventDefault();
        if (skeleton.pose !== null) {
          skeleton.hide();
        } else {
          // An empty frame has nothing to rig; the panel reports that, the shortcut stays quiet.
          try {
            skeleton.estimate();
          } catch {
            // Nothing to estimate from.
          }
        }
        return;
      }

      if ((event.metaKey || event.ctrlKey) && key === "s") {
        event.preventDefault();
        setExporting(true);
        return;
      }

      if ((event.metaKey || event.ctrlKey) && key === "z") {
        event.preventDefault();
        if (event.shiftKey) {
          store.redo();
        } else {
          store.undo();
        }
        return;
      }

      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      const mapped = SHORTCUT_TO_TOOL[key];
      if (mapped !== undefined) {
        event.preventDefault();
        setTool(mapped);
        return;
      }

      if (key === "[" || key === "]") {
        event.preventDefault();
        setIndex((current) => {
          const step = key === "]" ? 1 : -1;
          const selected = clampPaletteIndex(current, palette.length);
          const next = (selected === TRANSPARENT ? 0 : selected) + step;
          if (next < 0) return palette.length - 1;
          if (next >= palette.length) return 0;
          return next;
        });
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === " ") spaceHeld.current = false;
    };
    const releaseSpace = () => { spaceHeld.current = false; };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", releaseSpace);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", releaseSpace);
    };
  }, [palette.length, skeleton, store]);

  // Opens the dialog rather than firing one format: there are eleven now, and
  // guessing which the user wanted is worse than asking.
  const onExport = useCallback(() => setExporting(true), []);

  const { cursor, viewport } = controller;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-11 shrink-0 items-center gap-3 border-b border-border px-3">
        <Button asChild size="icon-sm" variant="ghost">
          <Link aria-label="Back to assets" href="/home" title="Back to assets">
            <ArrowLeft aria-hidden className="size-4" strokeWidth={1.5} />
          </Link>
        </Button>
        <span className="text-sm font-medium tracking-tight">{name}</span>
        <span className="font-mono text-[11px] text-muted-foreground">
          {store.width}×{store.height}
          <span className="mx-2 text-border">·</span>
          {viewport.zoom}×<span className="mx-2 text-border">·</span>
          {cursor ? `${cursor.x}, ${cursor.y}` : "—, —"}
        </span>

        <div className="ml-auto flex items-center gap-1">
          <IconButton
            disabled={!store.canUndo}
            icon={Undo2}
            label="Undo"
            onClick={() => store.undo()}
          />
          <IconButton
            disabled={!store.canRedo}
            icon={Redo2}
            label="Redo"
            onClick={() => store.redo()}
          />
          <IconButton
            active={showGrid}
            icon={Grid3x3}
            label="Toggle pixel grid"
            onClick={() => setShowGrid((value) => !value)}
          />
          <IconButton icon={Download} label="Export PNG" onClick={onExport} />
          {isNarrow ? (
            <IconButton
              active={drawerOpen}
              icon={PanelRight}
              label="Toggle secondary sidebar"
              onClick={() => setDrawerOpen((value) => !value)}
            />
          ) : null}
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1">
        <ToolRail
          active={tool}
          brushSize={brushSize}
          onBrushSize={setBrushSize}
          onSelect={setTool}
        />

        <ResizablePanelGroup
          className="min-w-0 flex-1"
          orientation="horizontal"
        >
          <ResizablePanel className="min-w-0" id="canvas">
            <div className="flex size-full flex-col bg-[#161616]">
              <div className="min-h-0 flex-1">
                <PixelCanvas
                  className={cn(
                    "size-full",
                    tool === "pan" ? "cursor-grab" : "cursor-crosshair",
                  )}
                  onPointerDown={controller.onPointerDown}
                  onPointerLeave={controller.onPointerLeave}
                  onPointerMove={controller.onPointerMove}
                  onPointerUp={controller.onPointerUp}
                  onSkeletonMove={rig.joints === undefined ? undefined : rig.moveJoint}
                  preview={rig.preview}
                  onResize={setViewSize}
                  onWheel={controller.onWheel}
                  onionSkin={onionSkin}
                  showGrid={showGrid}
                  selection={controller.selection}
                  skeleton={rig.joints}
                  store={store}
                  viewport={viewport}
                />
              </div>
              <FrameTimeline
                onToggleOnionSkin={() => setOnionSkin((value) => !value)}
                onionSkin={onionSkin}
                store={store}
              />
            </div>
          </ResizablePanel>

          {isNarrow ? null : (
            <>
              <ResizableHandle aria-label="Resize secondary sidebar" />
              <ResizablePanel
                defaultSize={320}
                groupResizeBehavior="preserve-pixel-size"
                maxSize={520}
                minSize={240}
              >
                <EditorSecondarySidebar
                  assetId={assetId}
                  onPaletteSelect={setIndex}
                  onOpacity={setOpacity}
                  opacity={opacity}
                  paletteIndex={selectedIndex}
                  revision={revision}
                  selection={controller.selection}
                  skeleton={skeleton}
                  store={store}
                  type={type}
                />
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>

        {exporting ? (
          <ExportDialog
            name={name}
            onClose={() => setExporting(false)}
            store={store}
          />
        ) : null}

        {isNarrow && drawerOpen ? (
          <>
            <Button
              aria-label="Close secondary sidebar"
              className="absolute inset-0 z-10 h-auto w-auto rounded-none bg-black/40 p-0 hover:bg-black/40"
              onClick={() => setDrawerOpen(false)}
              size="icon"
              type="button"
              variant="ghost"
            />
            <div className="absolute inset-y-0 right-0 z-20 w-[min(360px,85vw)] min-h-0 shadow-lg">
              <EditorSecondarySidebar
                assetId={assetId}
                onPaletteSelect={setIndex}
                onOpacity={setOpacity}
                opacity={opacity}
                paletteIndex={selectedIndex}
                revision={revision}
                selection={controller.selection}
                skeleton={skeleton}
                store={store}
                type={type}
              />
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

function IconButton({
  active,
  disabled,
  icon: Icon,
  label,
  onClick,
}: {
  active?: boolean;
  disabled?: boolean;
  icon: typeof Undo2;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      aria-label={label}
      aria-pressed={active}
      className={cn(
        active
          ? "bg-accent text-accent-foreground"
          : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
      )}
      disabled={disabled}
      onClick={onClick}
      size="icon-sm"
      title={label}
      type="button"
      variant="ghost"
    >
      <Icon aria-hidden className="size-4" strokeWidth={1.5} />
    </Button>
  );
}
