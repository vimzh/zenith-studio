import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import app from "../src/index";
import { createPalette, createStyleProfile, styleBrief } from "@zenith/core";
import {
  buildAnimationSheetPrompt,
  buildDerivePrompt,
  buildPrompt,
  MAX_EFFECTS_LENGTH,
  MAX_POSE_LENGTH,
  parseAnimationSheet,
} from "../src/routes/generate";

/**
 * These run with no OPENAI_API_KEY, so nothing reaches the model.
 *
 * That is the point for the validation cases: a malformed request must be
 * rejected as a client error, and must be rejected *before* anything is spent.
 */

const configuredKey = process.env.OPENAI_API_KEY;
beforeAll(() => {
  delete process.env.OPENAI_API_KEY;
});
afterAll(() => {
  if (configuredKey !== undefined) process.env.OPENAI_API_KEY = configuredKey;
});

// Validation cases use separate clients so they do not consume each other's rate budget.
let validationClient = 0;

async function post(body: unknown): Promise<Response> {
  return await app.request("/v1/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": `validation-${++validationClient}` },
    body: JSON.stringify(body),
  });
}

async function postDerive(
  instruction: unknown,
  source?: File,
  kind?: string,
  mode?: string,
  mask?: File,
): Promise<Response> {
  const form = new FormData();
  if (instruction !== undefined) form.set("instruction", String(instruction));
  if (source !== undefined) form.set("source", source);
  if (kind !== undefined) form.set("kind", kind);
  if (mode !== undefined) form.set("mode", mode);
  if (mask !== undefined) form.set("mask", mask);
  return await app.request("/v1/derive", { method: "POST", headers: { "x-forwarded-for": `validation-${++validationClient}` }, body: form });
}

async function errorOf(
  response: Response,
): Promise<{ code: string; message: string }> {
  return (
    (await response.json()) as { error: { code: string; message: string } }
  ).error;
}

describe("POST /v1/generate", () => {
  test("builds subject-grounded sprites and material-only textures", () => {
    const sprite = buildPrompt({ prompt: "a knight raising a bronze shield" });
    expect(sprite).toContain("subject, pose, view angle, and key materials");
    expect(sprite).toContain("Do not invent extra props");
    expect(sprite).toContain("small even margin");

    const texture = buildPrompt({ prompt: "mossy stone", kind: "texture" });
    expect(texture).toContain("only the requested surface material or materials");
    expect(texture).toContain("no props, characters, labels, UI");
    expect(texture).not.toContain("transparent background");
  });

  /**
   * Feature count, not adjectives.
   *
   * "Chunky" is advice; "at most eight shapes across the width" is a bound the
   * resampler can actually keep. A bush drawn leaf by leaf and a bush drawn as
   * four leaf masses look equally good at 1024px, and only the second survives
   * being reduced to 32 cells — so the prompt has to know the grid.
   */
  test("bounds feature count against the grid the image lands on", () => {
    const small = buildPrompt({ prompt: "a bush", cells: 16 });
    expect(small).toContain("16-cell grid");
    expect(small).toContain("at most 4 distinct shapes");

    const large = buildPrompt({ prompt: "a bush", cells: 64 });
    expect(large).toContain("at most 16 distinct shapes");

    // The texture branch scales the same way, and keeps its measured value at 32.
    expect(buildPrompt({ prompt: "mossy stone", kind: "texture", cells: 32 }))
      .toContain("at most 8 distinct shapes");
    expect(buildPrompt({ prompt: "mossy stone", kind: "texture" }))
      .toContain("at most 8 distinct shapes");
  });

  /**
   * Every representation clause is a ceiling, because a project's style brief
   * travels in the same prompt and may ask for flat colour or an isometric
   * projection. A floor — "use three tones", "seen straight on" — would be the
   * more specific instruction in some briefs and the contradicted one in
   * others, and nothing downstream measures which won.
   */
  test("states drawing rules as ceilings a style brief can still narrow", () => {
    const sprite = buildPrompt({ prompt: "a bush" });
    expect(sprite).toContain("at most a few flat tones");
    expect(sprite).toContain("no camera perspective");
    expect(sprite).toContain("no dithering, no speckle, no noise");
    expect(sprite).not.toContain("seen straight on");
    expect(sprite).not.toContain("three tones");
  });

  test("rejects a cell count outside the grid sizes this product has", async () => {
    expect((await errorOf(await post({ prompt: "a bush", cells: 4 }))).message).toContain(
      "between 8 and 128",
    );
    expect((await errorOf(await post({ prompt: "a bush", cells: 32.5 }))).code).toBe(
      "invalid_argument",
    );
  });

  test("reports an unconfigured key with a structured code, not a bare string", async () => {
    const response = await post({ prompt: "a mossy cobblestone tile" });
    expect(response.status).toBe(503);

    const error = await errorOf(response);
    expect(error.code).toBe("generation_unconfigured");
    expect(error.message).toContain("OPENAI_API_KEY");
  });

  test("rejects a missing or empty prompt", async () => {
    expect((await errorOf(await post({}))).code).toBe("invalid_argument");
    expect((await errorOf(await post({ prompt: "   " }))).message).toContain(
      "non-empty",
    );
    expect((await errorOf(await post({ prompt: 42 }))).code).toBe(
      "invalid_argument",
    );
  });

  test("rejects an over-long prompt", async () => {
    const response = await post({ prompt: "x".repeat(16001) });
    expect(response.status).toBe(400);
    const error = await errorOf(response);
    expect(error.message).toContain("16000 characters");
    expect(error.message).toContain("16001");
  });

  test("accepts 16000 characters including the composed project brief", async () => {
    const response = await post({ prompt: "x".repeat(16000) });
    expect(response.status).toBe(503);
    expect((await errorOf(response)).code).toBe("generation_unconfigured");
  });

  test("accepts the Moss Knight prompt plus the original project style without shortening it", async () => {
    const prompt = "A single 64×64 pixel-art adventurer sprite: a small knight with a moss-green helmet, bright red scarf, brown boots, and a short steel sword. Full body in side profile facing RIGHT (east). Readable human proportions, clear separation between arms and legs, a recognizable face and hands, compact limited palette, clean solid pixel clusters and crisp dark outline. Transparent background. Keep the entire character, boots, scarf, and short sword inside the canvas with a small transparent margin. No scenery, text, shadows on a floor, extra characters or additional views.";
    const profile = createStyleProfile(createPalette({ colors: ["#171c17", "#5c703d", "#ef534f"] }), {
      canvasSizes: { character: 64, tile: 32, texture: 32, item: 16, ui: 16 },
      proportions: "semi-chibi",
      notes: "64×64 readable pixel-art fantasy characters; moss-green helmet, bright red scarf, brown boots, short steel sword. Full-body side view facing right, separated limbs, transparent background, full sprite inside the canvas.",
    });
    const conditioned = `${prompt}. ${styleBrief(profile, "character", { lockPalette: false })}`;
    expect(prompt.length).toBeLessThan(1000);
    expect(conditioned.length).toBeGreaterThan(1000);
    const response = await post({ prompt: conditioned, kind: "sprite", cells: 64 });
    expect(response.status).toBe(503);
    expect((await errorOf(response)).code).toBe("generation_unconfigured");
    expect(buildPrompt({ prompt: conditioned, kind: "sprite", cells: 64 })).toContain(conditioned);
  });

  /** Unvalidated, this went straight to a paid API and failed upstream. */
  test("rejects a size the model does not accept", async () => {
    const response = await post({ prompt: "a tile", size: "99999x99999" });
    expect(response.status).toBe(400);
    expect((await errorOf(response)).message).toContain("1024x1024");
  });

  /** Previously a 502 blaming the model for the caller's bad request. */
  test("rejects a non-array palette as a client error, not an upstream failure", async () => {
    const response = await post({ prompt: "a tile", palette: "#ff0000" });
    expect(response.status).toBe(400);
    expect((await errorOf(response)).code).toBe("invalid_argument");
  });

  test("rejects palette entries that are not hex colours", async () => {
    expect(
      (await errorOf(await post({ prompt: "a tile", palette: ["red"] })))
        .message,
    ).toContain("#rrggbb");
    expect(
      (await errorOf(await post({ prompt: "a tile", palette: [123] }))).message,
    ).toContain("#rrggbb");
  });

  test("rejects a palette over the 16-colour cap", async () => {
    const palette = Array.from({ length: 17 }, () => "#112233");
    expect(
      (await errorOf(await post({ prompt: "a tile", palette }))).message,
    ).toContain("cap is 16");
  });

  test("accepts a well-formed body, failing only on the missing key", async () => {
    const response = await post({
      prompt: "a mossy cobblestone tile",
      palette: ["#0f380f", "#306230"],
      size: "1024x1024",
    });
    // 503 not 400: the body was fine, the server is not configured.
    expect(response.status).toBe(503);
    expect((await errorOf(response)).code).toBe("generation_unconfigured");
  });

  test("rejects a body that is not JSON", async () => {
    const response = await app.request("/v1/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{ nope",
    });
    expect(response.status).toBe(400);
    expect((await errorOf(response)).message).toContain("JSON");
  });
});

describe("POST /v1/derive", () => {
  function pngFile(width = 1, height = 1, name = "source.png"): File {
    return new File(
      [Uint8Array.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52,
        width >>> 24, (width >>> 16) & 0xff, (width >>> 8) & 0xff, width & 0xff,
        height >>> 24, (height >>> 16) & 0xff, (height >>> 8) & 0xff, height & 0xff,
      ])],
      name,
      { type: "image/png" },
    );
  }

  const png = pngFile();

  test("accepts 16000-character edits and rejects 16001 before checking the key", async () => {
    const accepted = await postDerive("x".repeat(16000), png);
    expect(accepted.status).toBe(503);
    expect((await errorOf(accepted)).code).toBe("generation_unconfigured");
    const rejected = await postDerive("x".repeat(16001), png);
    expect(rejected.status).toBe(400);
    const error = await errorOf(rejected);
    expect(error.message).toContain("16000 characters");
    expect(error.message).toContain("16001");
  });

  test("rejects missing variation inputs before checking the key", async () => {
    expect((await errorOf(await postDerive(undefined, png))).message).toContain(
      "instruction",
    );
    expect((await errorOf(await postDerive("add moss"))).message).toContain(
      "source",
    );
  });

  test("rejects a spoofed PNG content type", async () => {
    const fake = new File(["not a png"], "source.png", { type: "image/png" });
    const response = await postDerive("add moss", fake);
    expect(response.status).toBe(400);
    expect((await errorOf(response)).message).toContain("valid PNG");
  });

  test("accepts a well-formed edit and reaches server configuration", async () => {
    const response = await postDerive(
      "add patchy moss between the stones",
      png,
    );
    expect(response.status).toBe(503);
    expect((await errorOf(response)).code).toBe("generation_unconfigured");
  });

  async function postAnimate(fields: Record<string, string>, source: File = pngFile(1024, 1024)): Promise<Response> {
    const form = new FormData();
    form.set("instruction", "a quick jab");
    form.set("kind", "sprite");
    form.set("mode", "animate");
    form.set("source", source);
    for (const [key, value] of Object.entries(fields)) form.set(key, value);
    return await app.request("/v1/derive", { method: "POST", body: form });
  }

  test("an animation sheet must name its layout and poses before the key is checked", async () => {
    expect((await errorOf(await postAnimate({}))).message).toContain('"columns"');
    expect((await errorOf(await postAnimate({ columns: "2" }))).message).toContain('"rows"');
    expect((await errorOf(await postAnimate({ columns: "2", rows: "2" }))).message).toContain('"poses"');
    expect((await errorOf(await postAnimate({ columns: "2", rows: "2", poses: "not json" }))).message).toContain('"poses"');
    expect((await errorOf(await postAnimate({ columns: "5", rows: "2", poses: '["a"]' }))).message).toContain("between 1 and 4");
    expect((await errorOf(await postAnimate({ columns: "2", rows: "2", poses: '["a", ""]' }))).message).toContain("Pose 2");
  });

  test("an animation sheet refuses more frames than it has cells beside the source", async () => {
    const response = await postAnimate({ columns: "2", rows: "2", poses: JSON.stringify(["a", "b", "c", "d"]) });
    expect(response.status).toBe(400);
    expect((await errorOf(response)).message).toContain("holds 3 frames");
  });

  test("an animation sheet refuses a pose over the cap rather than cutting it", async () => {
    const response = await postAnimate({ columns: "2", rows: "2", poses: JSON.stringify(["a", "x".repeat(MAX_POSE_LENGTH + 1)]) });
    expect(response.status).toBe(400);
    const { message } = await errorOf(response);
    expect(message).toContain("Pose 2");
    expect(message).toContain(String(MAX_POSE_LENGTH));
  });

  test("an animation sheet must be exactly a size the model returns", async () => {
    const response = await postAnimate({ columns: "2", rows: "2", poses: '["a"]' }, pngFile(1000, 1000));
    expect(response.status).toBe(400);
    expect((await errorOf(response)).message).toContain("1024x1024, 1024x1536, 1536x1024");
  });

  test("a well-formed animation sheet at every model size reaches server configuration", async () => {
    for (const [width, height] of [[1024, 1024], [1536, 1024], [1024, 1536]] as const) {
      const response = await postAnimate(
        { columns: "3", rows: "2", poses: JSON.stringify(["a", "b", "c", "d", "e"]) },
        pngFile(width, height),
      );
      expect(response.status).toBe(503);
      expect((await errorOf(response)).code).toBe("generation_unconfigured");
    }
  });

  test("parseAnimationSheet reads the layout the browser sends, with effects only when given", () => {
    const form = new FormData();
    form.set("columns", "3");
    form.set("rows", "2");
    form.set("poses", JSON.stringify(["a", "b"]));
    expect(parseAnimationSheet(form)).toEqual({ columns: 3, rows: 2, poses: ["a", "b"] });
    form.set("effects", "  a purple trail  ");
    expect(parseAnimationSheet(form)).toEqual({ columns: 3, rows: 2, poses: ["a", "b"], effects: "a purple trail" });
    form.set("effects", "   ");
    expect(parseAnimationSheet(form)).toEqual({ columns: 3, rows: 2, poses: ["a", "b"] });
  });

  test("an animation sheet refuses an effects brief over the cap", async () => {
    const response = await postAnimate({ columns: "2", rows: "2", poses: '["a"]', effects: "x".repeat(MAX_EFFECTS_LENGTH + 1) });
    expect(response.status).toBe(400);
    expect((await errorOf(response)).message).toContain(String(MAX_EFFECTS_LENGTH));
    const accepted = await postAnimate({ columns: "2", rows: "2", poses: '["a"]', effects: "a purple trail" });
    expect(accepted.status).toBe(503);
  });

  test("rejects an unknown asset kind before checking the key", async () => {
    const response = await postDerive("make it arcane", png, "poster");
    expect(response.status).toBe(400);
    expect((await errorOf(response)).message).toContain("sprite");
  });

  test("accepts extraction mode before checking the key", async () => {
    const response = await postDerive("isolate the hero", png, "sprite", "extract");
    expect(response.status).toBe(503);
    expect((await errorOf(response)).code).toBe("generation_unconfigured");
  });

  test("requires a valid same-sized PNG mask for inpainting before checking the key", async () => {
    const source = pngFile(1, 1);
    expect((await errorOf(await postDerive("repair the sword", source, "sprite", "inpaint"))).message).toContain("mask");

    const invalidMask = new File(["not a png"], "mask.png", { type: "image/png" });
    expect((await errorOf(await postDerive("repair the sword", source, "sprite", "inpaint", invalidMask))).message).toContain("valid PNG");

    const oversizedMask = new File([new Uint8Array(4 * 1024 * 1024 + 1)], "mask.png", { type: "image/png" });
    expect((await errorOf(await postDerive("repair the sword", source, "sprite", "inpaint", oversizedMask))).message).toContain("4 MB");

    expect((await errorOf(await postDerive("repair the sword", source, "sprite", "inpaint", pngFile(2, 1, "mask.png")))).message).toContain("dimensions");

    const response = await postDerive("repair the sword", source, "sprite", "inpaint", pngFile(1, 1, "mask.png"));
    expect(response.status).toBe(503);
    expect((await errorOf(response)).code).toBe("generation_unconfigured");
  });

  test("uses distinct fidelity rules for sprites and seamless textures", () => {
    const sprite = buildDerivePrompt("turn it into an arcane chest", "sprite");
    expect(sprite).toContain("transparent background");
    expect(sprite).toContain("same asset family");
    expect(sprite).not.toContain("seamless square");

    const texture = buildDerivePrompt("add moss", "texture");
    expect(texture).toContain("seamless square");
    expect(texture).toContain("Opposite edges");
  });

  test("keeps derivations grounded without defeating rotation or pose changes", () => {
    const variation = buildDerivePrompt("make the armour bronze", "sprite", "vary");
    expect(variation).toContain("Change only what the instruction names");
    expect(variation).toContain("do not invent or remove props or effects unless requested");
    expect(variation).toContain("Preserve the subject's identity, camera angle");

    const rotation = buildDerivePrompt("face east", "sprite", "rotate");
    expect(rotation).toContain("Change ONLY the camera angle");
    expect(rotation).not.toContain("Preserve the subject's identity, camera angle");

    const pose = buildDerivePrompt("raise the shield", "sprite", "pose");
    expect(pose).toContain("Change ONLY the subject's pose");
    expect(pose).toContain("Preserve the subject's identity, materials, ornament, colours, camera angle");
  });

  test("uses extraction rules instead of source-edit pixel-art rules", () => {
    const extract = buildDerivePrompt("keep the visible costume", "sprite", "extract");
    expect(extract).toContain("primary character");
    expect(extract).toContain("flat-colour cel-shaded 2D game-character illustration");
    expect(extract).toContain("must not be pixel art yet");
    expect(extract).toContain("a photograph, or a realistic 3D render");
    expect(extract).toContain("must not merely cut the photographic subject out");
    expect(extract).toContain("large separated colour regions with crisp edges");
    expect(extract).toContain("three to five clear value groups");
    expect(extract).toContain("details large enough to survive the target sprite size");
    expect(extract).toContain("Remove photographic texture");
    expect(extract).toContain("first a clear body plan and gesture");
    expect(extract).toContain("readable silhouette with separated limbs");
    expect(extract).toContain("Clothing must wrap around the implied body volumes");
    expect(extract).toContain("anatomy wins");
    expect(extract).toContain("Compress small accessories, folds, texture, and ornament");
    expect(extract).toContain("Simplify surface detail, never identity or body structure");
    expect(extract.indexOf("clear body plan")).toBeLessThan(extract.indexOf("large outfit"));
    expect(extract.indexOf("large outfit")).toBeLessThan(extract.indexOf("signature details"));
    expect(extract).not.toContain("Preserve the character's identity, design, proportions, pose, camera angle, clothing");
    expect(extract).toContain("fully transparent background");
    expect(extract).toContain("obscured or clipped");
    expect(extract).toContain("do not invent major features, props, effects, or redesigns");
    expect(extract).not.toContain("Edit the supplied pixel-art asset");
    expect(extract).not.toContain("hard grid-aligned pixels");
    expect(extract).toContain("pose, camera angle");
    expect(extract).not.toContain("seamless square");
  });

  test("uses inpaint rules instead of whole-asset edit or rotation rules", () => {
    const inpaint = buildDerivePrompt("repair the sword tip", "sprite", "inpaint");
    expect(inpaint).toContain("transparent area of the mask is the only area that may change");
    expect(inpaint).toContain("preserve all unmasked pixels");
    expect(inpaint).not.toContain("Change ONLY the camera angle");
    expect(inpaint).not.toContain("Edit the supplied pixel-art asset");
    expect(inpaint).not.toContain("seamless square");
    expect(inpaint).toContain("complete edited canvas");
    expect(inpaint).toContain("not an isolated replacement fragment");
    expect(inpaint).toContain("do not erase body parts");
  });

  test("rotation and posing permit the silhouette to change instead of preserving its projection", () => {
    for (const mode of ["rotate", "pose"] as const) {
      const prompt = buildDerivePrompt("face east", "sprite", mode);
      expect(prompt).not.toContain("Keep the same functional silhouette");
      expect(prompt).toContain("anatomically connected");
    }
  });

  test("an animation sheet places every frame in a numbered cell beside an unchanged source", () => {
    const prompt = buildDerivePrompt("a quick jab", "sprite", "animate", {
      columns: 3,
      rows: 2,
      poses: ["guard tightens", " fist extends ", "arm retracts"],
    });
    expect(prompt).toContain("3 columns by 2 rows");
    expect(prompt).toContain("Keep cell 1 exactly as it is");
    expect(prompt).toContain("one animation: a quick jab.");
    expect(prompt).toContain("Cell 2, frame 1: guard tightens");
    expect(prompt).toContain("Cell 3, frame 2: fist extends");
    expect(prompt).toContain("Cell 4, frame 3: arm retracts");
    expect(prompt).toContain("Every cell from 2 to 4 must contain its frame; none of them may be left empty");
    expect(prompt).toContain("Leave every remaining cell completely empty and transparent");
    expect(prompt).toContain("one shared ground line");
    expect(prompt).toContain("No cell borders, grid lines, labels, numbers");
    expect(prompt).toBe(buildAnimationSheetPrompt("a quick jab", { columns: 3, rows: 2, poses: ["guard tightens", " fist extends ", "arm retracts"] }));
  });

  test("an animation sheet never asks to preserve the pose or silhouette every cell must change", () => {
    const prompt = buildAnimationSheetPrompt("swing", { columns: 2, rows: 2, poses: ["a"] });
    expect(prompt).not.toContain("Preserve the subject's identity, camera angle");
    expect(prompt).not.toContain("Change ONLY the subject's pose");
    expect(prompt).not.toContain("Keep the same functional silhouette");
    expect(prompt).not.toContain("canvas occupancy");
    expect(prompt).not.toContain("Edit the supplied pixel-art asset");
    expect(prompt).toContain("visibly different from the frame before it");
  });

  test("effects are forbidden outright unless requested, and the ban never names a requested effect", () => {
    const plain = buildAnimationSheetPrompt("slash", { columns: 2, rows: 2, poses: ["a"] });
    expect(plain).toContain("No effects of any kind: no motion lines, trails, glows");
    expect(plain).not.toContain("Requested effects");

    const magic = buildAnimationSheetPrompt("slash", { columns: 2, rows: 2, poses: ["a Effect: purple trail"], effects: "a purple magic trail behind the blade" });
    expect(magic).toContain("Requested effects: a purple magic trail behind the blade");
    expect(magic).toContain("only in a frame whose line asks for it");
    expect(magic).toContain("never covering the character's face");
    expect(magic).not.toContain("No effects of any kind");
    expect(magic).not.toContain("motion lines");
    expect(magic).not.toContain("trails, glows");
  });

  test("animate mode without a sheet is a programming error, not a silent variation", () => {
    expect(() => buildDerivePrompt("swing", "sprite", "animate")).toThrow("sheet");
  });

  test("animation poses keep source registration without fixing occupancy or re-centring", () => {
    const prompt = buildDerivePrompt("swing a sword then jump", "sprite", "pose");
    expect(prompt).not.toContain("Keep the subject centred");
    expect(prompt).not.toContain("canvas occupancy");
    expect(prompt).toContain("per-part proportions");
    expect(prompt).toContain("grounded contact points");
    expect(prompt).toContain("unless the motion explicitly requires a jump or airborne pose");
    expect(prompt).toContain("do not re-centre, crop, or rescale");
    expect(prompt).toContain("small transparent margin");
  });
});
