import { describe, expect, test } from "bun:test";
import { TRANSPARENT, createGrid, decodeGrid, gridFromRows, type Grid } from "@zenith/core";
import {
  BIPEDAL_BONES,
  BIPEDAL_JOINTS,
  QUADRUPEDAL_JOINTS,
  bonesFor,
  contentBounds,
  groundLine,
  groundPose,
  interpolatePose,
  jointToPixel,
  jointsFor,
  mirrorPose,
  poseToPixels,
  resamplePoses,
  retargetPose,
  retargetPoseOnto,
  transferAnimation,
  type ContentBounds,
  type Joint,
  type Pose,
} from "./model";
import { animateGridWithSkeleton, createRig, deformGridByPose, moveJointToPixel, poseRig } from "./deform";
import { estimateSkeleton } from "./estimate";
import { readSilhouette } from "./silhouette";
import { POSE_TEMPLATES, REST_POSE, TEMPLATE_NAMES, poseTemplate } from "./templates";
import merchant from "./fixtures/merchant-side-32.json";

/** A crude humanoid: narrow head straight on wide shoulders, narrow waist, two legs. */
function humanoid() {
  return gridFromRows([
    "..0000..",
    "..0000..",
    "00000000",
    "00000000",
    "..0000..",
    "..0000..",
    ".00..00.",
    ".00..00.",
  ]);
}

/**
 * A humanoid with each part on its own palette index, arms held away from the
 * torso, and (optionally) a staff down the left edge: head 0, torso 1, left
 * arm 2, right arm 3, left leg 4, right leg 5, staff 6.
 */
function figure({ staff = false }: { staff?: boolean } = {}) {
  const rows = [
    "......0000......",
    "......0000......",
    "......0000......",
    ".......00.......",
    "..2.11111111.3..",
    "..2.11111111.3..",
    "..2.11111111.3..",
    "..2.11111111.3..",
    "..2.11111111.3..",
    "..2.11111111.3..",
    "..2.11111111.3..",
    "..2.11111111.3..",
    "....44....55....",
    "....44....55....",
    "....44....55....",
    "....44....55....",
    "....44....55....",
    "....44....55....",
    "....44....55....",
    "....44....55....",
    "....44....55....",
    "....44....55....",
    "....44....55....",
    "....44....55....",
  ];
  if (!staff) return gridFromRows(rows);
  // Margin on every side, so the staff can swing with the hand and the body
  // can bob a pixel without either leaving the canvas.
  const blank = ".".repeat(rows[0]!.length + 8);
  return gridFromRows([
    blank,
    blank,
    ...rows.map((row, y) => `....${y >= 2 ? `6${row.slice(1)}` : row}....`),
    blank,
    blank,
  ]);
}

/** The product's real input: a model-generated merchant, resampled to 32px. */
function merchant32(): Grid {
  return decodeGrid(merchant.grid);
}

function cellAt(grid: Grid, x: number, y: number): number {
  return grid.cells[y * grid.width + x] ?? TRANSPARENT;
}

function opaqueCount(grid: Grid, index?: number): number {
  return [...grid.cells].filter((cell) => (index === undefined ? cell !== TRANSPARENT : cell === index)).length;
}

function joint(pose: Pose, name: Joint): { x: number; y: number } {
  const position = pose.joints[name];
  if (position === undefined) throw new Error(`${name} is missing from the pose.`);
  return position;
}

describe("contentBounds", () => {
  test("finds the opaque extent, ignoring transparent margins", () => {
    const grid = gridFromRows(["....", ".00.", ".00.", "...."]);
    expect(contentBounds(grid)).toEqual({ x: 1, y: 1, width: 2, height: 2 });
  });

  test("an empty grid has no bounds rather than a zero-size box at the origin", () => {
    expect(contentBounds(createGrid(4, 4, TRANSPARENT))).toBeNull();
  });
});

describe("estimateSkeleton", () => {
  test("places every bipedal joint", () => {
    const pose = estimateSkeleton(humanoid(), "bipedal") as Pose;
    for (const name of BIPEDAL_JOINTS) {
      expect(pose.joints[name]).toBeDefined();
    }
  });

  test("every joint is inside the content bounds, because each sits on a pixel of the silhouette", () => {
    for (const grid of [humanoid(), figure(), merchant32()]) {
      const pose = estimateSkeleton(grid) as Pose;
      for (const position of Object.values(pose.joints)) {
        expect(position.x).toBeGreaterThanOrEqual(0);
        expect(position.x).toBeLessThanOrEqual(1);
        expect(position.y).toBeGreaterThanOrEqual(0);
        expect(position.y).toBeLessThanOrEqual(1);
      }
    }
  });

  test("reads a head sitting straight on the shoulders, with no neck to find", () => {
    // The width profile is 4,4,8,8,4,4,2,2: the first peak is the shoulders,
    // and the valley below is the waist, not a neck. Read the other way the
    // head would be the shoulders and the shoulders the hips.
    const pose = estimateSkeleton(humanoid()) as Pose;
    const pixels = poseToPixels(pose, contentBounds(humanoid()) as ContentBounds);
    expect(pixels.head?.y).toBeLessThan(2);
    expect(pixels["shoulder-l"]?.y).toBe(2);
    expect(pixels["shoulder-r"]?.y).toBe(2);
    expect(pixels.pelvis?.y).toBeLessThan(6);
  });

  test("shoulders are wider apart than hips on a humanoid silhouette", () => {
    const pose = estimateSkeleton(humanoid()) as Pose;
    const shoulderSpan = joint(pose, "shoulder-r").x - joint(pose, "shoulder-l").x;
    const hipSpan = joint(pose, "hip-r").x - joint(pose, "hip-l").x;
    expect(shoulderSpan).toBeGreaterThan(hipSpan);
  });

  test("reads shoulders from the widest row, so they sit above the waist", () => {
    const pose = estimateSkeleton(humanoid()) as Pose;
    expect(joint(pose, "chest").y).toBeLessThan(joint(pose, "pelvis").y);
  });

  test("feet sit at the bottom of the content", () => {
    const pose = estimateSkeleton(humanoid()) as Pose;
    expect(joint(pose, "foot-l").y).toBe(1);
    expect(joint(pose, "foot-r").y).toBe(1);
  });

  test("an arm held away from the body is found as the run beside the torso", () => {
    const grid = figure();
    const pose = estimateSkeleton(grid) as Pose;
    const pixels = poseToPixels(pose, contentBounds(grid) as ContentBounds);
    // Left arm is column 2, right arm column 13; hands at the arm's last row.
    expect(pixels["hand-l"]).toEqual({ x: 2, y: 11 });
    expect(pixels["hand-r"]).toEqual({ x: 13, y: 11 });
    expect(pixels["elbow-l"]?.x).toBe(2);
    expect(pixels["elbow-r"]?.x).toBe(13);
    expect(cellAt(grid, pixels["hand-l"]?.x ?? -1, pixels["hand-l"]?.y ?? -1)).toBe(2);
  });

  test("legs are followed down their own runs to the feet, with knees between", () => {
    const grid = figure();
    const pose = estimateSkeleton(grid) as Pose;
    const pixels = poseToPixels(pose, contentBounds(grid) as ContentBounds);
    expect(pixels["foot-l"]?.y).toBe(23);
    expect(pixels["foot-r"]?.y).toBe(23);
    expect(cellAt(grid, pixels["foot-l"]?.x ?? -1, 23)).toBe(4);
    expect(cellAt(grid, pixels["foot-r"]?.x ?? -1, 23)).toBe(5);
    expect(cellAt(grid, pixels["knee-l"]?.x ?? -1, pixels["knee-l"]?.y ?? -1)).toBe(4);
    expect(pixels["knee-l"]?.y).toBeGreaterThan(pixels["hip-l"]?.y ?? 99);
    expect(pixels["knee-l"]?.y).toBeLessThan(23);
  });

  test("a held staff is not mistaken for an arm or a leg", () => {
    const with_ = estimateSkeleton(figure({ staff: true })) as Pose;
    const without = estimateSkeleton(figure()) as Pose;
    // The staff figure is the plain one shifted four columns right and two
    // rows down; every joint lands on the same pixel of the figure it did
    // without the staff.
    const staffBounds = contentBounds(figure({ staff: true })) as ContentBounds;
    const plainBounds = contentBounds(figure()) as ContentBounds;
    const shifted = Object.fromEntries(
      Object.entries(poseToPixels(without, plainBounds)).map(([name, at]) => [name, { x: at.x + 4, y: at.y + 2 }]),
    );
    expect(poseToPixels(with_, staffBounds)).toEqual(shifted);
  });

  /**
   * The test the previous estimator could not pass. On the real sprite it put
   * the head on the top pixel of the hat, the hands outside the silhouette and
   * the legs straight down from hips that were nowhere near the legs.
   */
  test("on the real 32px merchant every joint lands on an opaque pixel of the part it names", () => {
    const grid = merchant32();
    const pose = estimateSkeleton(grid) as Pose;
    const bounds = contentBounds(grid) as ContentBounds;
    const pixels = poseToPixels(pose, bounds);

    for (const [name, at] of Object.entries(pixels)) {
      expect(`${name}: ${String(cellAt(grid, at.x, at.y) !== TRANSPARENT)}`).toBe(`${name}: true`);
    }

    // Top to bottom, the spine reads in order and the legs reach the ground.
    expect(joint(pose, "head").y).toBeLessThan(joint(pose, "neck").y);
    expect(joint(pose, "neck").y).toBeLessThan(joint(pose, "chest").y);
    expect(joint(pose, "chest").y).toBeLessThan(joint(pose, "pelvis").y);
    expect(joint(pose, "pelvis").y).toBeLessThan(joint(pose, "knee-l").y);
    expect(joint(pose, "knee-l").y).toBeLessThan(joint(pose, "foot-l").y);
    expect(joint(pose, "foot-l").y).toBe(1);
    expect(joint(pose, "foot-r").y).toBe(1);

    // Two legs, side by side, and the staff down the left edge is not one of them.
    expect((pixels["foot-r"]?.x ?? 0) - (pixels["foot-l"]?.x ?? 0)).toBeGreaterThanOrEqual(4);
    expect(pixels["hip-l"]?.x).toBeLessThan(pixels["hip-r"]?.x ?? 0);
    expect(pixels["foot-l"]?.x).toBeGreaterThan(10);
    expect(pixels["hand-l"]?.x).toBeGreaterThan(10);
  });

  test("an empty sprite yields no pose rather than one centred on nothing", () => {
    expect(estimateSkeleton(createGrid(8, 8, TRANSPARENT))).toBeNull();
  });

  test("places every quadrupedal joint for that type", () => {
    const pose = estimateSkeleton(humanoid(), "quadrupedal") as Pose;
    for (const name of QUADRUPEDAL_JOINTS) {
      expect(pose.joints[name]).toBeDefined();
    }
  });

  test("a quadruped's head is at the end with the highest point, and its feet at the bottom", () => {
    const dog = gridFromRows([
      "00..........",
      "000.........",
      "000000000000",
      "000000000000",
      ".00......00.",
      ".00......00.",
    ]);
    const pose = estimateSkeleton(dog, "quadrupedal") as Pose;
    expect(joint(pose, "head").x).toBeLessThan(joint(pose, "tail").x);
    expect(joint(pose, "fore-foot-l").x).toBeLessThan(joint(pose, "hind-foot-l").x);
    expect(joint(pose, "fore-foot-l").y).toBe(1);
    expect(joint(pose, "hind-foot-r").y).toBe(1);
  });

  test("is deterministic", () => {
    const first = JSON.stringify(estimateSkeleton(merchant32()));
    for (let n = 0; n < 5; n += 1) {
      expect(JSON.stringify(estimateSkeleton(merchant32()))).toBe(first);
    }
  });

  test("survives a single-pixel sprite without dividing by zero", () => {
    const dot = gridFromRows(["0"]);
    const pose = estimateSkeleton(dot) as Pose;
    for (const position of Object.values(pose.joints)) {
      expect(Number.isFinite(position.x)).toBe(true);
      expect(Number.isFinite(position.y)).toBe(true);
    }
  });
});

describe("readSilhouette", () => {
  test("finds the staff down the merchant's left edge and nothing else", () => {
    const grid = merchant32();
    const silhouette = readSilhouette(grid, contentBounds(grid) as ContentBounds);
    expect(silhouette.propSides).toEqual(["l"]);
    // The staff column, mid-height and merged with the boot at the bottom.
    expect(silhouette.props[20 * grid.width + 10]).toBe(1);
    expect(silhouette.props[29 * grid.width + 10]).toBe(1);
    // The hat brim overhangs the staff's columns but never touches it.
    expect(silhouette.props[5 * grid.width + 11]).toBe(0);
    // The body.
    expect(silhouette.props[15 * grid.width + 16]).toBe(0);
  });

  test("a figure with nothing in its hands has no props", () => {
    const grid = figure();
    expect(readSilhouette(grid, contentBounds(grid) as ContentBounds).propSides).toEqual([]);
  });
});

describe("poseToPixels", () => {
  test("maps normalised joints into a sprite's bounds", () => {
    const pose: Pose = { type: "bipedal", joints: { head: { x: 0, y: 0 }, "foot-l": { x: 1, y: 1 } } };
    const pixels = poseToPixels(pose, { x: 2, y: 4, width: 8, height: 16 });
    expect(pixels.head).toEqual({ x: 2, y: 4 });
    expect(pixels["foot-l"]).toEqual({ x: 9, y: 19 });
  });
});

describe("bone rig", () => {
  /**
   * A spine of index 1 down column 0 and an arm of index 2 along row 0.
   * Bounds are the whole 8×8 grid, so a joint at (x, y) is pixel (x, y).
   */
  const toy = gridFromRows([
    "12222222",
    "1.......",
    "1.......",
    "1.......",
    "1.......",
    "1.......",
    "1.......",
    "1.......",
  ]);
  const n = (x: number, y: number) => ({ x: x / 7, y: y / 7 });
  const base: Pose = {
    type: "bipedal",
    joints: { pelvis: n(0, 7), chest: n(0, 0), "shoulder-l": n(0, 0), "shoulder-r": n(1, 0), "elbow-r": n(7, 0) },
  };

  test("rotating one bone moves exactly its pixels and leaves every other bone's pixels where they were", () => {
    // Swing the arm from pointing right to pointing down.
    const posed: Pose = { ...base, joints: { ...base.joints, "elbow-r": n(1, 6) } };
    const result = poseRig(createRig(toy, base), posed);

    for (let y = 0; y < 8; y += 1) expect(cellAt(result, 0, y)).toBe(1);
    for (let y = 0; y <= 6; y += 1) expect(cellAt(result, 1, y)).toBe(2);
    for (let x = 2; x < 8; x += 1) expect(cellAt(result, x, 0)).toBe(TRANSPARENT);
    expect(opaqueCount(result)).toBe(opaqueCount(toy));
  });

  test("an unchanged pose is byte-identical", () => {
    expect(deformGridByPose(toy, base, base).cells).toEqual(toy.cells);
  });

  test("a bone that stretches scales its pixels along its own axis only", () => {
    const posed: Pose = { ...base, joints: { ...base.joints, "elbow-r": n(4, 0) } };
    const result = poseRig(createRig(toy, base), posed);
    // Half the length: the arm now ends at column 4 and stays one pixel tall.
    expect(cellAt(result, 4, 0)).toBe(2);
    expect(cellAt(result, 5, 0)).toBe(TRANSPARENT);
    expect(cellAt(result, 2, 1)).toBe(TRANSPARENT);
  });

  test("moves indexed pixels without inventing palette entries", () => {
    const grid = figure();
    const estimated = estimateSkeleton(grid) as Pose;
    const posed: Pose = {
      ...estimated,
      joints: { ...estimated.joints, "hand-l": { x: 0, y: joint(estimated, "hand-l").y - 0.2 } },
    };
    const result = deformGridByPose(grid, estimated, posed);
    const before = new Set([...grid.cells]);
    for (const cell of result.cells) expect(before.has(cell)).toBe(true);
  });

  test("a pixel-snapped joint drag round-trips through normalised storage", () => {
    const bounds = { x: 0, y: 0, width: 5, height: 3 };
    const pose: Pose = { type: "bipedal", joints: { head: { x: 0.25, y: 0.5 } } };
    expect(moveJointToPixel(pose, "head", { x: 3, y: 1 }, bounds).joints.head).toEqual({ x: 0.75, y: 0.5 });
  });

  test("refuses poses that share no bone", () => {
    const a: Pose = { type: "bipedal", joints: { head: { x: 0.5, y: 0 } } };
    const b: Pose = { type: "bipedal", joints: { neck: { x: 0.5, y: 0.2 } } };
    expect(() => deformGridByPose(toy, a, b)).toThrow(/share no joints/);
  });

  test("a held staff moves as one upright piece with the hand, not as a fragment per bone", () => {
    const grid = figure({ staff: true });
    const staffPixels = opaqueCount(grid, 6);
    const estimated = estimateSkeleton(grid) as Pose;
    const cycle = animateGridWithSkeleton(grid, estimated, poseTemplate("walk"), 4);

    for (const frame of cycle.frames) {
      expect(opaqueCount(frame, 6)).toBe(staffPixels);
      // Every staff pixel is in one column, on consecutive rows.
      const columns = new Set<number>();
      const rows: number[] = [];
      for (let y = 0; y < frame.height; y += 1) {
        for (let x = 0; x < frame.width; x += 1) {
          if (cellAt(frame, x, y) === 6) {
            columns.add(x);
            rows.push(y);
          }
        }
      }
      expect(columns.size).toBe(1);
      expect(rows[rows.length - 1]! - rows[0]! + 1).toBe(staffPixels);
    }
  });
});

describe("retargeting", () => {
  test("a normalised pose transfers between bipedal variants unchanged", () => {
    const retargeted = retargetPose(REST_POSE, "bipedal-chibi");
    expect(retargeted.type).toBe("bipedal-chibi");
    expect(retargeted.joints).toEqual(REST_POSE.joints);
  });

  test("refuses a bipedal pose on a quadruped rather than dropping joints", () => {
    // Silently dropping the joints that do not match would produce a
    // four-legged character walking on two of its legs.
    expect(() => retargetPose(REST_POSE, "quadrupedal")).toThrow(/do not correspond/);
  });

  test("transferAnimation applies a whole cycle to another character", () => {
    const transferred = transferAnimation(poseTemplate("walk"), "bipedal-chibi");
    expect(transferred.type).toBe("bipedal-chibi");
    expect(transferred.poses).toHaveLength(POSE_TEMPLATES.walk?.poses.length as number);
    expect(transferred.poses.every((pose) => pose.type === "bipedal-chibi")).toBe(true);
  });
});

describe("retargetPoseOnto", () => {
  const bounds = { x: 0, y: 0, width: 33, height: 65 };
  const grid = figure();
  const base = estimateSkeleton(grid) as Pose;
  const figureBounds = contentBounds(grid) as ContentBounds;

  test("the rest pose applied to a character is that character's own skeleton", () => {
    const result = retargetPoseOnto(REST_POSE, REST_POSE, base, figureBounds);
    for (const name of BIPEDAL_JOINTS) {
      expect(joint(result, name).x).toBeCloseTo(joint(base, name).x, 9);
      expect(joint(result, name).y).toBeCloseTo(joint(base, name).y, 9);
    }
  });

  test("applies the template's rotation to the character's own bone, keeping its length", () => {
    // Turn the rest pose's left upper arm a quarter turn clockwise on screen.
    const shoulder = joint(REST_POSE, "shoulder-l");
    const elbow = joint(REST_POSE, "elbow-l");
    const dx = elbow.x - shoulder.x;
    const dy = elbow.y - shoulder.y;
    const turned: Pose = {
      ...REST_POSE,
      joints: { ...REST_POSE.joints, "elbow-l": { x: shoulder.x - dy, y: shoulder.y + dx } },
    };

    const result = retargetPoseOnto(turned, REST_POSE, base, bounds);
    const scaleX = bounds.width - 1;
    const scaleY = bounds.height - 1;
    const before = {
      x: (joint(base, "elbow-l").x - joint(base, "shoulder-l").x) * scaleX,
      y: (joint(base, "elbow-l").y - joint(base, "shoulder-l").y) * scaleY,
    };
    const after = {
      x: (joint(result, "elbow-l").x - joint(result, "shoulder-l").x) * scaleX,
      y: (joint(result, "elbow-l").y - joint(result, "shoulder-l").y) * scaleY,
    };
    expect(Math.hypot(after.x, after.y)).toBeCloseTo(Math.hypot(before.x, before.y), 9);
    expect(after.x).toBeCloseTo(-before.y, 9);
    expect(after.y).toBeCloseTo(before.x, 9);
    // Nothing else moved.
    expect(joint(result, "hand-r").x).toBeCloseTo(joint(base, "hand-r").x, 9);
    expect(joint(result, "hand-r").y).toBeCloseTo(joint(base, "hand-r").y, 9);
    expect(joint(result, "foot-l").x).toBeCloseTo(joint(base, "foot-l").x, 9);
    expect(joint(result, "foot-l").y).toBeCloseTo(joint(base, "foot-l").y, 9);
  });

  test("a stretched template bone is clamped rather than copied", () => {
    const shoulder = joint(REST_POSE, "shoulder-l");
    const elbow = joint(REST_POSE, "elbow-l");
    const stretched: Pose = {
      ...REST_POSE,
      joints: {
        ...REST_POSE.joints,
        "elbow-l": { x: shoulder.x + (elbow.x - shoulder.x) * 10, y: shoulder.y + (elbow.y - shoulder.y) * 10 },
      },
    };
    const result = retargetPoseOnto(stretched, REST_POSE, base, bounds);
    const length = (pose: Pose) =>
      Math.hypot(
        (joint(pose, "elbow-l").x - joint(pose, "shoulder-l").x) * (bounds.width - 1),
        (joint(pose, "elbow-l").y - joint(pose, "shoulder-l").y) * (bounds.height - 1),
      );
    expect(length(result)).toBeCloseTo(length(base) * 1.5, 9);
  });

  test("refuses a bipedal template on a quadruped", () => {
    const dog = estimateSkeleton(humanoid(), "quadrupedal") as Pose;
    expect(() => retargetPoseOnto(REST_POSE, REST_POSE, dog, bounds)).toThrow(/do not correspond/);
  });
});

describe("groundPose", () => {
  test("shifts the whole pose so its lowest foot is on the ground line", () => {
    const floating: Pose = {
      type: "bipedal",
      joints: { head: { x: 0.5, y: 0 }, "foot-l": { x: 0.4, y: 0.8 }, "foot-r": { x: 0.6, y: 0.9 } },
    };
    const grounded = groundPose(floating, 1);
    expect(joint(grounded, "foot-r").y).toBeCloseTo(1, 9);
    expect(joint(grounded, "foot-l").y).toBeCloseTo(0.9, 9);
    expect(joint(grounded, "head").y).toBeCloseTo(0.1, 9);
  });

  test("a pose without feet has no ground line and is returned as is", () => {
    const pose: Pose = { type: "bipedal", joints: { head: { x: 0.5, y: 0 } } };
    expect(groundLine(pose)).toBeNull();
    expect(groundPose(pose, 1)).toBe(pose);
  });
});

describe("mirrorPose", () => {
  test("reflects x and keeps every joint's name and y", () => {
    const mirrored = mirrorPose(poseTemplate("walk").poses[0] as Pose);
    const original = poseTemplate("walk").poses[0] as Pose;
    for (const name of BIPEDAL_JOINTS) {
      expect(joint(mirrored, name).x).toBeCloseTo(1 - joint(original, name).x, 9);
      expect(joint(mirrored, name).y).toBe(joint(original, name).y);
    }
  });
});

describe("interpolatePose", () => {
  test("blends joint positions", () => {
    const a: Pose = { type: "bipedal", joints: { head: { x: 0, y: 0 } } };
    const b: Pose = { type: "bipedal", joints: { head: { x: 1, y: 1 } } };
    expect(interpolatePose(a, b, 0.5).joints.head).toEqual({ x: 0.5, y: 0.5 });
  });

  test("clamps t to the 0–1 range", () => {
    const a: Pose = { type: "bipedal", joints: { head: { x: 0, y: 0 } } };
    const b: Pose = { type: "bipedal", joints: { head: { x: 1, y: 1 } } };
    expect(interpolatePose(a, b, 2).joints.head).toEqual({ x: 1, y: 1 });
    expect(interpolatePose(a, b, -1).joints.head).toEqual({ x: 0, y: 0 });
  });

  test("drops joints missing from either side rather than inventing them", () => {
    const a: Pose = { type: "bipedal", joints: { head: { x: 0, y: 0 }, neck: { x: 0, y: 0 } } };
    const b: Pose = { type: "bipedal", joints: { head: { x: 1, y: 1 } } };
    expect(Object.keys(interpolatePose(a, b, 0.5).joints)).toEqual(["head"]);
  });

  test("refuses to blend across character types", () => {
    const biped: Pose = { type: "bipedal", joints: {} };
    const quad: Pose = { type: "quadrupedal", joints: {} };
    expect(() => interpolatePose(biped, quad, 0.5)).toThrow(/Retarget first/);
  });
});

describe("resamplePoses", () => {
  test("expands keyframes to any frame count", () => {
    expect(resamplePoses(poseTemplate("walk"), 8).poses).toHaveLength(8);
  });

  test("wraps, so the cycle blends back toward its first keyframe", () => {
    const resampled = resamplePoses(poseTemplate("walk"), 4);
    expect(resampled.poses[0]?.joints["foot-l"]).toEqual(
      poseTemplate("walk").poses[0]?.joints["foot-l"] as ContentBounds
    );
    expect(resampled.poses[3]).toBeDefined();
  });

  test("keeps the sequence's grounding flag", () => {
    expect(resamplePoses(poseTemplate("jump"), 6).grounded).toBe(false);
    expect(resamplePoses(poseTemplate("walk"), 6).grounded).toBeUndefined();
  });

  test("a single-pose sequence repeats rather than failing", () => {
    const single = { name: "one", type: "bipedal" as const, poses: [REST_POSE] };
    expect(resamplePoses(single, 3).poses).toHaveLength(3);
  });

  test("rejects a non-positive count", () => {
    expect(() => resamplePoses(poseTemplate("walk"), 0)).toThrow(/positive integer/);
  });

  test("rejects an empty sequence", () => {
    expect(() => resamplePoses({ name: "none", type: "bipedal", poses: [] }, 4)).toThrow(
      /no poses/
    );
  });
});

describe("templates", () => {
  test("every template is bipedal and has at least two keyframes", () => {
    for (const name of TEMPLATE_NAMES) {
      const template = poseTemplate(name);
      expect(template.type).toBe("bipedal");
      expect(template.poses.length).toBeGreaterThanOrEqual(2);
    }
  });

  test("every template pose defines every bipedal joint", () => {
    for (const name of TEMPLATE_NAMES) {
      for (const pose of poseTemplate(name).poses) {
        for (const j of jointsFor("bipedal")) {
          expect(pose.joints[j]).toBeDefined();
        }
      }
    }
  });

  test("every keyframe keeps the rest pose's bone lengths, because keyframes are angles", () => {
    // Positions authored by hand drifted in length between keyframes and a
    // limb stretched mid-stride. Forward kinematics cannot.
    for (const name of TEMPLATE_NAMES) {
      for (const pose of poseTemplate(name).poses) {
        for (const [parent, child] of BIPEDAL_BONES) {
          const rest = Math.hypot(
            joint(REST_POSE, child).x - joint(REST_POSE, parent).x,
            joint(REST_POSE, child).y - joint(REST_POSE, parent).y,
          );
          const posed = Math.hypot(
            joint(pose, child).x - joint(pose, parent).x,
            joint(pose, child).y - joint(pose, parent).y,
          );
          expect(posed).toBeCloseTo(rest, 9);
        }
      }
    }
  });

  test("walk keyframes genuinely differ — a cycle of identical poses is not a cycle", () => {
    const [first, second] = poseTemplate("walk").poses;
    expect(JSON.stringify(first)).not.toBe(JSON.stringify(second));
  });

  test("walk opposes the arms to the legs, which is what makes it read as walking", () => {
    // Authored facing east: forward is +x. In the first contact the left leg
    // reaches forward and the left arm swings back; the right side is the reverse.
    const [contact] = poseTemplate("walk").poses as [Pose];
    expect(joint(contact, "foot-l").x).toBeGreaterThan(joint(contact, "hip-l").x);
    expect(joint(contact, "hand-l").x).toBeLessThan(joint(contact, "shoulder-l").x);
    expect(joint(contact, "foot-r").x).toBeLessThan(joint(contact, "hip-r").x);
    expect(joint(contact, "hand-r").x).toBeGreaterThan(joint(contact, "shoulder-r").x);
  });

  test("the second contact mirrors the first, so a full cycle has two strides", () => {
    const [first, , third] = poseTemplate("walk").poses as [Pose, Pose, Pose];
    expect(joint(third, "foot-r").x - joint(third, "hip-r").x).toBeCloseTo(
      joint(first, "foot-l").x - joint(first, "hip-l").x,
      9,
    );
  });

  test("only the jump and the idle bob leave the ground", () => {
    for (const name of TEMPLATE_NAMES) {
      expect(`${name}: ${String(poseTemplate(name).grounded === false)}`).toBe(
        `${name}: ${String(name === "jump" || name === "idle")}`,
      );
    }
  });

  test("names an unknown template with the available list", () => {
    expect(() => poseTemplate("moonwalk")).toThrow(/Available: idle, walk, run, attack, jump, hurt/);
  });
});

describe("animateGridWithSkeleton", () => {
  const grid = merchant32();
  const base = estimateSkeleton(grid) as Pose;
  const bounds = contentBounds(grid) as ContentBounds;

  test("returns the requested frame count and one pose per frame", () => {
    const cycle = animateGridWithSkeleton(grid, base, poseTemplate("walk"), 6);
    expect(cycle.frames).toHaveLength(6);
    expect(cycle.poses).toHaveLength(6);
  });

  test("a grounded cycle keeps the lowest foot on the character's own ground line", () => {
    const cycle = animateGridWithSkeleton(grid, base, poseTemplate("walk"), 6);
    for (const pose of cycle.poses) {
      expect(groundLine(pose)).toBeCloseTo(groundLine(base) as number, 9);
    }
  });

  test("every frame keeps the character's own limb lengths, not the template's", () => {
    const cycle = animateGridWithSkeleton(grid, base, poseTemplate("run"), 4);
    const length = (pose: Pose, parent: Joint, child: Joint) => {
      const a = jointToPixel(joint(pose, parent), bounds);
      const b = jointToPixel(joint(pose, child), bounds);
      return Math.hypot(b.x - a.x, b.y - a.y);
    };
    for (const pose of cycle.poses) {
      for (const [parent, child] of bonesFor("bipedal")) {
        const ratio = length(pose, parent, child) / Math.max(1e-9, length(base, parent, child));
        expect(ratio).toBeGreaterThanOrEqual(0.5 - 1e-9);
        expect(ratio).toBeLessThanOrEqual(1.5 + 1e-9);
      }
    }
  });

  test("facing west mirrors the stride", () => {
    const east = animateGridWithSkeleton(grid, base, poseTemplate("walk"), 4, { facing: "east" });
    const west = animateGridWithSkeleton(grid, base, poseTemplate("walk"), 4, { facing: "west" });
    const stride = (pose: Pose) => joint(pose, "foot-l").x - joint(base, "foot-l").x;
    expect(stride(east.poses[0] as Pose)).toBeGreaterThan(0);
    expect(stride(west.poses[0] as Pose)).toBeLessThan(0);
  });

  test("a jump on a sprite with no headroom is held on the canvas instead of clipped", () => {
    // The merchant's hat touches row 0; the airborne pose would carry it off.
    expect(bounds.y).toBe(0);
    const cycle = animateGridWithSkeleton(grid, base, poseTemplate("jump"), 6);
    let lifted = false;
    for (const pose of cycle.poses) {
      // The head owns the hat, so it cannot rise; the arms still go up.
      expect(jointToPixel(joint(pose, "head"), bounds).y).toBeGreaterThanOrEqual(
        jointToPixel(joint(base, "head"), bounds).y - 1e-6,
      );
      if (joint(pose, "hand-l").y < joint(base, "hand-l").y - 0.1) lifted = true;
    }
    expect(lifted).toBe(true);
    // The airborne frame is held exactly at the canvas edge: the hat still
    // touches row 0 rather than being pushed further down than it needs.
    const apex = cycle.poses.reduce((best, pose, index) =>
      joint(pose, "hand-l").y < joint(cycle.poses[best] as Pose, "hand-l").y ? index : best, 0);
    const frame = cycle.frames[apex] as Grid;
    let topRow = -1;
    for (let y = 0; y < frame.height && topRow < 0; y += 1) {
      for (let x = 0; x < frame.width; x += 1) {
        if (cellAt(frame, x, y) !== TRANSPARENT) {
          topRow = y;
          break;
        }
      }
    }
    expect(topRow).toBe(0);
  });

  test("never invents palette indices and keeps most of the sprite in every frame", () => {
    const palette = new Set([...grid.cells]);
    for (const name of TEMPLATE_NAMES) {
      const cycle = animateGridWithSkeleton(grid, base, poseTemplate(name), 4);
      for (const frame of cycle.frames) {
        for (const cell of frame.cells) expect(palette.has(cell)).toBe(true);
        // Limbs cross and overlap in a flat sprite; measured on the real
        // merchant, no template drops below three quarters of it.
        expect(opaqueCount(frame)).toBeGreaterThan(opaqueCount(grid) * 0.7);
      }
    }
  });
});
