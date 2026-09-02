"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  type Grid,
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
import type { Joint, Pose } from "@/lib/skeleton";
import { contentBounds, estimateSkeleton, moveJointToPixel, poseToPixels } from "@/lib/skeleton";
import { bakeSkeletonPose, type AssetType } from "@/lib/editor";
import { EditorSecondarySidebar } from "./editor-secondary-sidebar";
import { ExportDialog } from "./export-dialog";
import { FrameTimeline } from "./frame-timeline";
import { PixelCanvas } from "./pixel-canvas";
import { ToolRail } from "./tool-rail";
import { SHORTCUT_TO_TOOL, type ToolId } from "./tools";
import { useEditorController } from "./use-editor-controller";

const selectPalette = (store: DocumentStore) => paletteHexes(store.palette);
const selectContentBounds = (store: DocumentStore) => contentBounds(store.readComposite());

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
  const [skeleton, setSkeleton] = useState<Pose | null>(null);
  const rigBase = useRef<Pose | null>(null);
  const rigSource = useRef<Grid | null>(null);
  const spaceHeld = useRef(false);
  const skeletonBounds = useStoreSelector(store, selectContentBounds);

  const onSkeleton = useCallback((pose: Pose | null) => {
    if (pose === null) {
      rigBase.current = null;
      rigSource.current = null;
    } else if (rigBase.current === null) {
      rigBase.current = pose;
      rigSource.current = store.readComposite();
    }
    setSkeleton(pose);
  }, [store]);

  const moveSkeletonJoint = useCallback((joint: string, x: number, y: number) => {
    if (skeletonBounds === null) return;
    setSkeleton((current) => current === null
      ? null
      : moveJointToPixel(
          current,
          joint as Joint,
          {
            x: Math.max(0, Math.min(store.width - 1, x)),
            y: Math.max(0, Math.min(store.height - 1, y)),
          },
          skeletonBounds,
        ));
  }, [skeletonBounds, store.height, store.width]);

  const onSkeletonBake = useCallback(() => {
    if (skeleton === null || rigBase.current === null || rigSource.current === null) {
      throw new Error("Estimate a skeleton before creating a posed frame.");
    }
    return bakeSkeletonPose(store, rigSource.current, rigBase.current, skeleton);
  }, [skeleton, store]);

  /**
   * Joint markers in art coordinates.
   *
   * Poses are normalised to the content bounds, so they must be projected
   * through the sprite's own extent — a pose is proportions, not pixels, which
   * is exactly what makes it transferable between characters.
   */
  const skeletonJoints = useMemo(() => {
    if (skeleton === null || skeletonBounds === null) return undefined;
    return Object.entries(poseToPixels(skeleton, skeletonBounds)).map(([joint, position]) => ({
      joint,
      x: position.x,
      y: position.y,
    }));
  }, [skeleton, skeletonBounds]);

  // Below ~1100px the secondary sidebar becomes an overlay drawer rather than
  // squeezing the canvas to nothing.
  const isNarrow = useNarrowViewport();

  const revision = useStoreRevision(store);
  const palette = useStoreSelector(store, selectPalette);

  const onPickColor = useCallback((picked: Cell) => {
    setIndex(picked);
    setTool("pencil");
  }, []);

  const controller = useEditorController({
    store,
    tool,
    index,
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
        onSkeleton(skeleton === null ? estimateSkeleton(store.readComposite()) : null);
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
          const next = (current === TRANSPARENT ? 0 : current) + step;
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
  }, [onSkeleton, palette.length, skeleton, store]);

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
                  onSkeletonMove={skeleton === null ? undefined : moveSkeletonJoint}
                  onResize={setViewSize}
                  onWheel={controller.onWheel}
                  onionSkin={onionSkin}
                  showGrid={showGrid}
                  selection={controller.selection}
                  skeleton={skeletonJoints}
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
                  onSkeleton={onSkeleton}
                  onSkeletonBake={onSkeletonBake}
                  paletteIndex={index}
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
                onSkeleton={onSkeleton}
                onSkeletonBake={onSkeletonBake}
                paletteIndex={index}
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
