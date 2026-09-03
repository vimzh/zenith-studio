// A slow animation must stop spending and reject stale frames instead of mutating an old store.
import { afterEach, beforeEach, expect, spyOn, test, type Mock } from "bun:test";
import { TRANSPARENT, createGrid, gridsEqual, parseHex, type Grid } from "@zenith/core";
import { session } from "@/lib/editor";
import { cellOrigin, composeSheet, planSheets, type SheetLayout } from "@/lib/animation";
import * as pixelize from "@/lib/pixelize";
import type { RasterImage } from "@/lib/pixelize";
import * as api from "../api";
import * as raster from "../raster";
import { animateWithText } from "./animate-text";

let plan: Mock<typeof api.planPoses>;
let judge: Mock<typeof api.judgeFrames>;
let derive: Mock<typeof api.deriveAnimationSheets>;
let decode: Mock<typeof raster.decodeBase64Png>;
let resolve: Mock<typeof pixelize.pixelizeAsync>;

const grounded = (pose: string, ms = 250): api.PlannedPose => ({ pose, contact: "grounded", ms });
const plannedFrames = (frames: number): api.PlannedPose[] => Array.from({ length: frames }, (_, index) => grounded(`pose ${String(index + 1)}`, 100 + index * 50));
const pass = (frames: number): api.FrameVerdict[] => Array.from({ length: frames }, (_, index) => ({ frame: index + 1, ok: true, problems: [] }));
const bought = (requests: readonly unknown[]): PromiseSettledResult<api.GenerateResponse>[] =>
  requests.map(() => ({ status: "fulfilled" as const, value: { image: "mock", model: "test" } }));
const solid = (size: number, index: number, palette: string[]): pixelize.PixelizeResult => ({
  grid: createGrid(size, size, index),
  palette,
  kind: "native",
  confidence: 1,
  scale: 1,
  alternatives: [],
  warnings: [],
});

function rasterFromGrid(grid: Grid, palette: readonly string[], scale: number): RasterImage {
  const width = grid.width * scale;
  const height = grid.height * scale;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const cell = grid.cells[Math.floor(y / scale) * grid.width + Math.floor(x / scale)] ?? TRANSPARENT;
      if (cell === TRANSPARENT) continue;
      const { r, g, b } = parseHex(palette[cell] as string);
      data.set([r, g, b, 255], (y * width + x) * 4);
    }
  }
  return { width, height, data };
}

beforeEach(() => {
  for (const asset of session.list()) session.close(asset.id);
  plan = spyOn(api, "planPoses").mockImplementation(async ({ frames }) => ({ source: "guard up", frames: plannedFrames(frames), restMs: 600 }));
  judge = spyOn(api, "judgeFrames").mockImplementation(async ({ plan: poses }) => pass(poses.length));
  derive = spyOn(api, "deriveAnimationSheets").mockImplementation(async (requests) => bought(requests));
  decode = spyOn(raster, "decodeBase64Png").mockResolvedValue({ width: 1024, height: 1024, data: new Uint8ClampedArray(1024 * 1024 * 4).fill(255) });
  resolve = spyOn(pixelize, "pixelizeAsync").mockResolvedValue(solid(32, 1, ["#000000", "#ffffff"]));
});

afterEach(() => {
  plan.mockRestore();
  judge.mockRestore();
  derive.mockRestore();
  decode.mockRestore();
  resolve.mockRestore();
});

// Eight frames of a 128px sprite need two sheets, bought as one batch; a change can land around any paid call.
for (const change of ["palette", "store"] as const) for (const stage of ["plan", "sheets", "judge"] as const) {
  test(`rejects a changed ${change} after the ${stage}, without appending frames or making another paid call`, async () => {
    const id = session.create({ name: "runner", type: "character", width: 128, height: 128, palette: ["#000000", "#ffffff"] });
    const source = session.get(id)!;
    source.setPixels([{ x: 12, y: 8, index: 1 }]);
    const before = source.encode();
    const replace = () => change === "palette"
      ? session.setPaletteColor(id, 1, "#aa44cc")
      : session.reshape(id, (frames) => ({ width: 128, height: 128, frames: [...frames] }));
    resolve.mockResolvedValue(solid(128, 1, ["#000000", "#ffffff"]));
    if (stage === "plan") {
      plan.mockImplementation(async ({ frames }) => { replace(); return { source: "", frames: plannedFrames(frames), restMs: 600 }; });
    } else if (stage === "judge") {
      judge.mockImplementation(async ({ plan: poses }) => { replace(); return pass(poses.length); });
    } else {
      derive.mockImplementation(async (requests) => { replace(); return bought(requests); });
    }

    await expect(animateWithText.execute({ description: "run", frames: 8 })).rejects.toThrow(/changed/);
    expect(derive).toHaveBeenCalledTimes(stage === "plan" ? 0 : 1);
    if (stage !== "plan") expect(derive.mock.calls[0]?.[0]).toHaveLength(2);
    expect(judge).toHaveBeenCalledTimes(stage === "judge" ? 1 : 0);
    expect(source.frameCount).toBe(1);
    expect(source.encode()).toBe(before);
    expect(session.get(id)?.frameCount).toBe(1);
    expect(session.get(id)?.palette.colors[1]?.hex).toBe(change === "palette" ? "#aa44cc" : "#ffffff");
    if (change === "store") expect(session.get(id)).not.toBe(source);
  });
}

test("an unchanged target receives its generated frames, with the planner's holds, as one undoable animation", async () => {
  session.create({ name: "runner", type: "character", width: 32, height: 32, palette: ["#000000", "#ffffff"] });
  const store = session.active!;
  const message = await animateWithText.execute({ description: "run", frames: 2 });
  expect(message).toContain("Drew 2 frames");
  expect(message).toContain("the planner read it as: guard up");
  expect(message).toContain("1. [100ms] pose 1");
  expect(message).toContain("Vision check: all 2 frames match the plan");
  expect(store.frameCount).toBe(3);
  // The source frame, still at the default hold, takes the planner's rest beat.
  expect(store.snapshot().frames.map((frame) => frame.durationMs)).toEqual([600, 100, 150]);
  expect(message).toContain("Source frame 0 now holds 600ms between repeats");
  expect(store.history()).toEqual(["animate: run"]);
  store.undo();
  expect(store.frameCount).toBe(1);
  expect(store.snapshot().frames.map((frame) => frame.durationMs)).toEqual([250]);
});

test("a source frame the human timed keeps its hold", async () => {
  session.create({ name: "runner", type: "character", width: 32, height: 32, palette: ["#000000", "#ffffff"] });
  const store = session.active!;
  store.setFrameDuration(0, 400);
  const message = await animateWithText.execute({ description: "run", frames: 2 });
  expect(store.snapshot().frames.map((frame) => frame.durationMs)).toEqual([400, 100, 150]);
  expect(message).toContain("Source frame 0 keeps its 400ms hold");
});

test("the planner sees the source sprite and its facing; the whole cycle is one sheet beside it", async () => {
  session.create({ name: "warrior east", type: "character", width: 128, height: 128, palette: ["#000000", "#ffffff"] });
  const description = "Keep the full oversized sword inside the canvas. ".repeat(40);
  resolve.mockResolvedValue(solid(128, 1, ["#000000", "#ffffff"]));
  await animateWithText.execute({ description, frames: 4 });
  const request = plan.mock.calls[0]?.[0];
  expect(request?.subject).toBe("warrior east");
  expect(request?.motion).toBe(description);
  expect(request?.frames).toBe(4);
  expect(request?.facing).toBe("strict side profile facing screen-right, with the nose pointing right");
  expect(request?.effects).toBeUndefined();
  // The preview the planner reads is the source at 4x: 512px for a 128px sprite.
  const preview = new DataView(request!.source!.buffer, request!.source!.byteOffset, request!.source!.byteLength);
  expect([preview.getUint32(16), preview.getUint32(20)]).toEqual([512, 512]);

  expect(derive).toHaveBeenCalledTimes(1);
  expect(derive.mock.calls[0]?.[0]).toHaveLength(1);
  const sheet = derive.mock.calls[0]?.[0]?.[0];
  expect(sheet?.columns).toBe(3);
  expect(sheet?.rows).toBe(2);
  expect(sheet?.poses).toEqual(["pose 1", "pose 2", "pose 3", "pose 4"]);
  expect(sheet?.motion).toBe(description);
  expect(sheet?.effects).toBeUndefined();
  const view = new DataView(sheet!.sheet.buffer, sheet!.sheet.byteOffset, sheet!.sheet.byteLength);
  expect([view.getUint32(16), view.getUint32(20)]).toEqual([1536, 1024]);
  // Without effects every colour is conformed to the palette, so the quantiser is capped at its size.
  expect(resolve.mock.calls.every((call) => call[1]?.maxColors === 2)).toBe(true);
});

test("a sprite without a direction in its name plans without a facing", async () => {
  session.create({ name: "warrior", type: "character", width: 32, height: 32, palette: ["#000000", "#ffffff"] });
  await animateWithText.execute({ description: "swing", frames: 2 });
  expect(plan.mock.calls[0]?.[0].facing).toBeUndefined();
});

test("effects travel to the planner and the sheet, appear on the pose lines, and earn free palette slots", async () => {
  session.create({ name: "mage", type: "character", width: 32, height: 32, palette: ["#000000", "#ffffff"] });
  const store = session.active!;
  plan.mockResolvedValue({ source: "staff raised", frames: [grounded("wind up", 90), { pose: "cast", contact: "grounded", ms: 200, effect: "purple burst at the staff tip" }], restMs: 600 });
  // The model drew purple; the quantiser was allowed to keep it.
  resolve.mockResolvedValue(solid(32, 2, ["#000000", "#ffffff", "#8a2be2"]));

  const message = await animateWithText.execute({ description: "cast a spell", frames: 2, effects: "a purple magic burst" });

  expect(plan.mock.calls[0]?.[0].effects).toBe("a purple magic burst");
  expect(derive.mock.calls[0]?.[0]?.[0]?.effects).toBe("a purple magic burst");
  expect(derive.mock.calls[0]?.[0]?.[0]?.poses).toEqual(["wind up", "cast Effect: purple burst at the staff tip"]);
  expect(resolve.mock.calls.every((call) => call[1]?.maxColors === 16)).toBe(true);
  expect(judge.mock.calls[0]?.[0].effects).toBe("a purple magic burst");
  expect(store.palette.colors.map((colour) => colour.hex)).toEqual(["#000000", "#ffffff", "#8a2be2"]);
  expect(store.readComposite(2).cells[0]).toBe(2);
  expect(message).toContain("Added #8a2be2 to the palette for the effects (now 3 colours)");
  expect(message).toContain("(effect: purple burst at the staff tip)");
  expect(store.history()).toEqual(["animate: cast a spell"]);
  store.undo();
  expect(store.palette.colors).toHaveLength(2);
  expect(store.frameCount).toBe(1);
});

test("a full palette makes room for an effect colour by folding its closest near-duplicate pair, undoably", async () => {
  const full = ["#000000", "#848484", "#808080", "#ff0000", "#00ff00", "#0000ff", "#ffff00", "#00ffff", "#ff00ff", "#800000", "#008000", "#000080", "#808000", "#008080", "#800080", "#ffffff"];
  session.create({ name: "mage", type: "character", width: 32, height: 32, palette: full });
  const store = session.active!;
  // The source uses the lighter grey once and its twin three times, so the lighter one is the one emptied.
  store.setPixels([{ x: 0, y: 0, index: 1 }, { x: 1, y: 0, index: 2 }, { x: 2, y: 0, index: 2 }, { x: 3, y: 0, index: 2 }]);
  plan.mockResolvedValue({ source: "", frames: [{ pose: "cast", contact: "grounded", ms: 200, effect: "purple burst" }, grounded("settle")], restMs: 600 });
  resolve.mockResolvedValue(solid(32, 2, ["#000000", "#ffffff", "#8a2be2"]));

  const message = await animateWithText.execute({ description: "cast", frames: 2, effects: "a purple burst" });

  const colours = store.palette.colors.map((colour) => colour.hex);
  expect(colours).toHaveLength(16);
  expect(colours[1]).toBe("#8a2be2");
  expect(colours).not.toContain("#848484");
  expect(store.readComposite(0).cells[0]).toBe(2);
  expect(store.readComposite(0).cells[1]).toBe(2);
  expect(store.readComposite(1).cells[0]).toBe(1);
  expect(message).toContain("Folded #848484 into #808080 (near-identical) to make room for the effect colours.");
  expect(message).toContain("Added #8a2be2 to the palette");
  expect(store.history().at(-1)).toBe("animate: cast");
  store.undo();
  expect(store.palette.colors.map((colour) => colour.hex)).toEqual(full);
  expect(store.readComposite(0).cells[0]).toBe(1);
  expect(store.frameCount).toBe(1);
});

test("a full palette of distinct colours reports the effect colours it could not seat", async () => {
  const full = ["#000000", "#ff0000", "#00ff00", "#0000ff", "#ffff00", "#00ffff", "#ff00ff", "#800000", "#008000", "#000080", "#808000", "#008080", "#800080", "#ffffff", "#ff8000", "#0080ff"];
  session.create({ name: "mage", type: "character", width: 32, height: 32, palette: full });
  const store = session.active!;
  resolve.mockResolvedValue(solid(32, 2, ["#000000", "#ffffff", "#8a2be2"]));
  const message = await animateWithText.execute({ description: "cast", frames: 2, effects: "a purple burst" });
  expect(store.palette.colors.map((colour) => colour.hex)).toEqual(full);
  expect(message).toContain("No palette room for #8a2be2; they were matched to the nearest existing colours.");
});

test("without effects a colour the palette lacks is conformed, not added", async () => {
  session.create({ name: "mage", type: "character", width: 32, height: 32, palette: ["#000000", "#ffffff"] });
  const store = session.active!;
  resolve.mockResolvedValue(solid(32, 2, ["#000000", "#ffffff", "#8a2be2"]));
  await animateWithText.execute({ description: "cast", frames: 2 });
  expect(store.palette.colors).toHaveLength(2);
  expect(store.readComposite(1).cells[0]).not.toBe(2);
});

test("a frame the judge rejects is redrawn once with the objection, then judged again", async () => {
  session.create({ name: "boxer", type: "character", width: 128, height: 128, palette: ["#000000", "#ffffff"] });
  const store = session.active!;
  resolve.mockResolvedValue(solid(128, 1, ["#000000", "#ffffff"]));
  judge
    .mockResolvedValueOnce([
      { frame: 1, ok: true, problems: [] },
      { frame: 2, ok: false, problems: ["The arm is not extended.", "The rear glove dropped."] },
      { frame: 3, ok: true, problems: [] },
      { frame: 4, ok: true, problems: [] },
    ])
    .mockResolvedValueOnce(pass(4));

  const message = await animateWithText.execute({ description: "jab", frames: 4 });

  expect(derive).toHaveBeenCalledTimes(2);
  const repair = derive.mock.calls[1]?.[0]?.[0];
  expect(repair?.columns).toBe(2);
  expect(repair?.rows).toBe(2);
  expect(repair?.poses).toEqual(["pose 2 The previous attempt was rejected: The arm is not extended. The rear glove dropped. Draw this frame correctly."]);
  expect(judge).toHaveBeenCalledTimes(2);
  expect(judge.mock.calls[1]?.[0].plan).toHaveLength(4);
  expect(message).toContain("Vision check rejected frame(s) 2 and one repair sheet redrew them; the second check passed every frame.");
  expect(message).toContain("from 2 sprite-sheet generation(s)");
  expect(store.frameCount).toBe(5);
});

test("the second judge pass rules only on repaired frames; an untouched frame keeps its first verdict", async () => {
  session.create({ name: "boxer", type: "character", width: 128, height: 128, palette: ["#000000", "#ffffff"] });
  resolve.mockResolvedValue(solid(128, 1, ["#000000", "#ffffff"]));
  judge
    .mockResolvedValueOnce([
      { frame: 1, ok: true, problems: [] },
      { frame: 2, ok: false, problems: ["Wrong stage."] },
      { frame: 3, ok: true, problems: [] },
      { frame: 4, ok: true, problems: [] },
    ])
    // The judge changes its mind about frame 3, which nobody redrew.
    .mockResolvedValueOnce([
      { frame: 1, ok: true, problems: [] },
      { frame: 2, ok: true, problems: [] },
      { frame: 3, ok: false, problems: ["Now I dislike it."] },
      { frame: 4, ok: true, problems: [] },
    ]);
  const message = await animateWithText.execute({ description: "jab", frames: 4 });
  expect(message).toContain("Vision check rejected frame(s) 2 and one repair sheet redrew them; the second check passed every frame.");
  expect(derive).toHaveBeenCalledTimes(2);
});

test("a frame still rejected after the repair is named for the human, and verify: false skips the judge", async () => {
  session.create({ name: "boxer", type: "character", width: 32, height: 32, palette: ["#000000", "#ffffff"] });
  judge.mockResolvedValue([{ frame: 1, ok: true, problems: [] }, { frame: 2, ok: false, problems: ["Facing flipped."] }]);
  const message = await animateWithText.execute({ description: "jab", frames: 2 });
  expect(message).toContain("the second check still flags frame 2 (Facing flipped.)");
  expect(derive).toHaveBeenCalledTimes(2);

  derive.mockClear();
  judge.mockClear();
  session.create({ name: "boxer", type: "character", width: 32, height: 32, palette: ["#000000", "#ffffff"] });
  const message2 = await animateWithText.execute({ description: "jab", frames: 2, verify: false });
  expect(judge).not.toHaveBeenCalled();
  expect(derive).toHaveBeenCalledTimes(1);
  expect(message2).toContain("The vision check was skipped");
});

test("a failed sheet keeps the frames already bought and names what failed", async () => {
  session.create({ name: "runner", type: "character", width: 128, height: 128, palette: ["#000000", "#ffffff"] });
  const store = session.active!;
  resolve.mockResolvedValue(solid(128, 1, ["#000000", "#ffffff"]));
  derive.mockImplementationOnce(async (requests) =>
    requests.map((_, index) => (index === 0
      ? { status: "fulfilled" as const, value: { image: "mock", model: "test" } }
      : { status: "rejected" as const, reason: new Error("The model returned no image.") })),
  );
  const message = await animateWithText.execute({ description: "run", frames: 8 });
  expect(message).toContain("Drew 5 frames");
  expect(message).toContain("frame(s) 6, 7, 8: The model returned no image.");
  expect(message).toContain("from 2 sprite-sheet generation(s)");
  expect(store.frameCount).toBe(6);
});

test("frames come back as the grids drawn in their cells, registered to the source's ground line", async () => {
  const palette = ["#000000", "#ff0000", "#00ff00"];
  session.create({ name: "jumper", type: "character", width: 32, height: 32, palette });
  const store = session.active!;
  const layout = planSheets(32, 32, 4)[0] as SheetLayout;

  const body = (grid: Grid, dx: number, dy: number): void => {
    for (let y = 8 + dy; y < 28 + dy; y += 1) for (let x = 12 + dx; x < 20 + dx; x += 1) grid.cells[y * 32 + x] = 1;
  };
  const base = createGrid(32, 32, TRANSPARENT);
  body(base, 0, 0);
  store.writeRegion(0, 0, base);

  // 1: a step forward on the same ground line. 2: an arm out. 3: airborne,
  // lifted four rows — must survive untouched. 4: a grounded pose the model
  // drew two rows too low — must come back up onto the ground line.
  const stepped = createGrid(32, 32, TRANSPARENT);
  body(stepped, 2, 0);
  const armed = createGrid(32, 32, TRANSPARENT);
  body(armed, 0, 0);
  for (let x = 20; x < 27; x += 1) armed.cells[12 * 32 + x] = 2;
  const airborne = createGrid(32, 32, TRANSPARENT);
  body(airborne, 0, -4);
  const drifted = createGrid(32, 32, TRANSPARENT);
  body(drifted, 1, 2);
  const corrected = createGrid(32, 32, TRANSPARENT);
  body(corrected, 1, 0);

  const sheet = composeSheet(base, layout);
  [stepped, armed, airborne, drifted].forEach((frame, index) => {
    const origin = cellOrigin(layout, index + 1);
    for (let y = 0; y < 32; y += 1) sheet.cells.set(frame.cells.subarray(y * 32, y * 32 + 32), (origin.y + y) * sheet.width + origin.x);
  });
  plan.mockResolvedValue({ source: "", frames: [grounded("step"), grounded("arm"), { pose: "leap", contact: "airborne", ms: 250 }, grounded("land")], restMs: 250 });
  decode.mockResolvedValue(rasterFromGrid(sheet, palette, layout.scale));
  resolve.mockImplementation(async (image, options) => pixelize.pixelize(image, options));

  const message = await animateWithText.execute({ description: "step, reach, leap, land", frames: 4 });

  expect(message).toContain("Moved back onto the source's ground line: frame 4 up 2px.");
  expect(store.frameCount).toBe(5);
  expect(gridsEqual(store.readComposite(0), base)).toBe(true);
  expect(gridsEqual(store.readComposite(1), stepped)).toBe(true);
  expect(gridsEqual(store.readComposite(2), armed)).toBe(true);
  expect(gridsEqual(store.readComposite(3), airborne)).toBe(true);
  expect(gridsEqual(store.readComposite(4), corrected)).toBe(true);
  expect(store.snapshot().frames.map((frame) => frame.durationMs)).toEqual([250, 250, 250, 250, 250]);
  // The judge saw the source and every frame, conformed, in plan order.
  expect(judge.mock.calls[0]?.[0].plan.map((entry) => entry.pose)).toEqual(["step", "arm", "leap", "land"]);
});

test("an empty cell is redrawn with the repair pass rather than dropped from the cycle", async () => {
  session.create({ name: "runner", type: "character", width: 32, height: 32, palette: ["#000000", "#ffffff"] });
  const store = session.active!;
  resolve
    .mockResolvedValueOnce(solid(32, 1, ["#000000", "#ffffff"]))
    .mockResolvedValueOnce({ ...solid(32, TRANSPARENT, []), grid: createGrid(32, 32, TRANSPARENT) })
    .mockResolvedValue(solid(32, 1, ["#000000", "#ffffff"]));
  const message = await animateWithText.execute({ description: "run", frames: 2 });
  // The first judge saw only the frame that existed; the blank one joined the repair.
  expect(judge.mock.calls[0]?.[0].plan).toHaveLength(1);
  expect(derive).toHaveBeenCalledTimes(2);
  expect(derive.mock.calls[1]?.[0]?.[0]?.poses).toEqual(["pose 2 The previous attempt was rejected: The previous attempt left this frame's cell empty. Draw this frame correctly."]);
  expect(message).toContain("Drew 2 frames");
  expect(message).toContain("Vision check rejected frame(s) 2 and one repair sheet redrew them");
  expect(message).not.toContain("left its cell empty");
  expect(store.frameCount).toBe(3);
});

test("without the judge an empty cell is reported as a failed frame rather than appended as a blank", async () => {
  session.create({ name: "runner", type: "character", width: 32, height: 32, palette: ["#000000", "#ffffff"] });
  const store = session.active!;
  resolve
    .mockResolvedValueOnce(solid(32, 1, ["#000000", "#ffffff"]))
    .mockResolvedValueOnce({ ...solid(32, TRANSPARENT, []), grid: createGrid(32, 32, TRANSPARENT) });
  const message = await animateWithText.execute({ description: "run", frames: 2, verify: false });
  expect(message).toContain("Drew 1 frames");
  expect(message).toContain("frame 2: the model left its cell empty");
  expect(derive).toHaveBeenCalledTimes(1);
  expect(store.frameCount).toBe(2);
});

test("a repeated pose is named so the agent can replace it", async () => {
  session.create({ name: "runner", type: "character", width: 32, height: 32, palette: ["#000000", "#ffffff"] });
  const message = await animateWithText.execute({ description: "run", frames: 2 });
  // Both mocked frames are the same solid grid.
  expect(message).toContain("Frame 2 repeats the frame before it");
});

test("an asset too large for any sheet, or an oversized effects brief, is refused before the planner is paid", async () => {
  session.create({ name: "giant", type: "character", width: 256, height: 256, palette: ["#000000", "#ffffff"] });
  await expect(animateWithText.execute({ description: "run", frames: 2 })).rejects.toThrow("No sprite-sheet layout");
  session.create({ name: "mage", type: "character", width: 32, height: 32, palette: ["#000000", "#ffffff"] });
  await expect(animateWithText.execute({ description: "run", frames: 2, effects: "x".repeat(401) })).rejects.toThrow("400");
  expect(plan).not.toHaveBeenCalled();
  expect(derive).not.toHaveBeenCalled();
});
