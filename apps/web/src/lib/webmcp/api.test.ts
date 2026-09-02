import { describe, expect, test } from "bun:test";
import { buildPosePrompt } from "./api";

describe("buildPosePrompt", () => {
  test("grounds motion in the existing subject and visible equipment", () => {
    const prompt = buildPosePrompt("armoured knight with a shield", "overhead strike", 4);
    expect(prompt).toContain("what moves, what remains stable");
    expect(prompt).toContain("visible equipment or weapon position");
    expect(prompt).toContain("Do not invent or remove equipment, props, or effects");
    expect(prompt).toContain("exactly 4 lines");
  });
});
