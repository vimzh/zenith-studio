import type { Joint, JointPosition, Pose, PoseSequence } from "./model";

/**
 * Stock pose sequences.
 *
 * Normalised, so each applies to any bipedal character regardless of size or
 * proportions — that portability is the entire reason to author a cycle as
 * poses rather than as pixels.
 *
 * Each is stored as keyframes, not as every frame. `resamplePoses` expands a
 * cycle to whatever frame count the asset wants, and interpolating between
 * keyframes is both smaller to store and easier to edit than a fixed strip.
 */

type Joints = Partial<Record<Joint, JointPosition>>;

/** The neutral standing pose every template varies from. */
const REST: Joints = {
  head: { x: 0.5, y: 0.0 },
  neck: { x: 0.5, y: 0.18 },
  chest: { x: 0.5, y: 0.3 },
  pelvis: { x: 0.5, y: 0.52 },
  "shoulder-l": { x: 0.34, y: 0.28 },
  "shoulder-r": { x: 0.66, y: 0.28 },
  "elbow-l": { x: 0.3, y: 0.42 },
  "elbow-r": { x: 0.7, y: 0.42 },
  "hand-l": { x: 0.28, y: 0.56 },
  "hand-r": { x: 0.72, y: 0.56 },
  "hip-l": { x: 0.42, y: 0.54 },
  "hip-r": { x: 0.58, y: 0.54 },
  "knee-l": { x: 0.42, y: 0.76 },
  "knee-r": { x: 0.58, y: 0.76 },
  "foot-l": { x: 0.42, y: 1 },
  "foot-r": { x: 0.58, y: 1 },
};

function pose(overrides: Joints): Pose {
  return { type: "bipedal", joints: { ...REST, ...overrides } };
}

export const REST_POSE: Pose = pose({});

/**
 * Templates are keyframes only.
 *
 * A walk is two contact poses; the passes between them are interpolation. A
 * cycle stored as four hand-placed frames is four things to keep consistent
 * when the proportions change, where two keyframes stay correct.
 */
export const POSE_TEMPLATES: Readonly<Record<string, PoseSequence>> = Object.freeze({
  idle: {
    name: "idle",
    type: "bipedal",
    poses: [
      REST_POSE,
      pose({
        head: { x: 0.5, y: 0.02 },
        chest: { x: 0.5, y: 0.32 },
        pelvis: { x: 0.5, y: 0.54 },
      }),
    ],
  },

  walk: {
    name: "walk",
    type: "bipedal",
    poses: [
      // Left forward, right back — and the arms opposed, which is what makes a
      // walk read as a walk rather than a shuffle.
      pose({
        "knee-l": { x: 0.4, y: 0.72 },
        "foot-l": { x: 0.34, y: 0.94 },
        "knee-r": { x: 0.6, y: 0.78 },
        "foot-r": { x: 0.68, y: 1 },
        "elbow-l": { x: 0.32, y: 0.4 },
        "hand-l": { x: 0.36, y: 0.52 },
        "elbow-r": { x: 0.68, y: 0.44 },
        "hand-r": { x: 0.64, y: 0.58 },
      }),
      pose({
        "knee-l": { x: 0.4, y: 0.78 },
        "foot-l": { x: 0.32, y: 1 },
        "knee-r": { x: 0.6, y: 0.72 },
        "foot-r": { x: 0.66, y: 0.94 },
        "elbow-l": { x: 0.32, y: 0.44 },
        "hand-l": { x: 0.36, y: 0.58 },
        "elbow-r": { x: 0.68, y: 0.4 },
        "hand-r": { x: 0.64, y: 0.52 },
      }),
    ],
  },

  run: {
    name: "run",
    type: "bipedal",
    poses: [
      pose({
        chest: { x: 0.53, y: 0.28 },
        "knee-l": { x: 0.36, y: 0.66 },
        "foot-l": { x: 0.28, y: 0.84 },
        "knee-r": { x: 0.64, y: 0.8 },
        "foot-r": { x: 0.74, y: 1 },
        "hand-l": { x: 0.4, y: 0.4 },
        "hand-r": { x: 0.6, y: 0.66 },
      }),
      pose({
        chest: { x: 0.53, y: 0.28 },
        "knee-l": { x: 0.36, y: 0.8 },
        "foot-l": { x: 0.26, y: 1 },
        "knee-r": { x: 0.64, y: 0.66 },
        "foot-r": { x: 0.72, y: 0.84 },
        "hand-l": { x: 0.4, y: 0.66 },
        "hand-r": { x: 0.6, y: 0.4 },
      }),
    ],
  },

  attack: {
    name: "attack",
    type: "bipedal",
    poses: [
      pose({
        "shoulder-r": { x: 0.68, y: 0.26 },
        "elbow-r": { x: 0.8, y: 0.28 },
        "hand-r": { x: 0.86, y: 0.14 },
      }),
      pose({
        chest: { x: 0.54, y: 0.3 },
        "shoulder-r": { x: 0.7, y: 0.3 },
        "elbow-r": { x: 0.84, y: 0.44 },
        "hand-r": { x: 0.94, y: 0.6 },
      }),
    ],
  },

  jump: {
    name: "jump",
    type: "bipedal",
    poses: [
      pose({
        pelvis: { x: 0.5, y: 0.58 },
        "knee-l": { x: 0.4, y: 0.8 },
        "knee-r": { x: 0.6, y: 0.8 },
        "hand-l": { x: 0.26, y: 0.62 },
        "hand-r": { x: 0.74, y: 0.62 },
      }),
      pose({
        head: { x: 0.5, y: -0.04 },
        pelvis: { x: 0.5, y: 0.46 },
        "knee-l": { x: 0.4, y: 0.7 },
        "knee-r": { x: 0.6, y: 0.7 },
        "foot-l": { x: 0.42, y: 0.9 },
        "foot-r": { x: 0.58, y: 0.9 },
        "hand-l": { x: 0.28, y: 0.3 },
        "hand-r": { x: 0.72, y: 0.3 },
      }),
    ],
  },

  hurt: {
    name: "hurt",
    type: "bipedal",
    poses: [
      REST_POSE,
      pose({
        head: { x: 0.44, y: 0.04 },
        neck: { x: 0.45, y: 0.2 },
        chest: { x: 0.46, y: 0.32 },
        "hand-l": { x: 0.24, y: 0.48 },
        "hand-r": { x: 0.68, y: 0.48 },
      }),
    ],
  },
});

export const TEMPLATE_NAMES = Object.keys(POSE_TEMPLATES);

export function poseTemplate(name: string): PoseSequence {
  const template = POSE_TEMPLATES[name];
  if (template === undefined) {
    throw new Error(`No pose template '${name}'. Available: ${TEMPLATE_NAMES.join(", ")}.`);
  }
  return template;
}
