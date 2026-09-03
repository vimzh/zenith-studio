"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { paletteHexes, type DocumentStore, type Grid } from "@zenith/core";
import { artToScreen, renderDocument, screenToArt, useStoreSelector, type Selection, type Viewport } from "@/lib/pixel";

/**
 * The canvas surface.
 *
 * Repaints when the store revision changes or the viewport moves — never on a
 * React render for any other reason, and never per painted pixel. The grid and
 * palette are read through `useStoreSelector`, which caches on `store.revision`;
 * `readComposite()` returns a copy, so calling it uncached would allocate a full
 * Int8Array every frame.
 */

interface Props {
  readonly store: DocumentStore;
  readonly viewport: Viewport;
  readonly showGrid: boolean;
  readonly onionSkin?: boolean;
  readonly skeleton?: readonly { x: number; y: number; joint: string }[];
  readonly onSkeletonMove?: (joint: string, x: number, y: number) => void;
  /**
   * Drawn in place of the document while set: the skeleton rig's live pose.
   * The document itself is untouched until the pose is baked into a frame.
   */
  readonly preview?: Grid;
  readonly selection?: Selection | null;
  readonly className?: string;
  readonly onPointerDown: (event: React.PointerEvent<HTMLCanvasElement>) => void;
  readonly onPointerMove: (event: React.PointerEvent<HTMLCanvasElement>) => void;
  readonly onPointerUp: (event: React.PointerEvent<HTMLCanvasElement>) => void;
  readonly onPointerLeave: () => void;
  readonly onWheel: (event: React.WheelEvent<HTMLCanvasElement>) => void;
  /** CSS pixel size of the drawing surface, reported on mount and on resize. */
  readonly onResize?: (width: number, height: number) => void;
}

/** Shared empty array, so a skin-less render keeps a stable reference. */
const EMPTY_SKINS: { grid: Grid; opacity: number }[] = [];

const selectComposite = (store: DocumentStore) => store.readComposite();
const selectPalette = (store: DocumentStore) => paletteHexes(store.palette);

export function PixelCanvas({
  store,
  viewport,
  showGrid,
  onionSkin = false,
  skeleton,
  onSkeletonMove,
  preview,
  selection,
  className,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerLeave,
  onWheel,
  onResize,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const draggedJoint = useRef<string | null>(null);
  /** The joint under the pointer, or being dragged: drawn larger with its name. */
  const [hoverJoint, setHoverJoint] = useState<string | null>(null);
  const grid = useStoreSelector(store, selectComposite);
  const palette = useStoreSelector(store, selectPalette);
  /**
   * The frames either side of the current one, ghosted.
   *
   * Previous and next rather than only previous: an in-between is judged
   * against both of its neighbours, and seeing only one is how a frame ends up
   * correctly following the last and badly leading the next.
   *
   * Read through `useStoreSelector` rather than `useMemo`: the store is a
   * stable reference whose contents change, so a memo keyed on it would never
   * recompute. The selector caches on `store.revision`, which is what actually
   * moves.
   */
  const selectSkins = useCallback(
    (current: DocumentStore) => {
      if (!onionSkin || current.frameCount < 2) {
        return EMPTY_SKINS;
      }
      const active = current.activeFrame;
      const previous = (active - 1 + current.frameCount) % current.frameCount;
      const next = (active + 1) % current.frameCount;
      const frames = [{ grid: current.readComposite(previous), opacity: 0.3 }];
      if (next !== previous) {
        frames.push({ grid: current.readComposite(next), opacity: 0.18 });
      }
      return frames;
    },
    [onionSkin]
  );
  const skins = useStoreSelector(store, selectSkins);
  /**
   * Bumped whenever the backing store is resized.
   *
   * Assigning `canvas.width` clears the canvas, and the ResizeObserver fires
   * after the first paint — so without this the initial draw is wiped and never
   * repeated. Repaint has to depend on the resize, not just on the document.
   */
  const [sizeToken, setSizeToken] = useState(0);

  const pointer = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const rigging = skeleton !== undefined && onSkeletonMove !== undefined;
  const moveJoint = (event: React.PointerEvent<HTMLCanvasElement>, joint: string) => {
    const local = pointer(event);
    const art = screenToArt(viewport, local.x, local.y);
    onSkeletonMove?.(joint, art.x, art.y);
  };
  /** The nearest joint within reach of the pointer. Joints are small; the reach is not. */
  const jointAt = (event: React.PointerEvent<HTMLCanvasElement>): string | null => {
    if (skeleton === undefined) return null;
    const local = pointer(event);
    const hitRadius = Math.max(8, Math.min(14, viewport.zoom));
    let nearest: string | null = null;
    let best = hitRadius * hitRadius;
    for (const joint of skeleton) {
      const origin = artToScreen(viewport, joint.x, joint.y);
      const dx = local.x - (origin.x + viewport.zoom / 2);
      const dy = local.y - (origin.y + viewport.zoom / 2);
      const distance = dx * dx + dy * dy;
      if (distance <= best) {
        best = distance;
        nearest = joint.joint;
      }
    }
    return nearest;
  };
  /**
   * While a skeleton is open the canvas only poses. A stroke that missed a
   * joint would paint the document underneath a preview that hides it, and
   * nothing would show until the skeleton closed.
   */
  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (rigging) {
      const hit = jointAt(event);
      if (hit !== null) {
        draggedJoint.current = hit;
        setHoverJoint(hit);
        event.currentTarget.setPointerCapture(event.pointerId);
        moveJoint(event, hit);
      }
      return;
    }
    onPointerDown(event);
  };
  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (draggedJoint.current !== null) {
      moveJoint(event, draggedJoint.current);
      return;
    }
    if (rigging) {
      setHoverJoint(jointAt(event));
      return;
    }
    onPointerMove(event);
  };
  const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (draggedJoint.current !== null) {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      draggedJoint.current = null;
      return;
    }
    onPointerUp(event);
  };
  const handlePointerLeave = () => {
    if (draggedJoint.current !== null) return;
    setHoverJoint(null);
    onPointerLeave();
  };

  // Match the backing store to the element's device pixels, so a 1px grid line
  // is one device pixel rather than a blurred fraction on a HiDPI display.
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) {
      return;
    }

    const resize = () => {
      const ratio = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      const width = Math.round(rect.width * ratio);
      const height = Math.round(rect.height * ratio);
      if (canvas.width === width && canvas.height === height) {
        return;
      }
      canvas.width = width;
      canvas.height = height;
      setSizeToken((value) => value + 1);
      onResize?.(rect.width, rect.height);
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [onResize]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) {
      return;
    }
    const context = canvas.getContext("2d");
    if (context === null) {
      return;
    }

    const ratio = window.devicePixelRatio || 1;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, canvas.width / ratio, canvas.height / ratio);
    renderDocument(context, preview ?? grid, palette, viewport, {
      showGrid,
      onionSkin: skins,
      skeleton,
      skeletonHighlight: hoverJoint,
      selection,
    });
  }, [grid, preview, palette, viewport, showGrid, skins, skeleton, hoverJoint, selection, sizeToken]);

  return (
    <canvas
      aria-label={skeleton === undefined ? "Pixel canvas" : "Pixel canvas with draggable skeleton joints"}
      className={className}
      onPointerDown={handlePointerDown}
      onPointerLeave={handlePointerLeave}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onWheel={onWheel}
      ref={canvasRef}
      style={rigging ? { cursor: hoverJoint === null ? "default" : "grab" } : undefined}
    />
  );
}
