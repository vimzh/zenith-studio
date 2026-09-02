import { TRANSPARENT, type Grid } from "@zenith/core";

/**
 * Skeletons: named keypoints, posed per frame.
 *
 * The reason skeletons earn their build cost is **reuse**. Posing a character
 * frame by frame is not obviously better than drawing it frame by frame — but a
 * pose *sequence* is character-independent, so a walk cycle authored once
 * applies to every character in the library. That is what `transferAnimation`
 * does, and it is why this phase exists at all.
 *
 * Keypoints are stored in **normalised coordinates**, 0–1 across the content
 * bounds rather than pixels. A pose in pixels is welded to the sprite it was
 * drawn for; a pose in proportions travels.
 */

export type CharacterType = "bipedal" | "bipedal-chibi" | "quadrupedal";

export const BIPEDAL_JOINTS = [
  "head",
  "neck",
  "chest",
  "pelvis",
  "shoulder-l",
  "elbow-l",
  "hand-l",
  "shoulder-r",
  "elbow-r",
  "hand-r",
  "hip-l",
  "knee-l",
  "foot-l",
  "hip-r",
  "knee-r",
  "foot-r",
] as const;

export const QUADRUPEDAL_JOINTS = [
  "head",
  "neck",
  "chest",
  "pelvis",
  "tail",
  "fore-knee-l",
  "fore-foot-l",
  "fore-knee-r",
  "fore-foot-r",
  "hind-knee-l",
  "hind-foot-l",
  "hind-knee-r",
  "hind-foot-r",
] as const;

export type Joint =
  | (typeof BIPEDAL_JOINTS)[number]
  | (typeof QUADRUPEDAL_JOINTS)[number];

export function jointsFor(type: CharacterType): readonly Joint[] {
  return type === "quadrupedal" ? QUADRUPEDAL_JOINTS : BIPEDAL_JOINTS;
}

/** A single joint position, normalised 0–1 within the character's content bounds. */
export interface JointPosition {
  readonly x: number;
  readonly y: number;
}

export interface Pose {
  readonly type: CharacterType;
  readonly joints: Readonly<Partial<Record<Joint, JointPosition>>>;
}

export interface PoseSequence {
  readonly name: string;
  readonly type: CharacterType;
  readonly poses: readonly Pose[];
}

/** Pixel bounds of the opaque content, or null for an empty grid. */
export interface ContentBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export function contentBounds(grid: Grid): ContentBounds | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (let y = 0; y < grid.height; y += 1) {
    for (let x = 0; x < grid.width; x += 1) {
      if ((grid.cells[y * grid.width + x] ?? TRANSPARENT) !== TRANSPARENT) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (minX > maxX) {
    return null;
  }
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/** Converts a normalised pose to pixel coordinates within a sprite's bounds. */
export function poseToPixels(
  pose: Pose,
  bounds: ContentBounds
): Partial<Record<Joint, { x: number; y: number }>> {
  const out: Partial<Record<Joint, { x: number; y: number }>> = {};
  for (const [joint, position] of Object.entries(pose.joints) as [Joint, JointPosition][]) {
    out[joint] = {
      x: Math.round(bounds.x + position.x * (bounds.width - 1)),
      y: Math.round(bounds.y + position.y * (bounds.height - 1)),
    };
  }
  return out;
}

/**
 * Retargets a pose onto a different character.
 *
 * Because poses are normalised, this is the identity on the joint values — the
 * work is entirely in refusing mismatches. A bipedal walk cannot be applied to
 * a quadruped: the joints do not correspond, and silently dropping the ones
 * that do not match would produce a character walking on two of its four legs.
 */
export function retargetPose(pose: Pose, target: CharacterType): Pose {
  if (pose.type === target) {
    return pose;
  }

  const compatible =
    (pose.type === "bipedal" && target === "bipedal-chibi") ||
    (pose.type === "bipedal-chibi" && target === "bipedal");

  if (!compatible) {
    throw new Error(
      `Cannot retarget a ${pose.type} pose onto a ${target} character: their joints do not correspond. Author a ${target} sequence instead.`
    );
  }

  return { type: target, joints: pose.joints };
}

/**
 * Applies a whole sequence to another character type.
 *
 * The payoff of skeletons: author a walk cycle once, then apply it to every
 * character in the library.
 */
export function transferAnimation(sequence: PoseSequence, target: CharacterType): PoseSequence {
  return {
    name: sequence.name,
    type: target,
    poses: sequence.poses.map((pose) => retargetPose(pose, target)),
  };
}

/** Linear blend between two poses. Joints missing from either side are dropped. */
export function interpolatePose(from: Pose, to: Pose, t: number): Pose {
  if (from.type !== to.type) {
    throw new Error(
      `Cannot interpolate a ${from.type} pose with a ${to.type} one. Retarget first.`
    );
  }

  const clamped = Math.max(0, Math.min(1, t));
  const joints: Partial<Record<Joint, JointPosition>> = {};

  for (const [joint, start] of Object.entries(from.joints) as [Joint, JointPosition][]) {
    const end = to.joints[joint];
    if (end === undefined) {
      continue;
    }
    joints[joint] = {
      x: start.x + (end.x - start.x) * clamped,
      y: start.y + (end.y - start.y) * clamped,
    };
  }

  return { type: from.type, joints };
}

/** Expands a sequence to `count` poses by interpolating between its keyframes. */
export function resamplePoses(sequence: PoseSequence, count: number): PoseSequence {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`count must be a positive integer, received ${String(count)}.`);
  }
  if (sequence.poses.length === 0) {
    throw new Error(`Sequence '${sequence.name}' has no poses to resample.`);
  }
  if (sequence.poses.length === 1) {
    return { ...sequence, poses: Array.from({ length: count }, () => sequence.poses[0] as Pose) };
  }

  const poses: Pose[] = [];
  for (let index = 0; index < count; index += 1) {
    // Wraps: a cycle's last keyframe blends back toward its first.
    const position = (index / count) * sequence.poses.length;
    const lower = Math.floor(position) % sequence.poses.length;
    const upper = (lower + 1) % sequence.poses.length;
    poses.push(
      interpolatePose(sequence.poses[lower] as Pose, sequence.poses[upper] as Pose, position - Math.floor(position))
    );
  }

  return { ...sequence, poses };
}
