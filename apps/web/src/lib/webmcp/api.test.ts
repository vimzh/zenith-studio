import { afterEach, describe, expect, spyOn, test } from "bun:test";
import {
  __allowPaidRequestsForTest,
  buildJudgePrompt,
  buildPosePrompt,
  deriveAnimationSheet,
  deriveImage,
  deriveImages,
  generateImage,
  judgeFrames,
  MAX_EFFECTS_LENGTH,
  MAX_PLANNED_POSE_LENGTH,
  MAX_POSE_LENGTH,
  parsePosePlan,
  parseVerdicts,
  planPoses,
  type PlannedPose,
} from "./api";

const restore: (() => void)[] = [];
afterEach(() => {
  for (const reset of restore.splice(0)) reset();
  __allowPaidRequestsForTest(false);
});

type Content = string | { type: string; text?: string; image_url?: { url: string } }[];

function sentContent(call: unknown[] | undefined): Content {
  const body = JSON.parse(String((call?.[1] as { body?: string } | undefined)?.body)) as { messages: { content: Content }[] };
  return body.messages[0]!.content;
}

describe("buildPosePrompt", () => {
  test("plans like an animator around the source drawing as the rest pose, read from the image", () => {
    const prompt = buildPosePrompt({
      subject: "armoured knight with a shield",
      motion: "overhead strike",
      frames: 4,
      facing: "strict side profile facing screen-right, with the nose pointing right",
      source: new Uint8Array([1]),
    });
    expect(prompt).toContain("attached image is the sprite's current drawing");
    expect(prompt).toContain("plan from exactly that pose");
    expect(prompt).toContain("frame 0 of the loop");
    expect(prompt).toContain("plan frames 1 to 4");
    expect(prompt).toContain("returns to frame 0 after frame 4");
    expect(prompt).toContain("anticipation");
    expect(prompt).toContain("follow-through and recovery");
    expect(prompt).toContain("drawn strict side profile facing screen-right");
    expect(prompt).toContain("hold in milliseconds between 60 and 400");
    expect(prompt).toContain('"rest", the hold on frame 0 between repeats');
    expect(prompt).toContain('"rest":600');
    expect(prompt).toContain("Do not invent or remove equipment, props or effects");
    expect(prompt).toContain('"source":"one sentence describing the rest pose');
    expect(prompt).toContain("exactly 4 entries");
  });

  test("without an image it plans from the description alone and asks for no effects", () => {
    const prompt = buildPosePrompt({ subject: "sword knight", motion: "swing the sword without moving the planted foot", frames: 12 });
    expect(prompt).toContain("current drawing is its rest pose");
    expect(prompt).not.toContain("attached image");
    expect(prompt).toContain("self-contained");
    expect(prompt).toContain(`at most ${String(MAX_PLANNED_POSE_LENGTH)} characters`);
    expect(prompt).toContain("airborne only when both feet leave the ground");
    expect(prompt).toContain("Never describe art style or colours");
    expect(prompt).not.toContain("Effects requested");
    expect(prompt).not.toContain('"effect"');
    expect(prompt).not.toContain("undefined");
  });

  test("with effects it asks where each effect sits per frame and adds the field to the reply shape", () => {
    const prompt = buildPosePrompt({ subject: "warrior", motion: "slash", frames: 4, effects: "a purple trail behind the blade" });
    expect(prompt).toContain('Effects requested: "a purple trail behind the blade"');
    expect(prompt).toContain("a trail lags behind the moving part");
    expect(prompt).toContain("never hide the character's face or silhouette");
    expect(prompt).toContain('"effect":"..."');
  });
});

describe("parsePosePlan", () => {
  test("reads the JSON it asked for: the source reading, and contact, hold and effect per frame", () => {
    const plan = parsePosePlan(
      'Here you go:\n{"source":"Guard up, facing right.","rest":"700","frames":[{"pose":"crouch","contact":"grounded","ms":90,"effect":"none"},{"pose":" leap ","contact":"airborne","ms":"150","effect":" white arc under the feet "},{"pose":"land","ms":9999}]}',
      3,
    );
    expect(plan.source).toBe("Guard up, facing right.");
    expect(plan.restMs).toBe(700);
    expect(parsePosePlan('{"rest":5000,"frames":["a"]}', 1).restMs).toBe(1200);
    expect(parsePosePlan('{"rest":1,"frames":["a"]}', 1).restMs).toBe(100);
    expect(plan.frames).toEqual([
      { pose: "crouch", contact: "grounded", ms: 90 },
      { pose: "leap", contact: "airborne", ms: 150, effect: "white arc under the feet" },
      { pose: "land", contact: "grounded", ms: 400 },
    ]);
  });

  test("falls back to numbered lines with default holds when the model ignores the format", () => {
    const plan = parsePosePlan("1. Guard tightens\n2) Fist extends\nFrame 3: Arm retracts\n", 3);
    expect(plan.source).toBe("");
    expect(plan.restMs).toBe(500);
    expect(plan.frames.map((entry) => entry.pose)).toEqual(["Guard tightens", "Fist extends", "Arm retracts"]);
    expect(plan.frames.every((entry) => entry.contact === "grounded" && entry.ms === 250 && entry.effect === undefined)).toBe(true);
  });

  test("takes only the frames asked for when the model over-delivers", () => {
    expect(parsePosePlan('{"frames":["a","b","c"]}', 2).frames).toHaveLength(2);
  });

  test("refuses too few poses and names the count", () => {
    expect(() => parsePosePlan('{"frames":[{"pose":"one"}]}', 3)).toThrow("described 1 poses but 3");
    expect(() => parsePosePlan("", 2)).toThrow("described 0 poses");
  });

  test("refuses a pose over the planner's cap rather than cutting it", () => {
    const content = JSON.stringify({ frames: [{ pose: "x".repeat(MAX_PLANNED_POSE_LENGTH + 1) }, { pose: "ok" }] });
    expect(() => parsePosePlan(content, 2)).toThrow(`Pose 1 is ${String(MAX_PLANNED_POSE_LENGTH + 1)} characters`);
  });
});

describe("judge", () => {
  const plan: PlannedPose[] = [
    { pose: "coil", contact: "grounded", ms: 90 },
    { pose: "extend", contact: "grounded", ms: 150, effect: "white arc ahead of the fist" },
  ];

  test("the judge is told the plan, the strip's layout, and what to be strict about", () => {
    const prompt = buildJudgePrompt({ strip: new Uint8Array([1]), plan, effects: "a white air-cut arc" });
    expect(prompt).toContain("source sprite at rest on the far left, then frames 1 to 2");
    expect(prompt).toContain("Frame 1: coil");
    expect(prompt).toContain("Frame 2: extend Effect: white arc ahead of the fist");
    expect(prompt).toContain('Effects requested: "a white air-cut arc"');
    expect(prompt).toContain("Be strict about identity, scale, facing, completeness and the stage of the motion");
    expect(prompt).toContain("Do not reject a frame for details of a foot, heel, hand, head or lean");
    expect(prompt).toContain("exactly 2 entries");
    expect(buildJudgePrompt({ strip: new Uint8Array([1]), plan })).toContain("No effects were requested");
  });

  test("verdicts are read leniently: unmentioned frames pass, problems without ok fail, strays are ignored", () => {
    const verdicts = parseVerdicts(
      'Sure.\n{"frames":[{"frame":2,"ok":false,"problems":["The arm is not extended.", ""]},{"frame":7,"ok":false,"problems":["x"]},{"problems":["Facing flipped."]}]}',
      3,
    );
    expect(verdicts).toEqual([
      { frame: 1, ok: true, problems: [] },
      { frame: 2, ok: false, problems: ["The arm is not extended."] },
      { frame: 3, ok: false, problems: ["Facing flipped."] },
    ]);
    expect(parseVerdicts("no json here", 2)).toEqual([
      { frame: 1, ok: true, problems: [] },
      { frame: 2, ok: true, problems: [] },
    ]);
  });

  test("judging sends the strip as an image beside the prompt", async () => {
    __allowPaidRequestsForTest(true);
    const fetch = spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ message: { content: '{"frames":[{"frame":1,"ok":true}]}' } }));
    restore.push(() => fetch.mockRestore());
    const verdicts = await judgeFrames({ strip: new Uint8Array([137, 80, 78, 71]), plan: plan.slice(0, 1) });
    expect(verdicts).toEqual([{ frame: 1, ok: true, problems: [] }]);
    const content = sentContent(fetch.mock.calls[0]);
    expect(Array.isArray(content)).toBe(true);
    const parts = content as { type: string; text?: string; image_url?: { url: string } }[];
    expect(parts[0]?.type).toBe("text");
    expect(parts[1]?.image_url?.url).toBe("data:image/png;base64,iVBORw==");
    expect(await judgeFrames({ strip: new Uint8Array([1]), plan: [] })).toEqual([]);
  });
});

test("image requests retain 16000-character prompts and instructions without truncating", async () => {
  __allowPaidRequestsForTest(true);
  const fetch = spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(Response.json({ image: "png", model: "test" }))
    .mockResolvedValueOnce(Response.json({ image: "png", model: "test" }));
  restore.push(() => fetch.mockRestore());
  const prompt = "Moss Knight. ".padEnd(16000, ".");
  expect(prompt.length).toBe(16000);
  await generateImage({ prompt });
  await deriveImage(new Uint8Array([1]), prompt);
  expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body)).prompt).toBe(prompt);
  expect((fetch.mock.calls[1]?.[1]?.body as FormData).get("instruction")).toBe(prompt);
});

test("generate and derive reject overlong text before any paid request", async () => {
  __allowPaidRequestsForTest(true);
  const fetch = spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ image: "png" }));
  restore.push(() => fetch.mockRestore());
  await expect(generateImage({ prompt: "x".repeat(16001) })).rejects.toThrow("16000 characters");
  await expect(deriveImage(new Uint8Array(), "x".repeat(16001))).rejects.toThrow("16000 characters");
  await expect(generateImage({ prompt: "   " })).rejects.toThrow("non-empty");
  await expect(deriveImage(new Uint8Array(), "   ")).rejects.toThrow("non-empty");
  expect(fetch).not.toHaveBeenCalled();
});

test("planning rejects an oversized description or effects brief before buying anything", async () => {
  __allowPaidRequestsForTest(true);
  const fetch = spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ message: { content: "{}" } }));
  restore.push(() => fetch.mockRestore());
  await expect(planPoses({ subject: "knight", motion: "x".repeat(10001), frames: 2 })).rejects.toThrow("10000 characters");
  await expect(planPoses({ subject: "knight", motion: "jab", frames: 2, effects: "x".repeat(MAX_EFFECTS_LENGTH + 1) })).rejects.toThrow(String(MAX_EFFECTS_LENGTH));
  expect(fetch).not.toHaveBeenCalled();
});

test("a sheet refuses more poses than it has cells, an oversized pose or effects brief, before any paid request", async () => {
  __allowPaidRequestsForTest(true);
  const fetch = spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ image: "png" }));
  restore.push(() => fetch.mockRestore());
  const sheet = new Uint8Array([1]);
  await expect(deriveAnimationSheet({ sheet, motion: "x".repeat(16001), columns: 2, rows: 2, poses: ["a"] })).rejects.toThrow("16000 characters");
  await expect(deriveAnimationSheet({ sheet, motion: " ", columns: 2, rows: 2, poses: ["a"] })).rejects.toThrow("non-empty");
  await expect(deriveAnimationSheet({ sheet, motion: "jab", columns: 2, rows: 2, poses: ["a", "b", "c", "d"] })).rejects.toThrow("holds 3 frames");
  await expect(deriveAnimationSheet({ sheet, motion: "jab", columns: 2, rows: 2, poses: ["x".repeat(MAX_POSE_LENGTH + 1)] })).rejects.toThrow("Pose 1");
  await expect(deriveAnimationSheet({ sheet, motion: "jab", columns: 2, rows: 2, poses: [] })).rejects.toThrow("at least one pose");
  await expect(deriveAnimationSheet({ sheet, motion: "jab", columns: 2, rows: 2, poses: ["a"], effects: "x".repeat(MAX_EFFECTS_LENGTH + 1) })).rejects.toThrow("Effects");
  expect(fetch).not.toHaveBeenCalled();
});

test("a long motion brief is preserved by both the planner and the animation sheet", async () => {
  const description = "Swing the sword while keeping the left foot planted. ".repeat(30);
  const poses: PlannedPose[] = [
    { pose: "Left foot planted; sword raised above the right shoulder.", contact: "grounded", ms: 120 },
    { pose: "Left foot planted; sword follows through beside the left hip.", contact: "grounded", ms: 200 },
  ];
  __allowPaidRequestsForTest(true);
  const fetch = spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(Response.json({ message: { content: JSON.stringify({ source: "Blade over the shoulder.", rest: 600, frames: poses }) } }))
    .mockResolvedValueOnce(Response.json({ image: "png", model: "test" }));
  restore.push(() => fetch.mockRestore());

  const plan = await planPoses({ subject: "sword knight", motion: description, frames: 2, facing: "front view, facing the viewer", source: new Uint8Array([137, 80, 78, 71]) });
  const content = sentContent(fetch.mock.calls[0]) as { type: string; text?: string; image_url?: { url: string } }[];
  expect(content[0]?.text).toContain(description);
  expect(content[0]?.text).toContain("drawn front view, facing the viewer");
  expect(content[1]?.image_url?.url).toBe("data:image/png;base64,iVBORw==");
  expect(plan).toEqual({ source: "Blade over the shoulder.", frames: poses, restMs: 600 });

  const result = await deriveAnimationSheet({
    sheet: new Uint8Array([1, 2, 3]),
    motion: description,
    columns: 2,
    rows: 2,
    poses: plan.frames.map((entry) => entry.pose),
    effects: " a purple trail ",
  });
  expect(result).toEqual({ image: "png", model: "test" });
  const form = fetch.mock.calls[1]?.[1]?.body as FormData;
  expect(form.get("mode")).toBe("animate");
  expect(form.get("kind")).toBe("sprite");
  expect(form.get("columns")).toBe("2");
  expect(form.get("rows")).toBe("2");
  expect(form.get("effects")).toBe("a purple trail");
  expect(JSON.parse(String(form.get("poses")))).toEqual(poses.map((entry) => entry.pose));
  expect(form.get("instruction")).toBe(description.trim());
  expect((form.get("source") as File).name).toBe("sheet.png");
  expect((form.get("source") as File).size).toBe(3);
});

test("a short motion brief travels with the sheet, and no effects field is sent when none were asked for", async () => {
  __allowPaidRequestsForTest(true);
  const fetch = spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ image: "png" }));
  restore.push(() => fetch.mockRestore());
  await deriveAnimationSheet({ sheet: new Uint8Array([1]), motion: "  a quick jab  ", columns: 2, rows: 2, poses: ["extend"] });
  const form = fetch.mock.calls[0]?.[1]?.body as FormData;
  expect(form.get("instruction")).toBe("a quick jab");
  expect(form.get("effects")).toBeNull();
});

test("planning without an image sends plain text", async () => {
  __allowPaidRequestsForTest(true);
  const fetch = spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ message: { content: '{"frames":["a","b"]}' } }));
  restore.push(() => fetch.mockRestore());
  await planPoses({ subject: "knight", motion: "jab", frames: 2 });
  expect(typeof sentContent(fetch.mock.calls[0])).toBe("string");
});

describe("batched paid requests", () => {
  test("a batch holds the slot once, runs concurrently, refuses a rival action, and settles in order", async () => {
    __allowPaidRequestsForTest(true);
    const pending: { resolve: (response: Response) => void }[] = [];
    const fetch = spyOn(globalThis, "fetch").mockImplementation(
      (() => new Promise<Response>((resolve) => { pending.push({ resolve }); })) as unknown as typeof globalThis.fetch,
    );
    restore.push(() => fetch.mockRestore());

    const batch = deriveImages([
      { source: new Uint8Array([1]), instruction: "north" },
      { source: new Uint8Array([2]), instruction: "east" },
      { source: new Uint8Array([3]), instruction: "back" },
    ]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    // All three were sent before any answered.
    expect(pending).toHaveLength(3);
    await expect(deriveImage(new Uint8Array([9]), "rival")).rejects.toThrow("still running");
    expect(pending).toHaveLength(3);

    pending[1]!.resolve(Response.json({ error: { code: "upstream_error", message: "boom" } }, { status: 502 }));
    pending[2]!.resolve(Response.json({ image: "three", model: "m" }));
    pending[0]!.resolve(Response.json({ image: "one", model: "m" }));
    const results = await batch;
    expect(results.map((result) => result.status)).toEqual(["fulfilled", "rejected", "fulfilled"]);
    expect(results[0]?.status === "fulfilled" ? results[0].value.image : null).toBe("one");
    expect(results[2]?.status === "fulfilled" ? results[2].value.image : null).toBe("three");
    expect(results[1]?.status === "rejected" ? String((results[1].reason as Error).message) : null).toContain("boom");

    // The slot is free again once the batch settles.
    fetch.mockResolvedValue(Response.json({ image: "later", model: "m" }));
    expect((await deriveImage(new Uint8Array([1]), "after")).image).toBe("later");
  });

  test("a batch validates every request before sending any", async () => {
    __allowPaidRequestsForTest(true);
    const fetch = spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ image: "png" }));
    restore.push(() => fetch.mockRestore());
    await expect(deriveImages([
      { source: new Uint8Array([1]), instruction: "fine" },
      { source: new Uint8Array([2]), instruction: "x".repeat(16001) },
    ])).rejects.toThrow("16000 characters");
    expect(fetch).not.toHaveBeenCalled();
    expect(await deriveImages([])).toEqual([]);
  });
});
