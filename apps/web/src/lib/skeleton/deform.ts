import { TRANSPARENT, cloneGrid, createGrid, peekCell, type Grid } from "@zenith/core";
import { contentBounds, resamplePoses, type ContentBounds, type Joint, type Pose, type PoseSequence } from "./model";

/** Moves a flat indexed sprite with pose control points, without a model call. */

function point(position: { x: number; y: number }, bounds: ContentBounds): { x: number; y: number } {
  return {
    x: bounds.x + position.x * Math.max(1, bounds.width - 1),
    y: bounds.y + position.y * Math.max(1, bounds.height - 1),
  };
}

/** Converts a pixel-snapped drag back into the portable normalised pose. */
export function moveJointToPixel(
  pose: Pose,
  joint: Joint,
  pixel: { x: number; y: number },
  bounds: ContentBounds,
): Pose {
  if (pose.joints[joint] === undefined) return pose;
  return {
    ...pose,
    joints: {
      ...pose.joints,
      [joint]: {
        x: (pixel.x - bounds.x) / Math.max(1, bounds.width - 1),
        y: (pixel.y - bounds.y) / Math.max(1, bounds.height - 1),
      },
    },
  };
}

/**
 * Inverse-distance deformation keeps the raster indexed and avoids forward-warp holes.
 * It is intentionally a flat-sprite rig, not mesh skinning or IK.
 */
export function deformGridByPose(
  source: Grid,
  from: Pose,
  to: Pose,
  bounds: ContentBounds | null = contentBounds(source),
): Grid {
  if (from.type !== to.type) {
    throw new Error(`Cannot deform a ${from.type} character with a ${to.type} pose.`);
  }
  if (bounds === null) return cloneGrid(source);

  const controls = (
    Object.entries(from.joints) as [Joint, { x: number; y: number }][]
  ).flatMap(([joint, start]) => {
      const end = to.joints[joint];
      return end === undefined ? [] : [{ start: point(start, bounds), end: point(end, bounds) }];
    });
  if (controls.length === 0) throw new Error("The poses share no joints to deform.");
  if (controls.every(({ start, end }) => start.x === end.x && start.y === end.y)) return cloneGrid(source);

  const output = createGrid(source.width, source.height, TRANSPARENT);
  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      let dx = 0;
      let dy = 0;
      let total = 0;
      for (const control of controls) {
        const distanceX = x - control.end.x;
        const distanceY = y - control.end.y;
        const weight = 1 / Math.max(0.25, distanceX * distanceX + distanceY * distanceY);
        dx += (control.end.x - control.start.x) * weight;
        dy += (control.end.y - control.start.y) * weight;
        total += weight;
      }
      output.cells[y * output.width + x] = peekCell(
        source,
        Math.round(x - dx / total),
        Math.round(y - dy / total),
      );
    }
  }
  return output;
}

/** Expands pose keyframes and deforms the same untouched source into each frame. */
export function animateGridWithSkeleton(
  source: Grid,
  base: Pose,
  sequence: PoseSequence,
  frameCount: number,
): { readonly poses: readonly Pose[]; readonly frames: readonly Grid[] } {
  const sampled = resamplePoses(sequence, frameCount);
  return {
    poses: sampled.poses,
    frames: sampled.poses.map((pose) => deformGridByPose(source, base, pose)),
  };
}
