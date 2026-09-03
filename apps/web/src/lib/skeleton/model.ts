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
 *
 * Positions travel, but *rotations travel better*. A template's absolute joint
 * positions encode the template author's proportions; applied directly they
 * stretch a short-legged character's legs to the template's length. So a
 * template is applied through `retargetPoseOnto`, which reads each bone's
 * rotation relative to a reference pose and applies that rotation to the
 * character's own bones, keeping its own limb lengths.
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

/**
 * A bone joins a parent joint to a child joint.
 *
 * Listed parent-first, so walking the list in order is forward kinematics: by
 * the time a bone is reached its parent joint has already been placed.
 */
export type Bone = readonly [parent: Joint, child: Joint];

export const ROOT_JOINT: Joint = "pelvis";

export const BIPEDAL_BONES: readonly Bone[] = [
  ["pelvis", "chest"],
  ["chest", "neck"],
  ["neck", "head"],
  ["chest", "shoulder-l"],
  ["shoulder-l", "elbow-l"],
  ["elbow-l", "hand-l"],
  ["chest", "shoulder-r"],
  ["shoulder-r", "elbow-r"],
  ["elbow-r", "hand-r"],
  ["pelvis", "hip-l"],
  ["hip-l", "knee-l"],
  ["knee-l", "foot-l"],
  ["pelvis", "hip-r"],
  ["hip-r", "knee-r"],
  ["knee-r", "foot-r"],
];

export const QUADRUPEDAL_BONES: readonly Bone[] = [
  ["pelvis", "chest"],
  ["chest", "neck"],
  ["neck", "head"],
  ["pelvis", "tail"],
  ["chest", "fore-knee-l"],
  ["fore-knee-l", "fore-foot-l"],
  ["chest", "fore-knee-r"],
  ["fore-knee-r", "fore-foot-r"],
  ["pelvis", "hind-knee-l"],
  ["hind-knee-l", "hind-foot-l"],
  ["pelvis", "hind-knee-r"],
  ["hind-knee-r", "hind-foot-r"],
];

/** Every bone of every character type, for drawing a pose whose type is not to hand. */
export const ALL_BONES: readonly Bone[] = [
  ...BIPEDAL_BONES,
  ...QUADRUPEDAL_BONES.filter(
    ([parent, child]) => !BIPEDAL_BONES.some(([p, c]) => p === parent && c === child),
  ),
];

export function bonesFor(type: CharacterType): readonly Bone[] {
  return type === "quadrupedal" ? QUADRUPEDAL_BONES : BIPEDAL_BONES;
}

const BIPEDAL_FEET: readonly Joint[] = ["foot-l", "foot-r"];
const QUADRUPEDAL_FEET: readonly Joint[] = ["fore-foot-l", "fore-foot-r", "hind-foot-l", "hind-foot-r"];

/** The joints that touch the ground in a standing pose. */
export function feetFor(type: CharacterType): readonly Joint[] {
  return type === "quadrupedal" ? QUADRUPEDAL_FEET : BIPEDAL_FEET;
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
  /**
   * Whether every pose keeps its lowest foot on the character's ground line.
   * Defaults to true; a jump sets it false so the feet may leave the ground.
   */
  readonly grounded?: boolean;
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

/** A normalised joint as a continuous pixel coordinate: the top-left of the pixel it sits on. */
export function jointToPixel(position: JointPosition, bounds: ContentBounds): { x: number; y: number } {
  return {
    x: bounds.x + position.x * Math.max(1, bounds.width - 1),
    y: bounds.y + position.y * Math.max(1, bounds.height - 1),
  };
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
    ...sequence,
    type: target,
    poses: sequence.poses.map((pose) => retargetPose(pose, target)),
  };
}

/**
 * Applies a pose to a specific character by **bone rotation**, not position.
 *
 * `pose` and `reference` are two poses of the same template rig — a template
 * keyframe and the rest pose it was authored against. For each bone, the angle
 * the template turned it through (and the small length change it made) is
 * applied to the same bone of `base`, the character's own estimated skeleton.
 * The root joint carries over the template's displacement.
 *
 * The result has the character's own limb lengths in the template's attitude.
 * A short-legged character applying a stride keeps short legs; applied by
 * position it would grow the template's legs, which is how the previous rig
 * stretched every sprite toward one set of proportions.
 *
 * Template angles are read in the template's square normalised space; the
 * character's bones are rotated in its pixel space, through `bounds`, so a 30°
 * swing is 30° on screen regardless of how tall or wide the sprite is.
 */
export function retargetPoseOnto(
  pose: Pose,
  reference: Pose,
  base: Pose,
  bounds: ContentBounds,
): Pose {
  const source = retargetPose(pose, base.type);
  const rest = retargetPose(reference, base.type);
  const scaleX = Math.max(1, bounds.width - 1);
  const scaleY = Math.max(1, bounds.height - 1);

  const joints: Partial<Record<Joint, JointPosition>> = { ...base.joints };

  const root = base.joints[ROOT_JOINT];
  if (root !== undefined) {
    const moved = source.joints[ROOT_JOINT];
    const at = rest.joints[ROOT_JOINT];
    joints[ROOT_JOINT] =
      moved !== undefined && at !== undefined
        ? { x: root.x + (moved.x - at.x), y: root.y + (moved.y - at.y) }
        : root;
  }

  for (const [parent, child] of bonesFor(base.type)) {
    const baseParent = base.joints[parent];
    const baseChild = base.joints[child];
    const placedParent = joints[parent];
    if (baseParent === undefined || baseChild === undefined || placedParent === undefined) {
      continue;
    }

    let vx = (baseChild.x - baseParent.x) * scaleX;
    let vy = (baseChild.y - baseParent.y) * scaleY;

    const restParent = rest.joints[parent];
    const restChild = rest.joints[child];
    const poseParent = source.joints[parent];
    const poseChild = source.joints[child];
    if (
      restParent !== undefined &&
      restChild !== undefined &&
      poseParent !== undefined &&
      poseChild !== undefined
    ) {
      const rx = restChild.x - restParent.x;
      const ry = restChild.y - restParent.y;
      const px = poseChild.x - poseParent.x;
      const py = poseChild.y - poseParent.y;
      const restLength = Math.hypot(rx, ry);
      const poseLength = Math.hypot(px, py);
      if (restLength > 1e-6 && poseLength > 1e-6) {
        const delta = Math.atan2(py, px) - Math.atan2(ry, rx);
        const ratio = Math.max(0.5, Math.min(1.5, poseLength / restLength));
        const cos = Math.cos(delta);
        const sin = Math.sin(delta);
        const rotatedX = (vx * cos - vy * sin) * ratio;
        const rotatedY = (vx * sin + vy * cos) * ratio;
        vx = rotatedX;
        vy = rotatedY;
      }
    }

    joints[child] = { x: placedParent.x + vx / scaleX, y: placedParent.y + vy / scaleY };
  }

  return { type: base.type, joints };
}

/** The normalised y of the lowest foot, or null when the pose has no feet. */
export function groundLine(pose: Pose): number | null {
  let lowest = Number.NEGATIVE_INFINITY;
  for (const foot of feetFor(pose.type)) {
    const position = pose.joints[foot];
    if (position !== undefined && position.y > lowest) lowest = position.y;
  }
  return Number.isFinite(lowest) ? lowest : null;
}

/**
 * Shifts a whole pose vertically so its lowest foot sits on `ground`.
 *
 * Rotating a leg forward shortens its vertical reach, so a retargeted stride
 * would otherwise float a fraction of a pixel above the ground line and a
 * cycle would bob with every step. Planting the lowest foot is what keeps a
 * walk looking walked rather than hovered.
 */
export function groundPose(pose: Pose, ground: number): Pose {
  const lowest = groundLine(pose);
  if (lowest === null) return pose;
  const shift = ground - lowest;
  if (Math.abs(shift) < 1e-9) return pose;

  const joints: Partial<Record<Joint, JointPosition>> = {};
  for (const [joint, position] of Object.entries(pose.joints) as [Joint, JointPosition][]) {
    joints[joint] = { x: position.x, y: position.y + shift };
  }
  return { type: pose.type, joints };
}

/**
 * Reflects a pose left-to-right without renaming joints.
 *
 * Templates are authored for a character facing east (screen right). A
 * west-facing sprite walks the other way, so the same cycle applies mirrored.
 * Joint names keep their screen side — `-l` stays on the left of the canvas —
 * because that is how the estimator assigns them.
 */
export function mirrorPose(pose: Pose): Pose {
  const joints: Partial<Record<Joint, JointPosition>> = {};
  for (const [joint, position] of Object.entries(pose.joints) as [Joint, JointPosition][]) {
    joints[joint] = { x: 1 - position.x, y: position.y };
  }
  return { type: pose.type, joints };
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
