import { Hono } from "hono";
import { MAX_PALETTE_SIZE } from "@zenith/core";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import OpenAI, { toFile } from "openai";
import type { ErrorBody } from "../lib/http";
import { generateLimiter, limitVerdict, limitedBody } from "../lib/limits";

/**
 * Image generation.
 *
 * The only thing in this app that needs a server: it holds the OpenAI key.
 * Everything else — the document store, the WebMCP tools, the whole
 * pixelisation pipeline — runs in the browser, so this endpoint returns a raw
 * image and the client converts it to an indexed grid. Pixelising here would
 * mean shipping the buffer twice for no gain.
 */

const MODEL = "gpt-image-2";
/** Small by default: the output is downsampled to at most 64 cells regardless. */
const DEFAULT_SIZE = "1024x1024";
/** The sizes the model accepts. Anything else is rejected here rather than upstream. */
const SIZES = ["1024x1024", "1024x1536", "1536x1024"] as const;
const QUALITIES = ["low", "medium", "high"] as const;
/**
 * Medium, not high — measured, not assumed.
 *
 * The output is downsampled to at most 64 cells, so a 1024x1024 generation
 * keeps roughly 0.1% of its pixels and detail bought here is detail the
 * resampler averages away moments later.
 *
 * Timed on the same prompt: high 156.6s, medium 52.6s. Three times faster, and
 * the medium image was *better* for this purpose — subject filled 95% of the
 * frame against 78%, with the same byte-level softness (median run length 1px
 * either way). High spends two extra minutes rendering detail no 32x32 sprite
 * can hold.
 */
const DEFAULT_QUALITY = "medium" as const;
/** Match the document and indexed export capacity; generation still defaults to a small palette. */
const MAX_PALETTE = MAX_PALETTE_SIZE;
/** Includes client-composed style text; leaves room for server drawing rules. */
const MAX_IMAGE_TEXT_LENGTH = 16_000;

/**
 * Errors leave in the same shape as every other route in this service.
 *
 * The web client and the WebMCP tool layer both switch on `error.code`; a bare
 * string would hand them `undefined` and silently defeat that branch.
 */
function failure(
  code: string,
  message: string,
): [ErrorBody, ContentfulStatusCode] {
  return [{ error: { code, message } }, 503];
}

function badRequest(message: string): [ErrorBody, ContentfulStatusCode] {
  return [{ error: { code: "invalid_argument", message } }, 400];
}

/**
 * Validates the body before anything is spent.
 *
 * Returns a message rather than throwing, so a client mistake stays a 400. This
 * used to run inside the upstream try/catch, where a non-array `palette` became
 * "Generation failed: palette.join is not a function" with a 502 — blaming the
 * model for a caller's bad request.
 */
function validate(body: GenerateBody): string | null {
  if (typeof body.prompt !== "string" || body.prompt.trim().length === 0) {
    return 'A non-empty "prompt" is required.';
  }
  if (body.prompt.length > MAX_IMAGE_TEXT_LENGTH) {
    return `Prompt must be ${MAX_IMAGE_TEXT_LENGTH} characters or fewer, including project style text; received ${body.prompt.length}.`;
  }
  if (body.size !== undefined && !SIZES.includes(body.size)) {
    return `"size" must be one of ${SIZES.join(", ")}.`;
  }
  if (body.quality !== undefined && !QUALITIES.includes(body.quality)) {
    return `"quality" must be one of ${QUALITIES.join(", ")}.`;
  }
  if (body.kind !== undefined && body.kind !== "sprite" && body.kind !== "texture") {
    return '"kind" must be "sprite" or "texture".';
  }
  if (
    body.cells !== undefined &&
    (!Number.isInteger(body.cells) || body.cells < 8 || body.cells > 128)
  ) {
    return '"cells" must be an integer between 8 and 128.';
  }
  if (body.palette !== undefined) {
    if (!Array.isArray(body.palette)) {
      return '"palette" must be an array of hex colour strings.';
    }
    if (body.palette.length > MAX_PALETTE) {
      return `"palette" holds ${String(body.palette.length)} colours; the cap is ${String(MAX_PALETTE)}.`;
    }
    if (
      !body.palette.every(
        (colour) =>
          typeof colour === "string" && /^#[0-9a-f]{6}$/i.test(colour),
      )
    ) {
      return '"palette" entries must be #rrggbb hex strings.';
    }
  }
  return null;
}

export interface GenerateBody {
  prompt: string;
  /** Palette the asset must land in, so the prompt can name it. */
  palette?: string[];
  size?: "1024x1024" | "1024x1536" | "1536x1024";
  /**
   * Fidelity to ask the model for.
   *
   * Worth exposing because the output is downsampled to at most 64 cells: a
   * 1024x1024 generation keeps roughly 0.1% of its pixels, so detail bought
   * here is mostly detail thrown away by the resampler. Measured at 156s for
   * "high" on one square image, which is most of the wait.
   */
  quality?: "low" | "medium" | "high";
  /**
   * Whether the subject sits on a background or fills the frame.
   *
   * The same distinction `derive` already makes. A sprite wants transparency;
   * a tile or texture is meant to be solid edge to edge, and asking for a
   * transparent background invites the model to punch holes in it.
   */
  kind?: "sprite" | "texture";
  /**
   * The grid the image will be reduced to, in cells.
   *
   * The single most useful number this prompt can carry. A model asked for "a
   * bush" draws a botanical study; reduced to 32 cells every leaf averages with
   * its neighbour and the result is a green blob. Naming the grid lets the
   * prompt bound feature *count* rather than merely asking for "chunky", which
   * is the difference between art the resampler preserves and art it destroys.
   */
  cells?: number;
}

/** Shapes that survive a reduction to `cells` — the same bound `styleBrief` uses. */
function featureBudget(cells: number | undefined): number {
  return Math.max(3, Math.round((cells ?? 32) / 4));
}

/**
 * How 2D game art draws a thing, as opposed to how a camera sees it.
 *
 * Every clause here is a *ceiling* rather than a floor, on purpose. A project's
 * style brief travels in the same prompt and may legitimately ask for flat
 * colour, no outline, or an isometric projection; a rule phrased as "use three
 * tones" or "seen straight on" would contradict it, and the more specific
 * clause wins in a way nothing measures. "At most a few tones" and "no camera
 * perspective" are true under every brief this product can produce.
 */
const REPRESENTATION =
  `Draw it the way 2D game art draws it, not the way a photograph or a 3D render shows it: one iconic, ` +
  `instantly recognisable shape built from a few large flat masses, with no camera perspective, foreshortening, ` +
  `depth of field, or lens effect. Shade a form with at most a few flat tones in clear steps, all lit from one ` +
  `direction, and keep the inside of each mass clean.`

/**
 * Steers the model toward flat, hard-edged, limited-colour output.
 *
 * The pipeline can recover a grid from soft input, but it recovers a better one
 * from input that was already trying — fewer gradients means less for the
 * medoid to average away.
 */
export function buildPrompt(body: GenerateBody): string {
  const palette =
    body.palette && body.palette.length > 0
      ? ` Use only these colours: ${body.palette.join(", ")}.`
      : "";

  // "transparent OR flat single-colour" let the model choose, and it chose flat
  // every time — measured output had no alpha channel at all and a background
  // within 40 RGB of the subject's own armour. Ask for one thing.
  //
  // "Fills the frame" is the other half. The same measurement found the subject
  // occupying 47% of the frame width, and every wasted pixel of margin is
  // resolution the finished sprite does not get.
  const common =
    `Hard-edged blocky pixels aligned to a square grid, flat colour fills, ` +
    `no anti-aliasing, no gradients, no soft shading, no blur, no drop shadows, no text, ` +
    `no dithering, no speckle, no noise, no stray single pixels.${palette}`;

  // A texture fills its frame and has no background to remove; a sprite is a
  // subject that needs one. Asking a tile for transparency invites holes.
  if (body.kind === "texture") {
    // Feature scale is the whole game for textures, and it is the one thing the
    // model gets wrong by default. A beautiful cobblestone with forty stones
    // across the frame is unusable at 32 cells: each output cell averages a
    // stone and its mortar together, and the structure dissolves into per-pixel
    // dither. Measured across twenty textures, nineteen came back with a mean
    // horizontal run of 1.07-1.32 — essentially every neighbour different.
    //
    // So the prompt constrains feature *count*, not just style. Eight features
    // across a 32-cell canvas leaves four cells per feature, which survives
    // downsampling as a flat region.
    return (
      `${body.prompt}. Pixel art texture filling the entire frame edge to edge, seamlessly tileable, ` +
      `no border, no subject, no background. VERY LOW DETAIL and CHUNKY: at most ${String(featureBudget(body.cells))} distinct shapes ` +
      `across the full width, each shape large and filled with a single flat colour. ` +
      `Depict only the requested surface material or materials — no props, characters, labels, UI, ` +
      `or scene perspective. Think 8-bit console tile, not a photograph. ${REPRESENTATION} ${common}`
    );
  }

  // "Filling the frame edge to edge with no margin" recovered the resolution a
  // floating character was wasting, and then over-corrected: a compact subject
  // like a chest came back clipped on all four sides, because the model obeyed
  // "no margin" literally. The subject must be large AND whole — framing crops
  // the margin afterwards anyway, so a small one costs nothing and clipping is
  // unrecoverable.
  return (
    `${body.prompt}. Pixel art sprite, centred, drawn large so it nearly fills the frame, ` +
    `complete and entirely visible with a small even margin on all four sides — never cropped ` +
    `or touching the edges. Fully transparent background. Bold readable silhouette, ` +
    `no background scenery, no ground plane, no outline glow. ${REPRESENTATION} ` +
    `It will be reduced to a ${String(body.cells ?? 32)}-cell grid, so use at most ` +
    `${String(featureBudget(body.cells))} distinct shapes across the full width and leave out anything ` +
    `smaller than one of those shapes rather than drawing it. Make the requested subject, pose, view angle, ` +
    `and key materials immediately readable at game scale. Do not invent extra props, weapons, symbols, ` +
    `effects, or secondary subjects unless requested. ${common}`
  );
}

export function createGenerateRoute(): Hono {
  const app = new Hono();

  app.post("/", async (c) => {
    // The body is checked before the key: a malformed request is the caller's
    // mistake whether or not this deployment can generate, and answering 503 to
    // a bad body tells them nothing about what to fix.
    let body: GenerateBody;
    try {
      body = await c.req.json<GenerateBody>();
    } catch {
      return c.json(
        {
          error: {
            code: "invalid_argument",
            message: "Request body must be JSON.",
          },
        },
        400,
      );
    }

    const invalid = validate(body);
    if (invalid !== null) {
      const [failed, status] = badRequest(invalid);
      return c.json(failed, status);
    }

    // Metered before the key check, so a refused request costs nothing and an
    // unconfigured deployment cannot be used to probe the limiter.
    const verdict = limitVerdict(generateLimiter, c.req.raw.headers);
    if (!verdict.allowed) {
      c.header("Retry-After", String(verdict.retryAfterSeconds));
      return c.json(limitedBody(verdict), 429);
    }

    const key = process.env.OPENAI_API_KEY;
    if (!key) {
      // Name the variable, so the fix is obvious from a deploy log.
      const [failed, status] = failure(
        "generation_unconfigured",
        "Generation is not configured: OPENAI_API_KEY is not set on the server.",
      );
      return c.json(failed, status);
    }

    // Built before the try, so a body problem can never be reported as an
    // upstream failure.
    const prompt = buildPrompt(body);

    try {
      const openai = new OpenAI({ apiKey: key });
      const response = await openai.images.generate({
        model: MODEL,
        prompt,
        size: body.size ?? DEFAULT_SIZE,
        quality: body.quality ?? DEFAULT_QUALITY,
        n: 1,
        // Asked for explicitly rather than left to the prompt. Wording alone
        // produced an opaque background every time, and a sprite with its
        // background baked in is not usable in a game at all — the client then
        // has to guess which colour was meant to be nothing.
        background: body.kind === "texture" ? "opaque" : "transparent",
        output_format: "png",
      });

      const image = response.data?.[0]?.b64_json;
      if (!image) {
        return c.json(
          {
            error: {
              code: "upstream_error",
              message: "The model returned no image.",
            },
          },
          502,
        );
      }

      return c.json({ image, model: MODEL });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json(
        {
          error: {
            code: "upstream_error",
            message: `Generation failed: ${message}`,
          },
        },
        502,
      );
    }
  });

  return app;
}

const MAX_SOURCE_BYTES = 8 * 1024 * 1024;
/** OpenAI requires edit masks to be PNGs no larger than 4 MB. */
const MAX_MASK_BYTES = 4 * 1024 * 1024;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
export type DeriveKind = "sprite" | "texture";
/** `vary` changes the subject and keeps the angle; `rotate` does the reverse. */
export type DeriveMode = "vary" | "rotate" | "pose" | "extract" | "inpaint" | "animate";
const DERIVE_MODES: readonly DeriveMode[] = ["vary", "rotate", "pose", "extract", "inpaint", "animate"];

/** A 4x4 sheet less its reference cell. Beyond this each cell is a thumbnail. */
export const MAX_SHEET_POSES = 15;
/** Per pose, with room for an effect note and a repair note; fifteen of these stay far below the model's prompt limit. */
export const MAX_POSE_LENGTH = 600;
/** The effects brief shared by every frame of a sheet. */
export const MAX_EFFECTS_LENGTH = 400;
const MAX_SHEET_AXIS = 4;

/**
 * The frames of an animation, drawn as one sheet beside the source.
 *
 * `poses` are frame descriptions in order; frame `i` is drawn into cell `i + 2`
 * because cell 1 holds the source. The client composes the sheet PNG and cuts
 * the result; the server only needs the layout to describe it. `effects` is
 * the one thing that may be *added* to the character — without it the prompt
 * forbids every trail and glow, because a model left to itself adds them.
 */
export interface AnimationSheet {
  readonly columns: number;
  readonly rows: number;
  readonly poses: readonly string[];
  readonly effects?: string;
  /** Fidelity to buy for the sheet; the client chooses from measurement. */
  readonly quality?: (typeof QUALITIES)[number];
}

/** Reads and checks the sheet fields of an `animate` request, or explains what is wrong. */
export function parseAnimationSheet(form: FormData): AnimationSheet | string {
  const axis = (name: string): number | string => {
    const raw = form.get(name);
    const value = typeof raw === "string" ? Number.parseInt(raw, 10) : Number.NaN;
    return Number.isInteger(value) && value >= 1 && value <= MAX_SHEET_AXIS
      ? value
      : `"${name}" must be an integer between 1 and ${String(MAX_SHEET_AXIS)} when mode is "animate".`;
  };
  const columns = axis("columns");
  if (typeof columns === "string") return columns;
  const rows = axis("rows");
  if (typeof rows === "string") return rows;

  const raw = form.get("poses");
  let poses: unknown;
  try {
    poses = typeof raw === "string" ? JSON.parse(raw) : undefined;
  } catch {
    return '"poses" must be a JSON array of frame descriptions when mode is "animate".';
  }
  if (!Array.isArray(poses) || poses.length === 0 || poses.length > MAX_SHEET_POSES) {
    return `"poses" must be a JSON array of 1 to ${String(MAX_SHEET_POSES)} frame descriptions when mode is "animate".`;
  }
  for (const [index, pose] of poses.entries()) {
    if (typeof pose !== "string" || pose.trim().length === 0) {
      return `Pose ${String(index + 1)} must be a non-empty string.`;
    }
    if (pose.length > MAX_POSE_LENGTH) {
      return `Pose ${String(index + 1)} is ${String(pose.length)} characters; the cap is ${String(MAX_POSE_LENGTH)}.`;
    }
  }
  if (columns * rows < poses.length + 1) {
    return `A ${String(columns)}x${String(rows)} sheet holds ${String(columns * rows - 1)} frames beside the source, not ${String(poses.length)}.`;
  }
  const effectsField = form.get("effects");
  if (effectsField !== null && typeof effectsField !== "string") return '"effects" must be a string.';
  const effects = effectsField === null ? "" : effectsField.trim();
  if (effects.length > MAX_EFFECTS_LENGTH) {
    return `"effects" is ${String(effects.length)} characters; the cap is ${String(MAX_EFFECTS_LENGTH)}.`;
  }
  const qualityField = form.get("quality");
  if (qualityField !== null && (typeof qualityField !== "string" || !QUALITIES.includes(qualityField as (typeof QUALITIES)[number]))) {
    return `"quality" must be one of ${QUALITIES.join(", ")}.`;
  }
  return {
    columns,
    rows,
    poses: poses as string[],
    ...(effects.length === 0 ? {} : { effects }),
    ...(qualityField === null ? {} : { quality: qualityField as (typeof QUALITIES)[number] }),
  };
}

/**
 * One sheet, one call, one camera.
 *
 * The per-frame prompt asked N separate generations to "preserve scale and
 * registration", and N separate generations cannot: each is drawn with nothing
 * to register against but a description. Here the reference sits in cell 1 at
 * the exact scale every other cell must match, so consistency is the easiest
 * thing for the model to do rather than the hardest thing to ask for. Note what
 * is *absent*: no "preserve the pose" clause, because the pose is the one thing
 * every cell changes — the contradiction that silently defeated rotation.
 */
export function buildAnimationSheetPrompt(instruction: string, sheet: AnimationSheet): string {
  const count = sheet.poses.length;
  const frames = sheet.poses
    .map((pose, index) => `Cell ${String(index + 2)}, frame ${String(index + 1)}: ${pose.trim()}`)
    .join(" ");
  // Effects are the one addition a frame may carry, and only when asked for.
  // Left unsaid, the model adds glows and motion lines on its own; said as a
  // blanket ban, it would also refuse the purple trail the frame lines ask
  // for. So the clause is conditional, and the ban names no effect the
  // request permits.
  const effects =
    sheet.effects === undefined
      ? `No effects of any kind: no motion lines, trails, glows, dust, sparkles or impact marks. `
      : `Requested effects: ${sheet.effects.trim()}. Draw an effect only in a frame whose line asks for it and only where that ` +
        `line places it, as flat hard-edged pixel-art shapes in one to three colours — an arc, a streak, a trail, a burst, ` +
        `sparkles — with no glow, blur, gradient or transparency, never covering the character's face or breaking its ` +
        `silhouette, and always inside the frame's own cell. `;
  return (
    `This image is a sprite sheet: a grid of ${String(sheet.columns)} columns by ${String(sheet.rows)} rows of equal cells on a ` +
    `fully transparent background, numbered in reading order, left to right then top to bottom. Cell 1, top-left, holds the ` +
    `finished source sprite in its rest pose. Keep cell 1 exactly as it is. Draw the same character into the next ${String(count)} ` +
    `cells as consecutive frames of one animation: ${instruction.trim()}. Frame 1 goes in cell 2, frame 2 in cell 3, and so on. ` +
    `${frames} Every cell from 2 to ${String(count + 1)} must contain its frame; none of them may be left empty. ` +
    `Leave every remaining cell completely empty and transparent. ` +
    `Every frame is the identical character at the identical scale, camera angle and facing as cell 1, in the same pixel-art style, ` +
    `outline weight, pixel-cluster size and colours. Keep one shared ground line: planted feet sit at the same height inside their ` +
    `cell as in cell 1, and the body stays at cell 1's horizontal position unless its pose moves it. Each frame stays fully inside ` +
    `its own cell with a clear transparent margin, and nothing crosses into a neighbouring cell. Change only what each frame's pose ` +
    `describes, and make every frame visibly different from the frame before it. ${effects}` +
    `No cell borders, grid lines, labels, numbers, arrows, shadows, ground, scenery, text, or extra copies of cell 1. ` +
    `Hard-edged grid-aligned pixels, flat colour fills, no anti-aliasing, blur, gradients or drop shadows.`
  );
}

function isPng(bytes: Uint8Array): boolean {
  return PNG_SIGNATURE.every((byte, index) => bytes[index] === byte);
}

/** Reads the IHDR dimensions needed to reject a mismatched edit mask locally. */
function pngDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (
    bytes.length < 24 ||
    bytes[8] !== 0 || bytes[9] !== 0 || bytes[10] !== 0 || bytes[11] !== 13 ||
    bytes[12] !== 0x49 || bytes[13] !== 0x48 || bytes[14] !== 0x44 || bytes[15] !== 0x52
  ) {
    return null;
  }
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = data.getUint32(16);
  const height = data.getUint32(20);
  return width > 0 && height > 0 ? { width, height } : null;
}

/** Keeps edits faithful to the source without forcing sprites into tile rules. */
export function buildDerivePrompt(
  instruction: string,
  kind: DeriveKind,
  mode: DeriveMode = "vary",
  sheet?: AnimationSheet,
): string {
  if (mode === "animate") {
    if (sheet === undefined) throw new Error('mode "animate" needs the sheet layout and poses.');
    return buildAnimationSheetPrompt(instruction, sheet);
  }

  if (mode === "inpaint") {
    return (
      `Edit only the masked region of the supplied pixel-art asset: ${instruction.trim()}. ` +
      `The transparent area of the mask is the only area that may change; preserve all unmasked pixels, composition, ` +
      `outline weight, pixel-cluster scale, lighting direction, and style exactly. ` +
      `Return the complete edited canvas at exactly the source's framing, not an isolated replacement fragment. ` +
      `The mask marks where edits are permitted; it is not a cutout to erase or make transparent. ` +
      `Inside it change only the requested feature, leaving every other feature in its original position. ` +
      `For a colour or clothing edit, do not erase body parts, move the figure, change its pose, or disconnect its head and limbs. ` +
      `Keep existing colours except where the requested edit explicitly needs a different colour. ` +
      `Keep hard grid-aligned pixels, crisp clusters, and a limited cohesive palette. ` +
      `No anti-aliasing, blur, gradients, text, borders, drop shadows, new background elements, or changes outside the mask.`
    );
  }

  // Extraction starts from arbitrary reference art rather than an existing
  // indexed asset, so pixel-art and preserve-the-source-edit rules would
  // contradict the requested reconstruction.
  if (mode === "extract") {
    return (
      `Extract the primary character from the supplied reference: ${instruction.trim()}. ` +
      `Redraw it as exactly one clean, full-body, flat-colour cel-shaded 2D game-character illustration on a fully ` +
      `transparent background. This is clean raster concept art for later pixelisation: it must not be pixel art yet, ` +
      `a photograph, or a realistic 3D render, and must not merely cut the photographic subject out. Use a bold readable ` +
      `silhouette, large separated colour regions with crisp edges, three to five clear value groups, simple controlled ` +
      `lighting, and only details large enough to survive the target sprite size. Remove photographic texture, noise, ` +
      `glow, cast shadows, and reflected scenery while keeping functional equipment recognisable. ` +
      `Build the figure in this priority order: first a clear body plan and gesture, then a readable silhouette with separated ` +
      `limbs, then large outfit and equipment shapes wrapped around that body, and only then signature details. For a humanoid, ` +
      `keep the head, neck, torso, pelvis, arms, elbows, hands, legs, knees, and feet anatomically connected and easy to distinguish; ` +
      `use negative space where limbs would otherwise merge. Clothing must wrap around the implied body volumes and preserve ` +
      `readable limb placement instead of replacing the body with an undifferentiated costume mass. If anatomy and costume ` +
      `fidelity compete at the target size, anatomy wins. ` +
      `Preserve the character's identity, proportions, pose, camera angle, recognisable outfit silhouette, main colours, and one ` +
      `or two defining features. Compress small accessories, folds, texture, and ornament instead of copying them literally. ` +
      `Remove scenery, other subjects, text, labels, UI, frames, and decorative backgrounds. ` +
      `If any part is obscured or clipped, reconstruct only the conservative continuation implied by the visible design; ` +
      `do not invent major features, props, effects, or redesigns. Keep the complete character entirely visible with a small ` +
      `even margin and never crop or touch the image edges. Simplify surface detail, never identity or body structure.`
    );
  }

  /**
   * Rotation has to say the opposite of variation, or it silently does nothing.
   *
   * "Preserve the subject's camera angle" is right for a material change and
   * exactly wrong for a turn, and it used to be unconditional — so
   * `rotate_character` asked for a side view, the base prompt insisted the angle
   * stay put, and the model obeyed the stronger, more specific instruction.
   * The result was a library of "east" and "north" assets that were all the
   * front view under different names, with nothing reporting a problem.
   *
   * Measured: ten chests turned to a side and a back view came back as ten
   * unchanged three-quarter views.
   */
  const camera =
    mode === "rotate"
      ? `Change ONLY the camera angle, exactly as instructed — this is a turn of the subject, not a redesign. ` +
        `The new view must be visibly and unmistakably a different angle from the source. ` +
        `Preserve the subject's identity, materials, ornament, proportions, `
      : mode === "pose"
        ? // A frame of a cycle: same subject, same camera, different pose. Says
          // "preserve identity" and "change the pose" together, because the
          // default clause forbids exactly the change being asked for.
          `Change ONLY the subject's pose and the position of its moving parts, exactly as instructed — ` +
          `this is one frame of an animation cycle, not a redesign. The pose must be visibly different from ` +
          `the source. Preserve per-part proportions and source registration: keep stable body parts and grounded contact points ` +
          `at their source positions unless the motion explicitly requires a jump or airborne pose, locomotion, or lifted contact. ` +
          `Let moving limbs and equipment change the silhouette naturally; do not re-centre, crop, or rescale the subject to fit each pose. ` +
          `Preserve the subject's identity, materials, ornament, colours, camera angle, perspective, `
        : `Preserve the subject's identity, camera angle, perspective, `;

  const common =
    `Edit the supplied pixel-art asset: ${instruction.trim()}. Treat the source as the canonical art direction. ` +
    `${camera}${mode === "pose" ? "" : "canvas occupancy, "}outline weight, pixel-cluster scale, ` +
    `lighting direction, contrast hierarchy, and palette complexity. Make the requested transformation unmistakable and ` +
    `game-readable while keeping it recognisably part of the same asset family. Change only what the instruction names; ` +
    `keep existing equipment and every unmentioned design feature recognisable, and do not invent or remove props or ` +
    `effects unless requested. Keep hard grid-aligned pixels, crisp ` +
    `clusters, and a limited cohesive palette. No anti-aliasing, blur, gradients, text, borders, or drop shadows. `;

  return kind === "texture"
    ? common +
        `Return one seamless square game texture filling the image, not a mockup, sprite sheet, framed tile, or scene. ` +
        `Opposite edges must join without a visible seam.`
    : common +
        `Return exactly one isolated sprite at the source's scale on a transparent background, not a mockup, sprite sheet, ` +
        `frame, card, or scene. ` +
        (mode === "vary"
          ? `Keep the same functional silhouette, but allow deliberate material, ornament, age, damage, biome, rarity, or magical details requested by the instruction.`
          : `Redraw the silhouette and occlusion for the requested angle or pose; do not preserve the old projected outline. ` +
            `Keep the full figure anatomically connected: head to neck, arms to shoulders, hands to wrists, legs to hips, feet to legs. ` +
            `Show only the features visible from the requested view; a profile has one visible eye and a back view does not show the face. ` +
            `Keep the complete body and equipment inside the canvas with a small transparent margin; no detached parts or overlapping duplicate views.`);
}

/**
 * High-fidelity variation of an existing indexed asset.
 *
 * Multipart keeps the source PNG binary end to end. The browser has already
 * rendered it with nearest-neighbour scaling, so the model sees the real
 * palette, proportions, and pixel cadence instead of a prose reconstruction.
 */
export function createDeriveRoute(): Hono {
  const app = new Hono();

  app.post("/", async (c) => {
    let form: FormData;
    try {
      form = await c.req.formData();
    } catch {
      return c.json(
        {
          error: {
            code: "invalid_argument",
            message: "Request body must be multipart form data.",
          },
        },
        400,
      );
    }

    const instruction = form.get("instruction");
    const source = form.get("source");
    const mask = form.get("mask");
    const kind = form.get("kind") ?? "texture";
    const modeField = form.get("mode") ?? "vary";
    if (typeof instruction !== "string" || instruction.trim().length === 0) {
      return c.json(
        {
          error: {
            code: "invalid_argument",
            message: 'A non-empty "instruction" is required.',
          },
        },
        400,
      );
    }
    if (instruction.length > MAX_IMAGE_TEXT_LENGTH) {
      return c.json(
        {
          error: {
            code: "invalid_argument",
            message: `Instruction must be ${MAX_IMAGE_TEXT_LENGTH} characters or fewer, including project style text; received ${instruction.length}.`,
          },
        },
        400,
      );
    }
    if (typeof modeField !== "string" || !DERIVE_MODES.includes(modeField as DeriveMode)) {
      return c.json(
        { error: { code: "invalid_argument", message: `"mode" must be one of ${DERIVE_MODES.map((name) => `"${name}"`).join(", ")}.` } },
        400,
      );
    }
    const mode = modeField as DeriveMode;
    if (kind !== "sprite" && kind !== "texture") {
      return c.json(
        {
          error: {
            code: "invalid_argument",
            message: '"kind" must be "sprite" or "texture".',
          },
        },
        400,
      );
    }
    if (
      !(source instanceof File) ||
      source.type !== "image/png" ||
      source.size === 0
    ) {
      return c.json(
        {
          error: {
            code: "invalid_argument",
            message: '"source" must be a non-empty PNG file.',
          },
        },
        400,
      );
    }
    if (source.size > MAX_SOURCE_BYTES) {
      return c.json(
        {
          error: {
            code: "invalid_argument",
            message: "Source PNG must be 8 MB or smaller.",
          },
        },
        400,
      );
    }

    const bytes = new Uint8Array(await source.arrayBuffer());
    if (!isPng(bytes)) {
      return c.json(
        {
          error: {
            code: "invalid_argument",
            message: '"source" is not a valid PNG file.',
          },
        },
        400,
      );
    }

    // A sheet is generated at its own size, which must be one the model
    // returns: the client composes it to exactly 1024x1024, 1536x1024 or
    // 1024x1536 so the cells it cuts afterwards are where it put them.
    let sheet: AnimationSheet | undefined;
    let size: (typeof SIZES)[number] = DEFAULT_SIZE;
    if (mode === "animate") {
      const parsed = parseAnimationSheet(form);
      if (typeof parsed === "string") {
        return c.json({ error: { code: "invalid_argument", message: parsed } }, 400);
      }
      sheet = parsed;
      const dimensions = pngDimensions(bytes);
      const sheetSize = dimensions === null ? undefined : `${String(dimensions.width)}x${String(dimensions.height)}`;
      if (sheetSize === undefined || !SIZES.includes(sheetSize as (typeof SIZES)[number])) {
        return c.json(
          { error: { code: "invalid_argument", message: `An animation sheet must be exactly one of ${SIZES.join(", ")} pixels; received ${sheetSize ?? "an unreadable size"}.` } },
          400,
        );
      }
      size = sheetSize as (typeof SIZES)[number];
    }

    let maskBytes: Uint8Array | undefined;
    if (mode === "inpaint") {
      if (!(mask instanceof File) || mask.type !== "image/png" || mask.size === 0) {
        return c.json(
          { error: { code: "invalid_argument", message: '"mask" must be a non-empty PNG file when mode is "inpaint".' } },
          400,
        );
      }
      if (mask.size > MAX_MASK_BYTES) {
        return c.json(
          { error: { code: "invalid_argument", message: "Mask PNG must be 4 MB or smaller." } },
          400,
        );
      }
      maskBytes = new Uint8Array(await mask.arrayBuffer());
      if (!isPng(maskBytes)) {
        return c.json(
          { error: { code: "invalid_argument", message: '"mask" is not a valid PNG file.' } },
          400,
        );
      }
      const sourceDimensions = pngDimensions(bytes);
      const maskDimensions = pngDimensions(maskBytes);
      if (sourceDimensions === null || maskDimensions === null) {
        return c.json(
          { error: { code: "invalid_argument", message: '"source" and "mask" must be valid PNG files with dimensions.' } },
          400,
        );
      }
      if (
        sourceDimensions.width !== maskDimensions.width ||
        sourceDimensions.height !== maskDimensions.height
      ) {
        return c.json(
          { error: { code: "invalid_argument", message: '"mask" dimensions must exactly match "source".' } },
          400,
        );
      }
    }

    // Metered before the key check, so a refused request costs nothing and an
    // unconfigured deployment cannot be used to probe the limiter.
    const verdict = limitVerdict(generateLimiter, c.req.raw.headers);
    if (!verdict.allowed) {
      c.header("Retry-After", String(verdict.retryAfterSeconds));
      return c.json(limitedBody(verdict), 429);
    }

    const key = process.env.OPENAI_API_KEY;
    if (!key) {
      const [failed, status] = failure(
        "generation_unconfigured",
        "Generation is not configured: OPENAI_API_KEY is not set on the server.",
      );
      return c.json(failed, status);
    }

    const prompt = buildDerivePrompt(instruction, kind, mode, sheet);

    try {
      const openai = new OpenAI({ apiKey: key });
      const image = await toFile(bytes, "source.png", { type: "image/png" });
      const editMask = maskBytes === undefined
        ? undefined
        : await toFile(maskBytes, "mask.png", { type: "image/png" });
      const response = await openai.images.edit({
        model: MODEL,
        image,
        ...(editMask === undefined ? {} : { mask: editMask }),
        prompt,
        size,
        quality: sheet?.quality ?? "high",
        background: mode === "extract" || kind === "sprite" ? "transparent" : "opaque",
        // No `input_fidelity: "high"` for sheets, although a faithfully
        // reproduced reference cell is exactly what it promises: gpt-image-2
        // rejects the parameter outright (measured: 400, "does not support").
        output_format: "png",
        n: 1,
      });

      const output = response.data?.[0]?.b64_json;
      if (!output) {
        return c.json(
          {
            error: {
              code: "upstream_error",
              message: "The model returned no image.",
            },
          },
          502,
        );
      }
      return c.json({ image: output, model: MODEL });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json(
        {
          error: {
            code: "upstream_error",
            message: `Variation failed: ${message}`,
          },
        },
        502,
      );
    }
  });

  return app;
}
