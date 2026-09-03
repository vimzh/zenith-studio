import { BIPEDAL_BONES, type Joint, type JointPosition, type Pose, type PoseSequence } from "./model";

/**
 * Stock pose sequences.
 *
 * Authored as **joint angles, not positions**. A keyframe says how far each
 * bone turns from the rest pose; forward kinematics from the pelvis turns that
 * into positions with the rest pose's limb lengths intact. Authoring positions
 * by hand produced limbs that quietly changed length between keyframes, and
 * there was no way to see it until a leg stretched mid-stride.
 *
 * The angles are also what travels. `retargetPoseOnto` reads each bone's turn
 * relative to `REST_POSE` and applies it to a character's own skeleton, so the
 * numbers here are the motion and nothing else.
 *
 * Conventions: the character faces **east** (screen right); a west-facing
 * sprite mirrors the cycle. Screen y points down, so a positive angle turns a
 * bone clockwise on screen — a hanging limb swings toward screen-left (back)
 * and the upright spine leans toward screen-right (forward). `fwd` and `back`
 * spell that out at the call sites.
 *
 * Each is stored as keyframes, not as every frame. `resamplePoses` expands a
 * cycle to whatever frame count the asset wants, and interpolating between
 * keyframes is both smaller to store and easier to edit than a fixed strip.
 */

type Joints = Partial<Record<Joint, JointPosition>>;

/** The neutral standing pose every template varies from. */
const REST: Joints = {
  head: { x: 0.5, y: 0.07 },
  neck: { x: 0.5, y: 0.18 },
  chest: { x: 0.5, y: 0.3 },
  pelvis: { x: 0.5, y: 0.52 },
  "shoulder-l": { x: 0.36, y: 0.3 },
  "shoulder-r": { x: 0.64, y: 0.3 },
  "elbow-l": { x: 0.34, y: 0.44 },
  "elbow-r": { x: 0.66, y: 0.44 },
  "hand-l": { x: 0.33, y: 0.57 },
  "hand-r": { x: 0.67, y: 0.57 },
  "hip-l": { x: 0.44, y: 0.54 },
  "hip-r": { x: 0.56, y: 0.54 },
  "knee-l": { x: 0.44, y: 0.77 },
  "knee-r": { x: 0.56, y: 0.77 },
  "foot-l": { x: 0.44, y: 1 },
  "foot-r": { x: 0.56, y: 1 },
};

export const REST_POSE: Pose = { type: "bipedal", joints: { ...REST } };

type BoneName =
  | "spine"
  | "neck"
  | "head"
  | "clavicle-l"
  | "upper-arm-l"
  | "forearm-l"
  | "clavicle-r"
  | "upper-arm-r"
  | "forearm-r"
  | "hip-l"
  | "thigh-l"
  | "shin-l"
  | "hip-r"
  | "thigh-r"
  | "shin-r";

const BONE_NAMES: Readonly<Record<string, BoneName>> = {
  "pelvis>chest": "spine",
  "chest>neck": "neck",
  "neck>head": "head",
  "chest>shoulder-l": "clavicle-l",
  "shoulder-l>elbow-l": "upper-arm-l",
  "elbow-l>hand-l": "forearm-l",
  "chest>shoulder-r": "clavicle-r",
  "shoulder-r>elbow-r": "upper-arm-r",
  "elbow-r>hand-r": "forearm-r",
  "pelvis>hip-l": "hip-l",
  "hip-l>knee-l": "thigh-l",
  "knee-l>foot-l": "shin-l",
  "pelvis>hip-r": "hip-r",
  "hip-r>knee-r": "thigh-r",
  "knee-r>foot-r": "shin-r",
};

type Angles = Partial<Record<BoneName, number>>;

interface Keyframe {
  /** Degrees each bone turns from rest. Positive is clockwise on screen. */
  readonly angles?: Angles;
  /** Normalised displacement of the pelvis, carried by every joint. */
  readonly root?: { readonly x?: number; readonly y?: number };
}

/** A hanging limb swinging toward screen-right, or the spine leaning that way. */
const fwd = (degrees: number): number => -degrees;
/** Toward screen-left. */
const back = (degrees: number): number => degrees;

/** Forward kinematics from the rest pose: rotate each bone, keep its length. */
function pose({ angles = {}, root = {} }: Keyframe): Pose {
  const joints: Joints = { ...REST };
  const pelvis = REST.pelvis as JointPosition;
  joints.pelvis = { x: pelvis.x + (root.x ?? 0), y: pelvis.y + (root.y ?? 0) };

  for (const [parent, child] of BIPEDAL_BONES) {
    const name = BONE_NAMES[`${parent}>${child}`];
    const restParent = REST[parent] as JointPosition;
    const restChild = REST[child] as JointPosition;
    const placedParent = joints[parent] as JointPosition;
    const degrees = name === undefined ? 0 : (angles[name] ?? 0);
    const radians = (degrees * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    const vx = restChild.x - restParent.x;
    const vy = restChild.y - restParent.y;
    joints[child] = {
      x: placedParent.x + vx * cos - vy * sin,
      y: placedParent.y + vx * sin + vy * cos,
    };
  }

  return { type: "bipedal", joints };
}

/** Swaps every left bone's angle with its right counterpart. */
function mirrorAngles(angles: Angles): Angles {
  const out: Angles = {};
  for (const [name, value] of Object.entries(angles) as [BoneName, number][]) {
    const swapped = name.endsWith("-l")
      ? (`${name.slice(0, -2)}-r` as BoneName)
      : name.endsWith("-r")
        ? (`${name.slice(0, -2)}-l` as BoneName)
        : name;
    out[swapped] = value;
  }
  return out;
}

const WALK_CONTACT: Keyframe = {
  angles: {
    // Left leg reaching, nearly straight; right leg trailing with the knee bent.
    "thigh-l": fwd(28),
    "shin-l": fwd(18),
    "thigh-r": back(25),
    "shin-r": back(45),
    // Arms oppose the legs, which is what makes a walk read as walking.
    "upper-arm-l": back(25),
    "forearm-l": back(15),
    "upper-arm-r": fwd(25),
    "forearm-r": fwd(45),
    spine: fwd(4),
  },
  root: { y: 0.01 },
};

const WALK_PASS: Keyframe = {
  angles: {
    // Left leg planted under the body; right knee lifted, foot tucked.
    "thigh-l": back(5),
    "shin-l": back(5),
    "thigh-r": fwd(12),
    "shin-r": back(35),
    "upper-arm-l": back(5),
    "forearm-l": back(5),
    "upper-arm-r": fwd(5),
    "forearm-r": fwd(25),
    spine: fwd(4),
  },
  root: { y: -0.02 },
};

const RUN_CONTACT: Keyframe = {
  angles: {
    "thigh-l": fwd(40),
    "shin-l": fwd(5),
    "thigh-r": back(45),
    "shin-r": back(70),
    "upper-arm-l": back(45),
    "forearm-l": back(30),
    "upper-arm-r": fwd(45),
    "forearm-r": fwd(80),
    spine: fwd(12),
    neck: fwd(5),
  },
  root: { y: 0.02 },
};

const RUN_PASS: Keyframe = {
  angles: {
    "thigh-l": back(10),
    "shin-l": back(20),
    "thigh-r": fwd(30),
    "shin-r": back(60),
    "upper-arm-l": back(10),
    "forearm-l": back(40),
    "upper-arm-r": fwd(10),
    "forearm-r": fwd(40),
    spine: fwd(12),
    neck: fwd(5),
  },
  root: { y: -0.03 },
};

function mirrored(keyframe: Keyframe): Keyframe {
  return { angles: mirrorAngles(keyframe.angles ?? {}), root: keyframe.root };
}

/**
 * Templates are keyframes only.
 *
 * A walk is four: two contacts and the two passes between them. Stored as a
 * strip it would be four things to keep consistent when the proportions change,
 * where four keyframes of angles stay correct.
 */
export const POSE_TEMPLATES: Readonly<Record<string, PoseSequence>> = Object.freeze({
  idle: {
    name: "idle",
    type: "bipedal",
    // The whole body rises a pixel and settles: the feet lift with it, so this
    // is deliberately not grounded.
    grounded: false,
    poses: [
      REST_POSE,
      pose({
        angles: { "upper-arm-l": back(3), "upper-arm-r": fwd(3) },
        root: { y: -0.03 },
      }),
    ],
  },

  walk: {
    name: "walk",
    type: "bipedal",
    poses: [pose(WALK_CONTACT), pose(WALK_PASS), pose(mirrored(WALK_CONTACT)), pose(mirrored(WALK_PASS))],
  },

  run: {
    name: "run",
    type: "bipedal",
    poses: [pose(RUN_CONTACT), pose(RUN_PASS), pose(mirrored(RUN_CONTACT)), pose(mirrored(RUN_PASS))],
  },

  attack: {
    name: "attack",
    type: "bipedal",
    poses: [
      // Ready: weapon arm drawn back, weight on the back foot.
      pose({
        angles: {
          "upper-arm-r": back(20),
          "forearm-r": back(60),
          spine: back(5),
          "thigh-l": fwd(10),
          "thigh-r": back(10),
        },
      }),
      // Wind-up: arm raised behind the head.
      pose({
        angles: {
          "upper-arm-r": back(110),
          "forearm-r": back(150),
          spine: back(12),
          neck: back(8),
          "thigh-l": fwd(5),
          "thigh-r": back(15),
        },
      }),
      // Strike: arm out ahead, lunging onto the front foot.
      pose({
        angles: {
          "upper-arm-r": fwd(100),
          "forearm-r": fwd(95),
          "upper-arm-l": back(30),
          "forearm-l": back(30),
          spine: fwd(18),
          neck: fwd(8),
          head: fwd(5),
          "thigh-l": fwd(30),
          "shin-l": fwd(15),
          "thigh-r": back(20),
          "shin-r": back(10),
        },
      }),
    ],
  },

  jump: {
    name: "jump",
    type: "bipedal",
    grounded: false,
    poses: [
      // Crouch: knees bent, arms swung back, pelvis dropped to keep the feet down.
      pose({
        angles: {
          "thigh-l": fwd(35),
          "shin-l": back(35),
          "thigh-r": fwd(35),
          "shin-r": back(35),
          spine: fwd(20),
          "upper-arm-l": back(40),
          "forearm-l": back(20),
          "upper-arm-r": back(40),
          "forearm-r": back(20),
        },
        root: { y: 0.08 },
      }),
      // Airborne: legs straight, arms thrown up.
      pose({
        angles: {
          "upper-arm-l": back(150),
          "forearm-l": back(150),
          "upper-arm-r": fwd(150),
          "forearm-r": fwd(150),
        },
        root: { y: -0.16 },
      }),
      // Landing: soft knees, arms out for balance.
      pose({
        angles: {
          "thigh-l": fwd(20),
          "shin-l": back(20),
          "thigh-r": fwd(20),
          "shin-r": back(20),
          spine: fwd(10),
          "upper-arm-l": back(30),
          "upper-arm-r": fwd(30),
        },
        root: { y: 0.04 },
      }),
    ],
  },

  hurt: {
    name: "hurt",
    type: "bipedal",
    poses: [
      REST_POSE,
      // Recoil: torso and head thrown back, arms flung forward, a stagger step.
      pose({
        angles: {
          spine: back(15),
          neck: back(10),
          head: back(10),
          "upper-arm-l": fwd(35),
          "forearm-l": fwd(30),
          "upper-arm-r": fwd(35),
          "forearm-r": fwd(30),
          "thigh-l": back(10),
          "thigh-r": fwd(10),
          "shin-r": fwd(10),
        },
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
