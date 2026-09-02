"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { TRANSPARENT, type Cell, type DocumentStore } from "@zenith/core";
import { viewportChannel, viewportForRegion } from "@/lib/webmcp";
import {
  INITIAL_VIEWPORT,
  ZOOM_WHEEL_THRESHOLD,
  applyOpacity,
  expandBrush,
  selectionFrom,
  type Selection,
  buildStroke,
  fitToViewport,
  pan as panViewport,
  screenToArt,
  zoomAtPoint,
  type Point,
  type Viewport,
} from "@/lib/pixel";
import type { ToolId } from "./tools";

/**
 * Pointer and keyboard handling for the canvas.
 *
 * Two performance commitments live here, both from AGENTS.md:
 *
 *  1. **One store transaction per stroke.** Without it every painted pixel bumps
 *     `store.revision`, which clones a grid, repaints, and pushes its own undo
 *     entry — a 50-pixel drag would cost 50 of each instead of one.
 *  2. **Pointer samples are buffered, not applied on arrival.** A fast drag
 *     delivers far more pointermove events than frames; samples are joined into
 *     a gap-free, corner-free stroke and flushed once per animation frame.
 */

export interface EditorController {
  readonly viewport: Viewport;
  /** The committed selection, or null. Feeds the agent its context. */
  readonly selection: Selection | null;
  readonly clearSelection: () => void;
  /** Screen size of the drawing surface. Reported by the canvas on resize. */
  readonly setViewSize: (width: number, height: number) => void;
  readonly cursor: Point | null;
  readonly isPainting: boolean;
  onPointerDown: (event: React.PointerEvent<HTMLCanvasElement>) => void;
  onPointerMove: (event: React.PointerEvent<HTMLCanvasElement>) => void;
  onPointerUp: (event: React.PointerEvent<HTMLCanvasElement>) => void;
  onPointerLeave: () => void;
  onWheel: (event: React.WheelEvent<HTMLCanvasElement>) => void;
  fit: (documentWidth: number, documentHeight: number, viewWidth: number, viewHeight: number) => void;
}

interface Options {
  readonly store: DocumentStore | null;
  readonly tool: ToolId;
  readonly index: Cell;
  readonly onPickColor: (index: Cell) => void;
  /** Square brush edge, in pixels. */
  readonly brushSize: number;
  /** Indexed pixels stay binary; lower values use ordered dither coverage. */
  readonly opacity: number;
}

function localPoint(event: React.PointerEvent<HTMLCanvasElement>): Point {
  const rect = event.currentTarget.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

export function useEditorController({
  store,
  tool,
  index,
  onPickColor,
  brushSize,
  opacity,
}: Options): EditorController {
  const [viewport, setViewport] = useState<Viewport>(INITIAL_VIEWPORT);
  const [cursor, setCursor] = useState<Point | null>(null);
  const [viewSize, setViewSize] = useState({ width: 0, height: 0 });
  const [selection, setSelection] = useState<Selection | null>(null);
  const selectFrom = useRef<Point | null>(null);
  /**
   * The brush size a stroke started with, captured on pointerdown.
   *
   * Same reasoning as `strokeTool`: the scheduled flush runs a frame later and
   * must not read from render, and a stroke should keep the brush it began with
   * regardless of what happens to the control mid-drag.
   */
  const strokeBrush = useRef(brushSize);
  const strokeOpacity = useRef(opacity);
  /**
   * True once the user has zoomed or panned deliberately.
   *
   * Until then the viewport keeps re-fitting the document. Fitting only once on
   * the first reported size is wrong: that measurement can arrive before layout
   * has settled, and a document fitted against a 0-height canvas lands at 1x and
   * stays there — a 32x32 sprite rendered 32 pixels tall in a 600px viewport.
   */
  const adjusted = useRef(false);
  const [isPainting, setIsPainting] = useState(false);

  const samples = useRef<Point[]>([]);
  const applied = useRef(0);
  const frame = useRef<number | null>(null);
  const panFrom = useRef<Point | null>(null);
  /**
   * Wheel delta banked since the last zoom step.
   *
   * A trackpad emits many small wheel events per gesture, so stepping on each
   * one flies through the whole zoom range. Deltas accumulate and spend a step
   * only on crossing the threshold; a mouse notch (~100) still steps once.
   */
  const wheelDelta = useRef(0);
  /**
   * The tool a stroke started with, captured on pointerdown.
   *
   * The scheduled flush runs a frame later and must not read `tool` from a stale
   * closure, nor from render — a stroke keeps the tool it began with regardless
   * of what happens to the selection mid-drag.
   */
  const strokeTool = useRef<ToolId>(tool);

  /** Paint everything sampled since the last flush. Runs at most once per frame. */
  const flush = useCallback(() => {
    frame.current = null;
    if (store === null) {
      return;
    }

    const stroke = buildStroke(samples.current);
    if (stroke.length <= applied.current) {
      return;
    }

    const pending = stroke.slice(applied.current);
    applied.current = stroke.length;

    const value: Cell = strokeTool.current === "eraser" ? TRANSPARENT : index;
    const stamped = applyOpacity(expandBrush(pending, strokeBrush.current), strokeOpacity.current);
    const writes = stamped
      .filter((point) => point.x >= 0 && point.y >= 0 && point.x < store.width && point.y < store.height)
      .map((point) => ({ x: point.x, y: point.y, index: value }));

    if (writes.length > 0) {
      store.setPixels(writes);
    }
  }, [store, index]);

  const schedule = useCallback(() => {
    if (frame.current === null) {
      frame.current = requestAnimationFrame(flush);
    }
  }, [flush]);

  useEffect(() => {
    return () => {
      if (frame.current !== null) {
        cancelAnimationFrame(frame.current);
      }
    };
  }, []);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (store === null) {
        return;
      }
      event.currentTarget.setPointerCapture(event.pointerId);
      const screen = localPoint(event);
      const art = screenToArt(viewport, screen.x, screen.y);

      if (tool === "pan") {
        panFrom.current = screen;
        return;
      }

      if (tool === "select") {
        selectFrom.current = art;
        setSelection(selectionFrom(art, art, store.width, store.height));
        return;
      }

      if (tool === "eyedropper") {
        if (art.x >= 0 && art.y >= 0 && art.x < store.width && art.y < store.height) {
          onPickColor(store.colorAt(art.x, art.y));
        }
        return;
      }

      if (tool === "bucket") {
        if (art.x >= 0 && art.y >= 0 && art.x < store.width && art.y < store.height) {
          store.bucketFill(art.x, art.y, index);
        }
        return;
      }

      // Pencil and eraser: open one transaction for the whole stroke.
      strokeTool.current = tool;
      strokeBrush.current = brushSize;
      strokeOpacity.current = opacity;
      store.begin(tool === "eraser" ? "Erase" : "Draw");
      samples.current = [art];
      applied.current = 0;
      setIsPainting(true);
      schedule();
    },
    [store, tool, index, viewport, onPickColor, schedule, brushSize, opacity]
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const screen = localPoint(event);
      const art = screenToArt(viewport, screen.x, screen.y);
      setCursor(art);

      if (selectFrom.current !== null && store !== null) {
        setSelection(selectionFrom(selectFrom.current, art, store.width, store.height));
        return;
      }

      if (panFrom.current !== null) {
        adjusted.current = true;
        const from = panFrom.current;
        panFrom.current = screen;
        setViewport((current) => panViewport(current, screen.x - from.x, screen.y - from.y));
        return;
      }

      if (!isPainting) {
        return;
      }

      const last = samples.current[samples.current.length - 1];
      if (last === undefined || last.x !== art.x || last.y !== art.y) {
        samples.current.push(art);
        schedule();
      }
    },
    [viewport, isPainting, schedule, store]
  );

  const finishStroke = useCallback(() => {
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
    }
    flush();
    samples.current = [];
    applied.current = 0;

    if (store !== null && store.inTransaction) {
      store.commit();
    }
    setIsPainting(false);
  }, [flush, store]);

  const onPointerUp = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      panFrom.current = null;
      // A click with no drag clears rather than selecting a single pixel: an
      // accidental tap should not leave a 1x1 selection the agent then treats
      // as the region under discussion.
      if (selectFrom.current !== null) {
        selectFrom.current = null;
        setSelection((current) =>
          current !== null && current.width === 1 && current.height === 1 ? null : current
        );
      }
      if (isPainting) {
        finishStroke();
      }
    },
    [isPainting, finishStroke]
  );

  const onPointerLeave = useCallback(() => {
    setCursor(null);
  }, []);

  const onWheel = useCallback((event: React.WheelEvent<HTMLCanvasElement>) => {
    adjusted.current = true;
    // A direction change should feel immediate, not fight leftover momentum.
    if (Math.sign(event.deltaY) !== Math.sign(wheelDelta.current)) {
      wheelDelta.current = 0;
    }
    wheelDelta.current += event.deltaY;

    const steps = Math.trunc(wheelDelta.current / ZOOM_WHEEL_THRESHOLD);
    if (steps === 0) {
      return;
    }
    wheelDelta.current -= steps * ZOOM_WHEEL_THRESHOLD;

    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const direction = steps < 0 ? 1 : -1;

    setViewport((current) => {
      let next = current;
      for (let i = 0; i < Math.abs(steps); i += 1) {
        next = zoomAtPoint(next, direction, x, y);
      }
      return next;
    });
  }, []);

  /**
   * Publish the viewport so `get_viewport` can read it, and honour
   * `focus_viewport` requests.
   *
   * The viewport lives in this hook's state, and tools run outside the render
   * tree — so a channel is the seam. Same ownership direction as the asset
   * route: this hook owns the state, a tool asks explicitly, and nothing is
   * inferred from a mismatch.
   */
  useEffect(() => {
    viewportChannel.report({
      ...viewport,
      viewWidth: viewSize.width,
      viewHeight: viewSize.height,
    });
  }, [viewport, viewSize]);

  useEffect(
    () =>
      viewportChannel.subscribe(() => {
        const region = viewportChannel.peekRequest();
        if (region === null) {
          return;
        }
        viewportChannel.clearRequest();
        setViewport(viewportForRegion(region, viewSize.width, viewSize.height));
      }),
    [viewSize]
  );

  const updateViewSize = useCallback(
    (width: number, height: number) => {
      setViewSize((current) =>
        current.width === width && current.height === height ? current : { width, height }
      );

      if (!adjusted.current && width > 0 && height > 0 && store !== null) {
        setViewport(fitToViewport(store.width, store.height, width, height));
      }
    },
    [store]
  );

  const fit = useCallback(
    (documentWidth: number, documentHeight: number, viewWidth: number, viewHeight: number) => {
      setViewport(fitToViewport(documentWidth, documentHeight, viewWidth, viewHeight));
    },
    []
  );

  const clearSelection = useCallback(() => setSelection(null), []);

  return {
    viewport,
    selection,
    clearSelection,
    setViewSize: updateViewSize,
    cursor,
    isPainting,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerLeave,
    onWheel,
    fit,
  };
}
