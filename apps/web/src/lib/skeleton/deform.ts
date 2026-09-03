import { TRANSPARENT, cloneGrid, createGrid, type Grid } from "@zenith/core";
import {
  bonesFor,
  contentBounds,
  groundLine,
  groundPose,
  jointToPixel,
  mirrorPose,
  resamplePoses,
  retargetPoseOnto,
  type Bone,
  type ContentBounds,
  type Joint,
  type Pose,
  type PoseSequence,
} from "./model";
import { readSilhouette } from "./silhouette";
import { REST_POSE } from "./templates";

/**
 * A flat-sprite bone rig.
 *
 * Every opaque pixel is **bound to one bone** — the nearest segment of the
 * base pose — and moves rigidly with it: rotated about the bone's parent
 * joint, scaled along the bone's axis when its length changes, and nothing
 * else. Pixels the bone does not own are untouched by it.
 *
 * This replaced an inverse-distance warp in which every joint pulled on every
 * pixel. That warp had no notion of a limb: dragging a hand slid the head, a
 * walk cycle melted the torso, and nothing anywhere rotated. Hard binding is
 * what makes an arm an arm — it swings as one piece and the body stays put.
 *
 * Rendering is inverse-mapped per bone. For each output pixel inside a bone's
 * moved footprint, the pixel centre is mapped back through that bone's inverse
 * transform, and the pixel is painted only if the source pixel it lands on is
 * bound to the same bone. Forward-mapping would leave holes wherever a rotated
 * limb's pixels spread apart; sampling the other way cannot.
 *
 * A held prop is the exception to nearest-bone binding. A staff runs past
 * the arm, the hip and the shin, and bound by distance it shatters into a
 * piece per bone. Its pixels are bound instead to a zero-length bone at the
 * hand joint, which translates with the hand and never rotates — the staff
 * stays upright and follows the hand, which is what a carried staff does.
 *
 * The rig preserves palette indices: a pixel is moved, never blended.
 */

interface Point {
  readonly x: number;
  readonly y: number;
}

interface RigBone {
  readonly bone: Bone;
  readonly start: Point;
  readonly end: Point;
  /** Bound source pixels' bounding box, inclusive. Empty when `count` is 0. */
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly count: number;
}

export interface Rig {
  readonly source: Grid;
  readonly base: Pose;
  readonly bounds: ContentBounds;
  readonly bones: readonly RigBone[];
  /** Bone index per source pixel, or -1 for transparent. */
  readonly binding: Int8Array;
}

/** The centre of the pixel a normalised joint sits on. */
function jointCentre(position: { x: number; y: number }, bounds: ContentBounds): Point {
  const pixel = jointToPixel(position, bounds);
  return { x: pixel.x + 0.5, y: pixel.y + 0.5 };
}

function segmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  let t = 0;
  if (lengthSquared > 0) {
    t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared));
  }
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * How far a bone reaches sideways before a nearer bone wins.
 *
 * The spine is a line down the middle of a torso several pixels wide, and the
 * arm bones run along the torso's edges. Measured to the line, half the torso
 * is nearer an arm than the spine and would swing with it. Giving the spine a
 * radius makes it a capsule that owns the torso's interior, leaving the arms
 * the outer strip that is actually arm.
 */
function boneRadius(bone: Bone, pose: Pose, bounds: ContentBounds): number {
  const [parent, child] = bone;
  if (parent !== "pelvis" && parent !== "chest") return 0;
  if (child !== "chest" && child !== "neck") return 0;

  let span: number;
  if (pose.type === "quadrupedal") {
    span = bounds.height * 0.5;
  } else {
    const left = pose.joints["shoulder-l"];
    const right = pose.joints["shoulder-r"];
    span =
      left === undefined || right === undefined
        ? bounds.width * 0.5
        : Math.abs(jointCentre(right, bounds).x - jointCentre(left, bounds).x);
  }
  return child === "chest" ? span * 0.3 : span * 0.15;
}

/**
 * Paint order, back to front: legs, torso, head, arms.
 *
 * A flat sprite has no depth, so this is a convention rather than a fact. It
 * keeps the head over the shoulders and an arm crossing the body in front of
 * it, which is right for the near arm and wrong for the far one — and for
 * blocking a pose that is the better of the two mistakes.
 */
function paintRank(bone: Bone): number {
  const [, child] = bone;
  if (child.includes("knee") || child.includes("foot") || child.startsWith("hip")) return 0;
  if (child === "chest" || child === "neck" || child === "tail") return 1;
  if (child === "head") return 2;
  return 3;
}

/** Binds every opaque pixel of `source` to the nearest bone of `base`. */
export function createRig(source: Grid, base: Pose, bounds: ContentBounds | null = contentBounds(source)): Rig {
  const resolved = bounds ?? { x: 0, y: 0, width: source.width, height: source.height };
  const silhouette = readSilhouette(source, resolved);
  const propHands: Partial<Record<1 | 2, Joint>> = {};
  const skeletonBones: Bone[] = [...bonesFor(base.type)];
  for (const side of silhouette.propSides) {
    const hand: Joint = side === "l" ? "hand-l" : "hand-r";
    if (base.joints[hand] === undefined) continue;
    propHands[side === "l" ? 1 : 2] = hand;
    skeletonBones.push([hand, hand]);
  }
  const bones = skeletonBones
    .filter(([parent, child]) => base.joints[parent] !== undefined && base.joints[child] !== undefined)
    .map((bone) => ({
      bone,
      start: jointCentre(base.joints[bone[0]] as { x: number; y: number }, resolved),
      end: jointCentre(base.joints[bone[1]] as { x: number; y: number }, resolved),
      radius: boneRadius(bone, base, resolved),
    }));
  const propIndex = (offset: number): number => {
    const code = silhouette.props[offset];
    const hand = code === 1 || code === 2 ? propHands[code] : undefined;
    return hand === undefined ? -1 : bones.findIndex(({ bone }) => bone[0] === hand && bone[1] === hand);
  };

  const binding = new Int8Array(source.width * source.height).fill(-1);
  const boxes = bones.map(() => ({
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
    count: 0,
  }));

  if (bones.length > 0) {
    for (let y = 0; y < source.height; y += 1) {
      for (let x = 0; x < source.width; x += 1) {
        const offset = y * source.width + x;
        if ((source.cells[offset] ?? TRANSPARENT) === TRANSPARENT) continue;
        const p = { x: x + 0.5, y: y + 0.5 };
        let best = propIndex(offset);
        if (best < 0) {
          let bestDistance = Number.POSITIVE_INFINITY;
          bones.forEach((bone, index) => {
            if (bone.bone[0] === bone.bone[1]) return;
            const distance = segmentDistance(p, bone.start, bone.end) - bone.radius;
            if (distance < bestDistance) {
              bestDistance = distance;
              best = index;
            }
          });
        }
        if (best < 0) continue;
        binding[offset] = best;
        const box = boxes[best] as (typeof boxes)[number];
        if (x < box.minX) box.minX = x;
        if (x > box.maxX) box.maxX = x;
        if (y < box.minY) box.minY = y;
        if (y > box.maxY) box.maxY = y;
        box.count += 1;
      }
    }
  }

  return {
    source,
    base,
    bounds: resolved,
    binding,
    bones: bones.map(({ bone, start, end }, index) => ({ bone, start, end, ...(boxes[index] as (typeof boxes)[number]) })),
  };
}

interface Frame {
  readonly origin: Point;
  readonly dir: Point;
  readonly perp: Point;
  readonly length: number;
}

function frameOf(start: Point, end: Point): Frame {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  const dir = length < 1e-6 ? { x: 0, y: 1 } : { x: dx / length, y: dy / length };
  return { origin: start, dir, perp: { x: -dir.y, y: dir.x }, length };
}

/** Poses a rig: the same untouched source, every bone moved to `pose`. */
export function poseRig(rig: Rig, pose: Pose): Grid {
  if (pose.type !== rig.base.type) {
    throw new Error(`Cannot pose a ${rig.base.type} rig with a ${pose.type} pose.`);
  }
  const { source, binding } = rig;
  const width = source.width;
  const output = createGrid(width, source.height, TRANSPARENT);

  // A pixel no bone owns — possible only when the pose defines no bones at all
  // over it — stays where it is rather than vanishing.
  for (let offset = 0; offset < binding.length; offset += 1) {
    if (binding[offset] === -1 && (source.cells[offset] ?? TRANSPARENT) !== TRANSPARENT) {
      output.cells[offset] = source.cells[offset] as number;
    }
  }

  const order = rig.bones
    .map((bone, index) => ({ bone, index }))
    .sort((a, b) => paintRank(a.bone.bone) - paintRank(b.bone.bone) || a.index - b.index);

  for (const { bone, index } of order) {
    if (bone.count === 0) continue;
    const [parent, child] = bone.bone;
    const toParent = pose.joints[parent];
    const toChild = pose.joints[child];
    const start = toParent === undefined ? bone.start : jointCentre(toParent, rig.bounds);
    const end = toChild === undefined ? bone.end : jointCentre(toChild, rig.bounds);

    const still =
      Math.abs(start.x - bone.start.x) < 1e-6 &&
      Math.abs(start.y - bone.start.y) < 1e-6 &&
      Math.abs(end.x - bone.end.x) < 1e-6 &&
      Math.abs(end.y - bone.end.y) < 1e-6;

    if (still) {
      for (let y = bone.minY; y <= bone.maxY; y += 1) {
        for (let x = bone.minX; x <= bone.maxX; x += 1) {
          const offset = y * width + x;
          if (binding[offset] === index) output.cells[offset] = source.cells[offset] as number;
        }
      }
      continue;
    }

    const from = frameOf(bone.start, bone.end);
    const to = frameOf(start, end);
    const scale = from.length < 1e-6 || to.length < 1e-6 ? 1 : Math.max(0.25, Math.min(4, to.length / from.length));

    // The moved footprint: the bound box's corners, mapped forward.
    const forward = (p: Point): Point => {
      const px = p.x - from.origin.x;
      const py = p.y - from.origin.y;
      const u = (px * from.dir.x + py * from.dir.y) * scale;
      const v = px * from.perp.x + py * from.perp.y;
      return { x: to.origin.x + u * to.dir.x + v * to.perp.x, y: to.origin.y + u * to.dir.y + v * to.perp.y };
    };
    const corners = [
      forward({ x: bone.minX, y: bone.minY }),
      forward({ x: bone.maxX + 1, y: bone.minY }),
      forward({ x: bone.minX, y: bone.maxY + 1 }),
      forward({ x: bone.maxX + 1, y: bone.maxY + 1 }),
    ];
    const minX = Math.max(0, Math.floor(Math.min(...corners.map((c) => c.x))) - 1);
    const maxX = Math.min(width - 1, Math.ceil(Math.max(...corners.map((c) => c.x))) + 1);
    const minY = Math.max(0, Math.floor(Math.min(...corners.map((c) => c.y))) - 1);
    const maxY = Math.min(source.height - 1, Math.ceil(Math.max(...corners.map((c) => c.y))) + 1);

    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const qx = x + 0.5 - to.origin.x;
        const qy = y + 0.5 - to.origin.y;
        const u = (qx * to.dir.x + qy * to.dir.y) / scale;
        const v = qx * to.perp.x + qy * to.perp.y;
        const sx = Math.floor(from.origin.x + u * from.dir.x + v * from.perp.x);
        const sy = Math.floor(from.origin.y + u * from.dir.y + v * from.perp.y);
        if (sx < bone.minX || sx > bone.maxX || sy < bone.minY || sy > bone.maxY) continue;
        const sourceOffset = sy * width + sx;
        if (binding[sourceOffset] !== index) continue;
        output.cells[y * width + x] = source.cells[sourceOffset] as number;
      }
    }
  }

  return output;
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
 * Moves a flat indexed sprite from one pose to another, without a model call.
 *
 * One-shot form of `createRig` + `poseRig`. Anything posing the same source
 * repeatedly — a live preview, a cycle — should build the rig once.
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

  const shared = bonesFor(from.type).some(
    ([parent, child]) =>
      from.joints[parent] !== undefined &&
      from.joints[child] !== undefined &&
      to.joints[parent] !== undefined &&
      to.joints[child] !== undefined,
  );
  if (!shared) throw new Error("The poses share no joints to deform.");

  return poseRig(createRig(source, from, bounds), to);
}

/** Rows the pixels of a pose would land on, before clipping to the canvas. */
function posedExtent(rig: Rig, pose: Pose): { readonly top: number; readonly bottom: number } {
  let top = Number.POSITIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  const width = rig.source.width;
  rig.bones.forEach((bone, index) => {
    if (bone.count === 0) return;
    const [parent, child] = bone.bone;
    const toParent = pose.joints[parent];
    const toChild = pose.joints[child];
    const start = toParent === undefined ? bone.start : jointCentre(toParent, rig.bounds);
    const end = toChild === undefined ? bone.end : jointCentre(toChild, rig.bounds);
    const from = frameOf(bone.start, bone.end);
    const to = frameOf(start, end);
    const scale = from.length < 1e-6 || to.length < 1e-6 ? 1 : Math.max(0.25, Math.min(4, to.length / from.length));
    for (let y = bone.minY; y <= bone.maxY; y += 1) {
      for (let x = bone.minX; x <= bone.maxX; x += 1) {
        if (rig.binding[y * width + x] !== index) continue;
        const px = x + 0.5 - from.origin.x;
        const py = y + 0.5 - from.origin.y;
        const u = (px * from.dir.x + py * from.dir.y) * scale;
        const v = px * from.perp.x + py * from.perp.y;
        const row = Math.floor(to.origin.y + u * to.dir.y + v * to.perp.y);
        if (row < top) top = row;
        if (row > bottom) bottom = row;
      }
    }
  });
  return { top, bottom };
}

/**
 * Limits a pose's vertical travel to the canvas.
 *
 * A jump on a sprite whose hat already touches the top row would carry the
 * head off the canvas, and a clipped frame has lost pixels for good. The
 * pose is shifted back by however far its pixels would leave the canvas.
 *
 * A grounded pose is anchored by its planted foot, so only its top is held:
 * lifting the whole body a pixel to save a rotated toe would float the
 * character for one frame, which is worse than the clipped toe.
 */
function keepOnCanvas(rig: Rig, pose: Pose, grounded: boolean): Pose {
  const { top, bottom } = posedExtent(rig, pose);
  if (!Number.isFinite(top)) return pose;
  let shift = 0;
  if (top < 0) shift = -top;
  else if (!grounded && bottom > rig.source.height - 1) shift = rig.source.height - 1 - bottom;
  if (shift === 0) return pose;

  const scaleY = Math.max(1, rig.bounds.height - 1);
  const joints: Partial<Record<Joint, { x: number; y: number }>> = {};
  for (const [joint, position] of Object.entries(pose.joints) as [Joint, { x: number; y: number }][]) {
    joints[joint] = { x: position.x, y: position.y + shift / scaleY };
  }
  return { type: pose.type, joints };
}

export interface SkeletonAnimationOptions {
  /** Which way the character faces. Templates are authored facing east. */
  readonly facing?: "east" | "west";
  /** The rest pose the sequence was authored against. Defaults to the stock rest pose. */
  readonly reference?: Pose;
}

/**
 * Expands pose keyframes and poses the same untouched source into each frame.
 *
 * Each sampled pose is applied to `base` by bone rotation, so the character
 * keeps its own proportions; grounded sequences then plant the lowest foot on
 * the base pose's ground line so a stride does not hover.
 */
export function animateGridWithSkeleton(
  source: Grid,
  base: Pose,
  sequence: PoseSequence,
  frameCount: number,
  options: SkeletonAnimationOptions = {},
): { readonly poses: readonly Pose[]; readonly frames: readonly Grid[] } {
  const sampled = resamplePoses(sequence, frameCount);
  const bounds = contentBounds(source);
  if (bounds === null) {
    return { poses: sampled.poses, frames: sampled.poses.map(() => cloneGrid(source)) };
  }

  const mirror = options.facing === "west";
  const reference = options.reference ?? REST_POSE;
  const rest = mirror ? mirrorPose(reference) : reference;
  const ground = groundLine(base);
  const grounded = sequence.grounded !== false && ground !== null;

  const rig = createRig(source, base, bounds);
  const poses = sampled.poses.map((keyframe) => {
    const oriented = mirror ? mirrorPose(keyframe) : keyframe;
    const retargeted = retargetPoseOnto(oriented, rest, base, bounds);
    return keepOnCanvas(rig, grounded ? groundPose(retargeted, ground) : retargeted, grounded);
  });

  return { poses, frames: poses.map((pose) => poseRig(rig, pose)) };
}
