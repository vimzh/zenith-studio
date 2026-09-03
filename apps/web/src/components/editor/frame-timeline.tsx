"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Copy, Layers, Pause, Play, Plus, Sparkles, Trash2 } from "lucide-react";
import { DEFAULT_FRAME_DURATION_MS, paletteHexes, type DocumentStore } from "@zenith/core";
import { animateProcedural, checkAnimationCoherence, type ProceduralPreset } from "@/lib/animation";
import { gridToImageData, useStoreRevision, useStoreSelector } from "@/lib/pixel";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { timelineCopy } from "@/data/agent";

/**
 * The frame timeline.
 *
 * Playback runs off `requestAnimationFrame` against a wall clock rather than a
 * `setInterval` at the frame duration: intervals drift, and a drifting preview
 * of a 12fps cycle is misleading about the thing being authored.
 */

const selectFrameCount = (store: DocumentStore) => store.frameCount;
const selectPalette = (store: DocumentStore) => paletteHexes(store.palette);
const selectDurations = (store: DocumentStore) => store.snapshot().frames.map((frame) => frame.durationMs);

const PRESETS: readonly { id: ProceduralPreset; label: string; frames: number }[] = [
  { id: "bob", label: "Bob", frames: 2 },
  { id: "blink", label: "Blink", frames: 4 },
  { id: "flicker", label: "Flicker", frames: 3 },
  { id: "pulse", label: "Pulse", frames: 4 },
  { id: "scroll", label: "Scroll", frames: 4 },
  { id: "sway", label: "Sway", frames: 4 },
];

export function FrameTimeline({
  onionSkin,
  onToggleOnionSkin,
  store,
}: {
  onionSkin: boolean;
  onToggleOnionSkin: () => void;
  store: DocumentStore;
}) {
  const revision = useStoreRevision(store);
  const frameCount = useStoreSelector(store, selectFrameCount);
  const palette = useStoreSelector(store, selectPalette);
  const durations = useStoreSelector(store, selectDurations);

  const [wantsPlayback, setWantsPlayback] = useState(false);
  const [showPresets, setShowPresets] = useState(false);
  const [coherence, setCoherence] = useState<readonly string[]>([]);
  const active = store.activeFrame;
  const duration = durations[active] ?? DEFAULT_FRAME_DURATION_MS;
  const uniformDuration = durations.every((value) => value === durations[0]);
  const fps = uniformDuration ? Number((1000 / (durations[0] ?? DEFAULT_FRAME_DURATION_MS)).toFixed(2)) : "";

  // A single-frame asset has nothing to animate; showing transport controls for
  // it invites the question "why is play doing nothing".
  const canPlay = frameCount > 1;
  // Derived rather than synced: deleting frames down to one stops playback
  // without an effect that writes state during render.
  const playing = wantsPlayback && canPlay;

  const raf = useRef<number | null>(null);
  const startedAt = useRef(0);

  useEffect(() => {
    if (!playing) {
      return;
    }

    startedAt.current = performance.now();
    const step = (now: number) => {
      const elapsed = now - startedAt.current;
      const frames = store.snapshot().frames;
      const total = frames.reduce((sum, frame) => sum + frame.durationMs, 0);
      let remaining = elapsed % total;
      let index = 0;
      while (index < frames.length - 1 && remaining >= (frames[index]?.durationMs ?? DEFAULT_FRAME_DURATION_MS)) {
        remaining -= frames[index]?.durationMs ?? DEFAULT_FRAME_DURATION_MS;
        index += 1;
      }
      if (index !== store.activeFrame) {
        store.selectFrame(index);
      }
      raf.current = requestAnimationFrame(step);
    };

    raf.current = requestAnimationFrame(step);
    return () => {
      if (raf.current !== null) {
        cancelAnimationFrame(raf.current);
        raf.current = null;
      }
    };
  }, [playing, frameCount, store]);

  const onAdd = useCallback(() => {
    store.addFrame({ copyFrom: store.activeFrame, at: store.activeFrame + 1 });
  }, [store]);

  const onDelete = useCallback(() => {
    if (store.frameCount > 1) {
      store.deleteFrame(store.activeFrame);
    }
  }, [store]);

  /**
   * Builds a procedural cycle from the current frame.
   *
   * Deterministic and instant — no model involved.
   *
   * The whole cycle is one transaction, so a preset the user dislikes is undone
   * with a single Ctrl+Z rather than one press per frame it added. That relies
   * on the store recording a transaction as ordered steps, which lets a
   * structural change join one — a frame change closes the step in progress and
   * starts a new one after it, and the whole thing commits as a compound entry.
   */
  const applyPreset = useCallback(
    (preset: ProceduralPreset, frames: number) => {
      const start = store.activeFrame;
      const base = store.readComposite(start);
      const palette = paletteHexes(store.palette);
      const cycle = animateProcedural(base, preset, { frames }, palette.length);

      store.transaction(`Animate: ${preset}`, () => {
        // Frame 0 of the cycle is the base, which is already on the canvas.
        cycle.slice(1).forEach((grid, offset) => {
          const at = start + offset + 1;
          store.addFrame({ at });
          store.selectFrame(at);
          store.writeRegion(0, 0, grid);
        });
      });
      store.selectFrame(start);

      const problems = checkAnimationCoherence(
        Array.from({ length: store.frameCount }, (_, index) => store.readComposite(index)),
        { paletteSize: palette.length }
      );
      setCoherence(problems.map((problem) => problem.message));
    },
    [store]
  );

  return (
    <div className="relative flex flex-col border-t border-border bg-card">
      {coherence.length > 0 ? (
        <ul className="border-b border-border px-3 py-1.5">
          {coherence.map((message) => (
            <li className="font-mono text-[11px] text-muted-foreground" key={message}>
              {message}
            </li>
          ))}
        </ul>
      ) : null}

      {showPresets ? (
        <div className="absolute bottom-full left-2 z-20 mb-1 flex flex-wrap gap-1 rounded-sm border border-border bg-background p-2">
          {PRESETS.map((preset) => (
            <Button
              className="rounded-sm border border-border px-2 py-1 text-xs hover:border-foreground/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              key={preset.id}
              onClick={() => {
                applyPreset(preset.id, preset.frames);
                setShowPresets(false);
              }}
              size="xs"
              type="button"
              variant="outline"
            >
              {preset.label}
            </Button>
          ))}
        </div>
      ) : null}

    <div className="flex items-center gap-2 px-2 py-1.5">
      <Button
        aria-label={playing ? "Pause" : "Play"}
        className={cn(
          "flex size-7 items-center justify-center rounded-sm text-muted-foreground transition-colors",
          "hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          "disabled:pointer-events-none disabled:opacity-40"
        )}
        disabled={!canPlay}
        onClick={() => setWantsPlayback((value) => !value)}
        size="icon-sm"
        type="button"
        variant="ghost"
      >
        {playing ? (
          <Pause aria-hidden className="size-4" strokeWidth={1.5} />
        ) : (
          <Play aria-hidden className="size-4" strokeWidth={1.5} />
        )}
      </Button>

      <ol className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
        {Array.from({ length: frameCount }, (_, index) => (
          <li key={index}>
            <Button
              aria-current={index === active ? "true" : undefined}
              aria-label={`Frame ${String(index + 1)}`}
              className={cn(
                "flex flex-col items-center gap-0.5 rounded-sm border p-1 transition-colors",
                index === active ? "border-foreground" : "border-border hover:border-foreground/30"
              )}
              onClick={() => store.selectFrame(index)}
              type="button"
              variant="ghost"
            >
              <FrameThumbnail
                key={revision}
                index={index}
                palette={palette}
                store={store}
              />
              <span className="font-mono text-[10px] text-muted-foreground">{index + 1}</span>
            </Button>
          </li>
        ))}
      </ol>

      <label className="flex items-center gap-1 font-mono text-[11px] text-muted-foreground">
        <Input
          aria-label="Frames per second"
          className="h-6 w-12 rounded-sm border border-border bg-background px-1 text-right"
          max={30}
          min={1}
          onChange={(event) => { const next = Math.max(1, Math.min(30, Number(event.target.value) || 1)); const ms = Math.round(1000 / next); store.transaction("Set animation FPS", () => { for (let index = 0; index < store.frameCount; index += 1) store.setFrameDuration(index, ms); }); }}
          placeholder={timelineCopy.mixedFps}
          step="any"
          type="number"
          value={fps}
        />
        fps
      </label>

      <label className="flex items-center gap-1 font-mono text-[11px] text-muted-foreground">
        <Input aria-label="Selected frame duration" className="h-6 w-14 rounded-sm bg-background px-1 text-right" min={1} onChange={(event) => store.setFrameDuration(active, Math.max(1, Number(event.target.value) || 1))} type="number" value={duration} />
        ms
      </label>

      <Button aria-label="Move frame left" disabled={active === 0} onClick={() => { const order = Array.from({ length: frameCount }, (_, index) => index); [order[active - 1], order[active]] = [order[active] as number, order[active - 1] as number]; store.reorderFrames(order); }} size="icon-sm" title="Move frame left" variant="ghost"><ChevronLeft aria-hidden className="size-3.5" /></Button>
      <Button aria-label="Move frame right" disabled={active === frameCount - 1} onClick={() => { const order = Array.from({ length: frameCount }, (_, index) => index); [order[active], order[active + 1]] = [order[active + 1] as number, order[active] as number]; store.reorderFrames(order); }} size="icon-sm" title="Move frame right" variant="ghost"><ChevronRight aria-hidden className="size-3.5" /></Button>

      <Button
        aria-label="Duplicate frame"
        className="flex size-7 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={onAdd}
        size="icon-sm"
        title="Duplicate frame"
        type="button"
        variant="ghost"
      >
        <Copy aria-hidden className="size-3.5" strokeWidth={1.5} />
      </Button>
      <Button
        aria-label="Add blank frame"
        className="flex size-7 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => store.addFrame({ at: store.activeFrame + 1 })}
        size="icon-sm"
        title="Add blank frame"
        type="button"
        variant="ghost"
      >
        <Plus aria-hidden className="size-3.5" strokeWidth={1.5} />
      </Button>
      <Button
        aria-label="Animate"
        aria-pressed={showPresets}
        className={cn(
          "flex size-7 items-center justify-center rounded-sm transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          showPresets ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground"
        )}
        onClick={() => setShowPresets((value) => !value)}
        size="icon-sm"
        title="Procedural animation"
        type="button"
        variant="ghost"
      >
        <Sparkles aria-hidden className="size-3.5" strokeWidth={1.5} />
      </Button>
      <Button
        aria-label="Toggle onion skin"
        aria-pressed={onionSkin}
        className={cn(
          "flex size-7 items-center justify-center rounded-sm transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          "disabled:pointer-events-none disabled:opacity-40",
          onionSkin ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground"
        )}
        disabled={frameCount <= 1}
        onClick={onToggleOnionSkin}
        size="icon-sm"
        title="Onion skin"
        type="button"
        variant="ghost"
      >
        <Layers aria-hidden className="size-3.5" strokeWidth={1.5} />
      </Button>
      <Button
        aria-label="Delete frame"
        className={cn(
          "flex size-7 items-center justify-center rounded-sm text-muted-foreground transition-colors",
          "hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          "disabled:pointer-events-none disabled:opacity-40"
        )}
        disabled={frameCount <= 1}
        onClick={onDelete}
        size="icon-sm"
        title={frameCount <= 1 ? "A document needs at least one frame" : "Delete frame"}
        type="button"
        variant="ghost"
      >
        <Trash2 aria-hidden className="size-3.5" strokeWidth={1.5} />
      </Button>
      </div>
    </div>
  );
}

function FrameThumbnail({
  index,
  palette,
  store,
}: {
  index: number;
  palette: readonly string[];
  store: DocumentStore;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) {
      return;
    }

    const grid = store.readComposite(index);
    const scale = Math.max(1, Math.floor(32 / Math.max(grid.width, grid.height)));
    canvas.width = grid.width * scale;
    canvas.height = grid.height * scale;
    context.imageSmoothingEnabled = false;

    const source = document.createElement("canvas");
    source.width = grid.width;
    source.height = grid.height;
    source.getContext("2d")?.putImageData(gridToImageData(grid, palette, 1), 0, 0);
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
  }, [index, palette, store]);

  return <canvas className="block size-8" ref={canvasRef} style={{ imageRendering: "pixelated" }} />;
}
