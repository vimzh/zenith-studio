"use client";

import { useCallback, useMemo, useState } from "react";
import type { DocumentStore, Grid } from "@zenith/core";
import { applySkeletonTemplate, bakeSkeletonPose } from "@/lib/editor";
import {
  REST_POSE,
  contentBounds,
  createRig,
  estimateSkeleton,
  groundLine,
  groundPose,
  mirrorPose,
  moveJointToPixel,
  poseRig,
  poseTemplate,
  poseToPixels,
  retargetPoseOnto,
  type CharacterType,
  type Joint,
  type Pose,
  type Rig,
} from "@/lib/skeleton";

export type Facing = "east" | "west";

/**
 * Everything the skeleton panel and the shortcut need to drive the rig.
 *
 * `pose` is null while no skeleton is open. Actions that can fail — an empty
 * frame has no silhouette — throw, so the panel runs them through its status
 * reporter rather than each one guessing how to say so.
 */
export interface SkeletonController {
  readonly pose: Pose | null;
  readonly base: Pose | null;
  readonly type: CharacterType;
  readonly facing: Facing;
  /** Estimates a fresh rig from the active frame; returns a summary. */
  readonly estimate: (type?: CharacterType) => string;
  readonly hide: () => void;
  readonly reset: () => void;
  readonly setPose: (pose: Pose) => void;
  readonly setFacing: (facing: Facing) => void;
  /** Turns the character's own limbs into a stock template's first keyframe. */
  readonly applyTemplatePose: (template: string) => void;
  /** Inserts the current pose as a new frame after the rig's source frame. */
  readonly bake: () => string;
  /** Builds a stock cycle from the corrected rig. */
  readonly buildCycle: (template: string, frames: number) => string;
}

export interface SkeletonRig {
  readonly controller: SkeletonController;
  /** The rig source in the current pose, shown in place of the document while a skeleton is open. */
  readonly preview: Grid | undefined;
  /** Joint markers in art coordinates, for the canvas. */
  readonly joints: readonly { x: number; y: number; joint: string }[] | undefined;
  readonly moveJoint: (joint: string, x: number, y: number) => void;
}

interface OpenRig {
  readonly rig: Rig;
  /** The frame the rig was estimated from. Bakes insert after it. */
  readonly frame: number;
  /** The asset the rig was estimated from. A rig never outlives its asset. */
  readonly store: DocumentStore;
}

/**
 * The rig behind the skeleton editor.
 *
 * The rig is built once, when the skeleton is estimated, from the frame's
 * composite at that moment: binding pixels to bones is the expensive half of
 * a pose, and a drag needs only the cheap half. Every pose — a dragged joint,
 * a template — is applied to that untouched source, so posing twice never
 * degrades the sprite twice.
 *
 * `preview` replaces the document on the canvas while a skeleton is open,
 * which is what makes a drag a pose rather than a promise of one.
 */
export function useSkeletonRig(store: DocumentStore): SkeletonRig {
  const [held, setOpen] = useState<OpenRig | null>(null);
  const [heldPose, setPoseState] = useState<Pose | null>(null);
  const [type, setType] = useState<CharacterType>("bipedal");
  const [facing, setFacing] = useState<Facing>("east");

  // A rig belongs to the asset it was estimated from: one held for a
  // different asset is not open here, and the next estimate replaces it.
  const open = held !== null && held.store === store ? held : null;
  const pose = open === null ? null : heldPose;

  const estimate = useCallback(
    (nextType: CharacterType = type): string => {
      const source = store.readComposite();
      const base = estimateSkeleton(source, nextType);
      const bounds = contentBounds(source);
      if (base === null || bounds === null) {
        throw new Error("This frame is empty, so there is no silhouette to estimate a skeleton from.");
      }
      setOpen({ rig: createRig(source, base, bounds), frame: store.activeFrame, store });
      setPoseState(base);
      setType(nextType);
      return `Estimated a ${nextType} skeleton from the silhouette. Drag a joint on the canvas to correct it.`;
    },
    [store, type],
  );

  const hide = useCallback(() => {
    setOpen(null);
    setPoseState(null);
  }, []);

  const reset = useCallback(() => {
    setPoseState(open === null ? null : open.rig.base);
  }, [open]);

  const setPose = useCallback((next: Pose) => {
    setPoseState(next);
  }, []);

  const applyTemplatePose = useCallback(
    (name: string) => {
      if (open === null) return;
      const template = poseTemplate(name);
      const first = template.poses[0];
      if (first === undefined) return;
      const mirror = facing === "west";
      const retargeted = retargetPoseOnto(
        mirror ? mirrorPose(first) : first,
        mirror ? mirrorPose(REST_POSE) : REST_POSE,
        open.rig.base,
        open.rig.bounds,
      );
      const ground = groundLine(open.rig.base);
      setPoseState(template.grounded !== false && ground !== null ? groundPose(retargeted, ground) : retargeted);
    },
    [facing, open],
  );

  const moveJoint = useCallback(
    (joint: string, x: number, y: number) => {
      if (open === null) return;
      const pixel = {
        x: Math.max(0, Math.min(store.width - 1, x)),
        y: Math.max(0, Math.min(store.height - 1, y)),
      };
      setPoseState((current) =>
        current === null ? null : moveJointToPixel(current, joint as Joint, pixel, open.rig.bounds),
      );
    },
    [open, store.height, store.width],
  );

  const bake = useCallback((): string => {
    if (open === null || pose === null) {
      throw new Error("Estimate a skeleton before creating a posed frame.");
    }
    const after = Math.min(open.frame, store.frameCount - 1);
    return bakeSkeletonPose(store, open.rig.source, open.rig.base, pose, { after });
  }, [open, pose, store]);

  const buildCycle = useCallback(
    (template: string, frames: number): string => {
      if (open === null) {
        throw new Error("Estimate a skeleton before building a cycle.");
      }
      // The cycle rigs the frame the skeleton was estimated on, with the
      // corrected skeleton, whatever frame the timeline has moved to since.
      store.selectFrame(Math.min(open.frame, store.frameCount - 1));
      return applySkeletonTemplate(store, template, frames, { base: open.rig.base, facing });
    },
    [facing, open, store],
  );

  const preview = useMemo(
    () => (open === null || pose === null ? undefined : poseRig(open.rig, pose)),
    [open, pose],
  );

  const joints = useMemo(() => {
    if (open === null || pose === null) return undefined;
    return Object.entries(poseToPixels(pose, open.rig.bounds)).map(([joint, at]) => ({
      joint,
      x: at.x,
      y: at.y,
    }));
  }, [open, pose]);

  const controller = useMemo<SkeletonController>(
    () => ({
      pose,
      base: open === null ? null : open.rig.base,
      type,
      facing,
      estimate,
      hide,
      reset,
      setPose,
      setFacing,
      applyTemplatePose,
      bake,
      buildCycle,
    }),
    [applyTemplatePose, bake, buildCycle, estimate, facing, hide, open, pose, reset, setPose, type],
  );

  return { controller, preview, joints, moveJoint };
}
