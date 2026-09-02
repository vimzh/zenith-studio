import { describe, expect, test } from "bun:test";
import { TRANSPARENT, createGrid, gridFromRows } from "@zenith/core";
import {
  BIPEDAL_JOINTS,
  QUADRUPEDAL_JOINTS,
  contentBounds,
  interpolatePose,
  jointsFor,
  poseToPixels,
  resamplePoses,
  retargetPose,
  transferAnimation,
  type Pose,
} from "./model";
import { animateGridWithSkeleton, deformGridByPose, moveJointToPixel } from "./deform";
import { estimateSkeleton } from "./estimate";
import { POSE_TEMPLATES, REST_POSE, TEMPLATE_NAMES, poseTemplate } from "./templates";

/** A crude humanoid: narrow head, wide shoulders, narrow waist, two legs. */
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
    for (const joint of BIPEDAL_JOINTS) {
      expect(pose.joints[joint]).toBeDefined();
    }
  });

  test("returns normalised coordinates, which is what makes a pose portable", () => {
    const pose = estimateSkeleton(humanoid()) as Pose;
    for (const position of Object.values(pose.joints)) {
      expect(position.x).toBeGreaterThanOrEqual(-0.1);
      expect(position.x).toBeLessThanOrEqual(1.1);
      expect(position.y).toBeGreaterThanOrEqual(-0.1);
      expect(position.y).toBeLessThanOrEqual(1.1);
    }
  });

  test("reads shoulders from the widest row, so they sit above the waist", () => {
    const pose = estimateSkeleton(humanoid()) as Pose;
    const chest = pose.joints.chest as { y: number };
    const pelvis = pose.joints.pelvis as { y: number };
    expect(chest.y).toBeLessThan(pelvis.y);
  });

  test("shoulders are wider apart than hips on a humanoid silhouette", () => {
    const pose = estimateSkeleton(humanoid()) as Pose;
    const shoulderSpan =
      (pose.joints["shoulder-r"] as { x: number }).x - (pose.joints["shoulder-l"] as { x: number }).x;
    const hipSpan = (pose.joints["hip-r"] as { x: number }).x - (pose.joints["hip-l"] as { x: number }).x;
    expect(shoulderSpan).toBeGreaterThan(hipSpan);
  });

  test("feet sit at the bottom of the content", () => {
    const pose = estimateSkeleton(humanoid()) as Pose;
    expect((pose.joints["foot-l"] as { y: number }).y).toBe(1);
    expect((pose.joints["foot-r"] as { y: number }).y).toBe(1);
  });

  test("an empty sprite yields no pose rather than one centred on nothing", () => {
    expect(estimateSkeleton(createGrid(8, 8, TRANSPARENT))).toBeNull();
  });

  test("places every quadrupedal joint for that type", () => {
    const pose = estimateSkeleton(humanoid(), "quadrupedal") as Pose;
    for (const joint of QUADRUPEDAL_JOINTS) {
      expect(pose.joints[joint]).toBeDefined();
    }
  });

  test("is deterministic", () => {
    const first = JSON.stringify(estimateSkeleton(humanoid()));
    for (let n = 0; n < 5; n += 1) {
      expect(JSON.stringify(estimateSkeleton(humanoid()))).toBe(first);
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

describe("poseToPixels", () => {
  test("maps normalised joints into a sprite's bounds", () => {
    const pose: Pose = { type: "bipedal", joints: { head: { x: 0, y: 0 }, "foot-l": { x: 1, y: 1 } } };
    const pixels = poseToPixels(pose, { x: 2, y: 4, width: 8, height: 16 });
    expect(pixels.head).toEqual({ x: 2, y: 4 });
    expect(pixels["foot-l"]).toEqual({ x: 9, y: 19 });
  });
});

describe("flat sprite rig", () => {
  const bounds = { x: 0, y: 0, width: 5, height: 3 };
  const base: Pose = { type: "bipedal", joints: { head: { x: 0.25, y: 0.5 } } };
  const moved: Pose = { type: "bipedal", joints: { head: { x: 0.75, y: 0.5 } } };

  test("a pixel-snapped joint drag round-trips through normalised storage", () => {
    expect(moveJointToPixel(base, "head", { x: 3, y: 1 }, bounds).joints.head).toEqual({ x: 0.75, y: 0.5 });
  });

  test("moves indexed pixels without inventing palette entries", () => {
    const source = createGrid(5, 3, TRANSPARENT);
    source.cells[1 * source.width + 1] = 0;
    const result = deformGridByPose(source, base, moved, bounds);
    expect(result.cells[1 * result.width + 3]).toBe(0);
    expect([...result.cells].every((cell) => cell === TRANSPARENT || cell === 0)).toBe(true);
  });

  test("an unchanged pose is byte-identical and a template returns the requested count", () => {
    const source = createGrid(5, 3, 0);
    expect(deformGridByPose(source, base, base, bounds).cells).toEqual(source.cells);
    expect(animateGridWithSkeleton(source, REST_POSE, poseTemplate("walk"), 6).frames).toHaveLength(6);
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
      poseTemplate("walk").poses[0]?.joints["foot-l"] as never
    );
    expect(resampled.poses[3]).toBeDefined();
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
        for (const joint of jointsFor("bipedal")) {
          expect(pose.joints[joint]).toBeDefined();
        }
      }
    }
  });

  test("walk keyframes genuinely differ — a cycle of identical poses is not a cycle", () => {
    const [first, second] = poseTemplate("walk").poses;
    expect(JSON.stringify(first)).not.toBe(JSON.stringify(second));
  });

  test("walk opposes the arms to the legs, which is what makes it read as walking", () => {
    const [first] = poseTemplate("walk").poses;
    const footL = (first as Pose).joints["foot-l"] as { x: number };
    const handL = (first as Pose).joints["hand-l"] as { x: number };
    const footR = (first as Pose).joints["foot-r"] as { x: number };
    const handR = (first as Pose).joints["hand-r"] as { x: number };
    // Left foot forward (smaller x) pairs with left hand back (larger x).
    expect(footL.x).toBeLessThan(footR.x);
    expect(handL.x).toBeGreaterThan(handR.x - 0.4);
  });

  test("names an unknown template with the available list", () => {
    expect(() => poseTemplate("moonwalk")).toThrow(/Available: idle, walk, run, attack, jump, hurt/);
  });
});
