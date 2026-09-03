/**
 * The client for `apps/api`.
 *
 * The only network call the app makes. Everything else — the store, the whole
 * pixelisation pipeline, every deterministic tool — runs in the browser, so this
 * failing degrades generation and nothing else. Callers are expected to say so.
 */

import { compressIndexedPng } from "@/lib/export";
import { ToolError } from "./types";

/**
 * A bound on a paid call, so a hang becomes a readable error.
 *
 * Generation has been measured at 156 seconds and is not stable — asking for a
 * transparent background moved it, and quality will move it again. Five minutes
 * is well clear of any measurement so far while still being finite: an
 * unbounded request leaves a spinner running forever, and a spinner that never
 * resolves is indistinguishable from a slow one.
 */
const PAID_REQUEST_TIMEOUT_MS = 5 * 60 * 1000;
/** Matches /v1/generate and /v1/derive, including appended project style text. */
const MAX_IMAGE_TEXT_LENGTH = 16_000;
/** A motion brief, not the full 400,000-character chat conversation budget. */
export const MAX_ANIMATION_DESCRIPTION_LENGTH = 10_000;

function validateImageText(text: string, field: "Prompt" | "Instruction"): void {
  if (text.trim().length === 0) {
    throw new ToolError(`A non-empty "${field.toLowerCase()}" is required.`);
  }
  if (text.length > MAX_IMAGE_TEXT_LENGTH) {
    throw new ToolError(`${field} must be ${String(MAX_IMAGE_TEXT_LENGTH)} characters or fewer, including project style text; received ${String(text.length)}. Shorten the text or project style notes before generating.`);
  }
}

/** What the planner may write per pose; leaves room for a repair note within the API's cap. */
export const MAX_PLANNED_POSE_LENGTH = 400;
/** Matches /v1/derive's per-pose cap; a sheet prompt carries every pose at once. */
export const MAX_POSE_LENGTH = 600;
/** Matches /v1/derive's cap on the effects brief. */
export const MAX_EFFECTS_LENGTH = 400;
/** A frame hold the planner may choose, in milliseconds. */
export const MIN_FRAME_MS = 60;
export const MAX_FRAME_MS = 400;
/** The rest pose's hold between repeats. */
export const MIN_REST_MS = 100;
export const MAX_REST_MS = 1200;
export const DEFAULT_REST_MS = 500;

export type Contact = "grounded" | "airborne";

export interface PlannedPose {
  readonly pose: string;
  /** Whether both feet leave the ground — the frames registration must leave alone. */
  readonly contact: Contact;
  /** How long the frame holds. Extremes and settles long, passing frames short. */
  readonly ms: number;
  /** Where the requested effect sits in this frame, or undefined for none. */
  readonly effect?: string;
}

export interface PosePlan {
  /** The rest pose as the planner read it from the image — shown back so a misreading is visible. */
  readonly source: string;
  readonly frames: PlannedPose[];
  /**
   * How long the rest pose holds between repeats of the action.
   *
   * A game gets this pause for free by returning to idle; a looping preview
   * does not, and a jab that restarts every 300ms reads as frantic.
   */
  readonly restMs: number;
}

export interface FrameVerdict {
  /** 1-based, matching the plan. */
  readonly frame: number;
  readonly ok: boolean;
  readonly problems: readonly string[];
}

interface InFlight {
  readonly label: string;
  readonly startedAt: number;
}

/**
 * Concurrency is tracked per category, not globally.
 *
 * The guard exists so a user who cannot tell slow from stuck does not click
 * twice and buy a second image. That reasoning applies within a category and
 * not across them: a generation runs for minutes, and blocking the chat behind
 * it would make the assistant unusable exactly when someone is waiting and most
 * likely to ask a question.
 *
 * The refusal to spend from a test run is global, because that one has nothing
 * to do with what is running.
 */
type PaidCategory = "image" | "chat";

const inFlight = new Map<PaidCategory, InFlight>();

/**
 * Opt-in for the handful of tests that exercise the paid path itself.
 *
 * Deliberately explicit and deliberately ugly. A test that forgets it fails
 * closed with a clear message; a test that wants the path says so in one line
 * and mocks `fetch`. The default direction is what matters — forgetting must
 * cost nothing, not an image.
 */
let paidAllowedInTest = false;

export function __allowPaidRequestsForTest(allowed: boolean): void {
  paidAllowedInTest = allowed;
}

/** Whether a paid request is running, so the UI can disable rather than queue. */
export function paidRequestInFlight(category: PaidCategory = "image"): boolean {
  return inFlight.has(category);
}

/**
 * Serialises the calls that cost money, and bounds them.
 *
 * The guard is the point. Generation takes minutes with nothing to look at, so
 * a user who cannot tell slow from stuck clicks again — and a second click is a
 * second image bought. Refusing the second call with the elapsed time of the
 * first turns that into information rather than a charge.
 */
async function paid<T>(
  label: string,
  run: (signal: AbortSignal) => Promise<T>,
  category: PaidCategory = "image",
  timeoutMs: number = PAID_REQUEST_TIMEOUT_MS,
): Promise<T> {
  const [result] = await paidAll(label, [run], category, timeoutMs);
  if (result === undefined) throw new ToolError(`The ${label} request produced no result.`);
  if (result.status === "rejected") throw result.reason;
  return result.value;
}

/**
 * Several paid requests under one hold on the slot, run concurrently.
 *
 * The guard is about *separate* actions: a second click while the first is
 * still running. One tool that needs three images — a direction set, an
 * animation too long for one sheet — is one action, and running its images
 * one after another only makes the human wait three times as long for the
 * same bill. So the slot is taken once for the whole batch, other actions are
 * refused for its duration exactly as they would be for a single request, and
 * every request gets its own timeout. Results come back settled, in order,
 * because one failed image should not throw away the ones beside it.
 */
async function paidAll<T>(
  label: string,
  runs: readonly ((signal: AbortSignal) => Promise<T>)[],
  category: PaidCategory = "image",
  timeoutMs: number = PAID_REQUEST_TIMEOUT_MS,
): Promise<PromiseSettledResult<T>[]> {
  // A test suite must not be able to spend money, and "every test remembers to
  // skip the paid tools" is not a property anyone can hold. It has already
  // failed twice: a `network` flag guarded two tests and not a third, and a new
  // paid tool bought an image from a green run.
  //
  // So the refusal lives here, where every paid call passes, rather than in each
  // test where it can be forgotten. A test that genuinely wants this path must
  // mock `fetch`, which is what the existing ones already do.
  if (process.env.NODE_ENV === "test" && !paidAllowedInTest) {
    throw new ToolError(
      `Refusing to make a paid ${label} request from a test run. Mock fetch if the test needs this path.`,
    );
  }
  if (runs.length === 0) return [];

  const running = inFlight.get(category);
  if (running !== undefined) {
    const seconds = Math.round((Date.now() - running.startedAt) / 1000);
    throw new ToolError(
      `A ${running.label} request started ${String(seconds)}s ago and is still running. ` +
        `Wait for it rather than starting another — each one is a paid image generation, and they take minutes.`,
    );
  }

  inFlight.set(category, { label, startedAt: Date.now() });
  try {
    return await Promise.allSettled(
      runs.map(async (run) => {
        try {
          return await run(AbortSignal.timeout(timeoutMs));
        } catch (error) {
          if (error instanceof DOMException && error.name === "TimeoutError") {
            throw new ToolError(
              `The ${label} request did not finish within ${String(Math.round(timeoutMs / 1000))}s and was abandoned. ` +
                `The image may still have been generated and charged for. Check the library before trying again.`,
            );
          }
          throw error;
        }
      }),
    );
  } finally {
    inFlight.delete(category);
  }
}

/** Same-origin `/api` in production behind a rewrite; the local API otherwise. */
export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3002";

export interface GenerateRequest {
  readonly prompt: string;
  readonly palette?: readonly string[];
  readonly size?: "1024x1024" | "1024x1536" | "1536x1024";
  /** Sprites get a transparent background; textures fill the frame. */
  readonly kind?: "sprite" | "texture";
  readonly quality?: "low" | "medium" | "high";
  /**
   * The grid this image will be reduced to, in cells.
   *
   * Sent so the prompt can bound feature *count* rather than merely asking for
   * chunky art. A bush drawn leaf by leaf and a bush drawn as four leaf masses
   * look equally good at 1024px and only the second one survives 32 cells.
   */
  readonly cells?: number;
}

export interface GenerateResponse {
  readonly image: string;
  readonly model: string;
}

interface ApiError {
  readonly error?: { readonly code?: string; readonly message?: string };
}

/**
 * Turns a failed response into a message that says what to do about it.
 *
 * The distinction that matters to an agent is "this deployment cannot generate"
 * versus "the model refused this prompt" — one is worth reporting to the human
 * and abandoning, the other is worth rephrasing and retrying. That is why the
 * API returns a code rather than only a string.
 */
function describeFailure(status: number, body: ApiError): string {
  const code = body.error?.code ?? "unknown";
  const message =
    body.error?.message ?? `The generation service returned ${String(status)}.`;

  if (code === "generation_unconfigured") {
    return `${message} Everything except generation still works — drawing, editing and every deterministic tool are unaffected.`;
  }
  if (code === "invalid_argument") {
    return `${message} Fix the request and try again.`;
  }
  if (code === "upstream_error") {
    return `${message} This is the image model failing, not your request being wrong; rephrasing the prompt or retrying often works.`;
  }
  return message;
}

export async function generateImage(
  request: GenerateRequest,
): Promise<GenerateResponse> {
  validateImageText(request.prompt, "Prompt");
  let response: Response;
  try {
    response = await paid("generation", (signal) =>
      fetch(`${API_BASE}/v1/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
        signal,
      }),
    );
  } catch (error) {
    // The guard and the timeout already say exactly what happened; rewording
    // them as a connectivity failure would be wrong and unactionable.
    if (error instanceof ToolError) throw error;
    throw new ToolError(
      `Could not reach the generation service at ${API_BASE}: ${error instanceof Error ? error.message : String(error)}. ` +
        `Every deterministic tool still works; only generation is unavailable.`,
    );
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ApiError;
    throw new ToolError(describeFailure(response.status, body));
  }

  const body = (await response.json()) as Partial<GenerateResponse>;
  if (typeof body.image !== "string" || body.image.length === 0) {
    throw new ToolError("The generation service returned no image data.");
  }
  return { image: body.image, model: body.model ?? "unknown" };
}

/**
 * Chat settings for the two structured calls, chosen by measurement.
 *
 * On the same warrior plan and strip: default reasoning planned in 69s and
 * judged in 28s; `low` planned in 25s and judged in 10s with the same source
 * reading, the same four-stage structure and the same 4/4 verdict; `minimal`
 * (5s) and gpt-5-mini (9s) each produced a false rejection, which buys a
 * repair image for nothing and costs more time than they save.
 */
export const PLANNER_CHAT: ChatOptions = { reasoning: "low", verbosity: "low" };
export const JUDGE_CHAT: ChatOptions = { reasoning: "low", verbosity: "low" };

export interface PlanRequest {
  readonly subject: string;
  readonly motion: string;
  readonly frames: number;
  /** How the sprite faces, from the direction in its name. */
  readonly facing?: string;
  /** Effects the frames should carry — an air-cut arc, a purple trail, sparkles. */
  readonly effects?: string;
  /** The rest pose as a PNG, so the planner reads the stance instead of guessing it from a name. */
  readonly source?: Uint8Array;
  /** Overrides the measured default for the planning call. */
  readonly chat?: ChatOptions;
}

/**
 * Asks the chat model to break a motion into per-frame poses, as an animator would.
 *
 * One cheap text call before the expensive image call. A generic phase hint
 * ("40% through the motion") produces frames that differ arbitrarily rather
 * than describing a cycle, because the image model has no idea what 40% of a
 * weapon pull-out looks like. Naming the pose is what makes the frames read as
 * one motion — and naming the *structure* (anticipation, extreme, follow-through,
 * recovery) is what makes them read as a punch rather than four stances.
 *
 * The planner sees the sprite. Planned from a name alone, a warrior whose blade
 * rests over his shoulder was given an anticipation that swung it low first,
 * because nothing said where the blade was. From the image, the plan starts
 * where the drawing does.
 *
 * The source drawing is frame 0 of the loop. That is true of nearly every
 * action a game needs — jab, kick, swing, jump, hurt — which all leave the
 * ready pose and return to it. A locomotion cycle is the exception, and the
 * tool description says how to drop the still frame afterwards.
 */
export function buildPosePrompt(request: PlanRequest): string {
  const count = String(request.frames);
  const facing = request.facing === undefined ? "" : `, drawn ${request.facing}`;
  const rest =
    request.source === undefined
      ? `The sprite's current drawing is its rest pose. `
      : `The attached image is the sprite's current drawing, at rest: read its stance, facing, and what each hand holds ` +
        `from the image, and plan from exactly that pose. `;
  const effects =
    request.effects === undefined
      ? ""
      : `Effects requested: "${request.effects}". For each frame say exactly where each effect appears, or say none: ` +
        `an arc or air-cut follows the path the weapon or limb sweeps in the frame where it moves fastest, a trail lags ` +
        `behind the moving part, and sparkles, smoke or magic gather at their source. Effects are flat pixel-art shapes ` +
        `in one to three colours and never hide the character's face or silhouette. `;
  return (
    `You are planning the frames of a 2D game sprite animation the way a game animator would. ` +
    `The sprite: ${request.subject}${facing}. ${rest}The motion: "${request.motion}". ` +
    `The rest pose is frame 0 of the loop and plays first; plan frames 1 to ${count}, which follow it, and the loop ` +
    `returns to frame 0 after frame ${count}. Do not describe frame 0 as a frame. ` +
    `Structure the motion like an animator: a short anticipation that moves slightly against the action, the key extreme ` +
    `with the strongest silhouette, then follow-through and recovery leading back into the rest pose. For a continuous cycle ` +
    `such as a walk, run or idle, spread the phases evenly so frame ${count} leads into frame 0. Make consecutive frames ` +
    `visibly different and never repeat a pose. ` +
    `Give each frame a hold in milliseconds between ${String(MIN_FRAME_MS)} and ${String(MAX_FRAME_MS)}: anticipation and ` +
    `passing frames short, the key extreme and the settle longer, so a complete strike lasts about half a second in total, ` +
    `while an idle, walk or run cycle uses even holds. Also give "rest", the hold on frame 0 between repeats: ` +
    `${String(MIN_REST_MS)}-${String(MAX_REST_MS)}ms, long for a one-shot action so the loop has a beat before it strikes again, ` +
    `and the same as an ordinary frame for a continuous cycle. ` +
    `Every frame keeps the same camera angle and facing, the same scale and the same ground line. Say which foot or feet stay ` +
    `planted, and mark a frame airborne only when both feet leave the ground. Visible equipment stays with the character and a ` +
    `weapon moves with the hand that holds it. Do not invent or remove equipment, props or effects unless the motion requires them. ` +
    `${effects}` +
    `Each pose must be self-contained, because the image model receives only these poses and the source sprite, not this brief: ` +
    `at most ${String(MAX_PLANNED_POSE_LENGTH)} characters, and physical — torso lean and weight, each arm and hand, each leg and foot, ` +
    `the head, and where any weapon or equipment is. Never describe art style or colours. ` +
    `Reply with JSON only and no commentary: {"source":"one sentence describing the rest pose as you read it","rest":600,` +
    `"frames":[{"pose":"...","contact":"grounded","ms":120${request.effects === undefined ? "" : ',"effect":"..."'}}]} ` +
    `with exactly ${count} entries, where contact is "grounded" or "airborne".`
  );
}

function clampMs(value: unknown): number {
  const ms = typeof value === "number" ? Math.round(value) : typeof value === "string" ? Math.round(Number.parseFloat(value)) : Number.NaN;
  if (!Number.isFinite(ms)) return DEFAULT_PLANNED_MS;
  return Math.max(MIN_FRAME_MS, Math.min(MAX_FRAME_MS, ms));
}

/** What a frame holds when the planner says nothing usable; the product's default hold. */
const DEFAULT_PLANNED_MS = 250;

function plannedPose(value: unknown): PlannedPose | null {
  if (typeof value === "string") {
    const pose = value.trim();
    return pose.length === 0 ? null : { pose, contact: "grounded", ms: DEFAULT_PLANNED_MS };
  }
  if (typeof value !== "object" || value === null) return null;
  const record = value as { pose?: unknown; contact?: unknown; ms?: unknown; effect?: unknown };
  if (typeof record.pose !== "string" || record.pose.trim().length === 0) return null;
  const effect = typeof record.effect === "string" ? record.effect.trim() : "";
  return {
    pose: record.pose.trim(),
    contact: record.contact === "airborne" ? "airborne" : "grounded",
    ms: clampMs(record.ms),
    ...(effect.length === 0 || /^none\b/i.test(effect) ? {} : { effect }),
  };
}

/** The outermost JSON object in a reply, or null — models wrap JSON in prose and fences. */
function outermostJson(content: string): Record<string, unknown> | null {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const parsed: unknown = JSON.parse(content.slice(start, end + 1));
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Reads a plan out of the model's reply.
 *
 * JSON first, because that is what was asked for; one pose per line as the
 * fallback, because a model that ignores the format still usually numbers its
 * frames, and a plan that parses is worth more than a purity complaint. A pose
 * over the cap is refused rather than cut — a truncated pose describes a
 * different frame.
 */
export function parsePosePlan(content: string, frames: number): PosePlan {
  let entries: PlannedPose[] = [];
  let source = "";
  let restMs = DEFAULT_REST_MS;
  const parsed = outermostJson(content);
  if (parsed !== null) {
    if (Array.isArray(parsed["frames"])) {
      entries = parsed["frames"].map(plannedPose).filter((entry): entry is PlannedPose => entry !== null);
    }
    if (typeof parsed["source"] === "string") source = parsed["source"].trim();
    const rest = parsed["rest"];
    const value = typeof rest === "number" ? rest : typeof rest === "string" ? Number.parseFloat(rest) : Number.NaN;
    if (Number.isFinite(value)) restMs = Math.max(MIN_REST_MS, Math.min(MAX_REST_MS, Math.round(value)));
  }
  if (entries.length === 0) {
    entries = content
      .split("\n")
      .map((line) => line.replace(/^\s*(?:frame\s*)?[-*\d.):\]]+\s*/i, "").trim())
      .map(plannedPose)
      .filter((entry): entry is PlannedPose => entry !== null);
  }

  if (entries.length < frames) {
    throw new ToolError(
      `The model described ${String(entries.length)} poses but ${String(frames)} were asked for. ` +
        `Try fewer frames, or a motion with more distinct stages.`,
    );
  }
  const plan = entries.slice(0, frames);
  for (const [index, entry] of plan.entries()) {
    if (entry.pose.length > MAX_PLANNED_POSE_LENGTH) {
      throw new ToolError(
        `Pose ${String(index + 1)} is ${String(entry.pose.length)} characters; the cap is ${String(MAX_PLANNED_POSE_LENGTH)}. ` +
          `Try again, or describe the motion more simply.`,
      );
    }
  }
  return { source, frames: plan, restMs };
}

type ChatContent = string | { type: "text"; text: string }[] | ({ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } })[];

/** Matches /v1/chat. */
export interface ChatOptions {
  readonly reasoning?: "minimal" | "low" | "medium" | "high";
  readonly verbosity?: "low" | "medium" | "high";
  readonly model?: string;
}

function pngDataUrl(png: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < png.length; i += 1) binary += String.fromCharCode(png[i] as number);
  return `data:image/png;base64,${btoa(binary)}`;
}

/** One user turn to the chat model, with an image beside the text when there is one. */
async function askChat(text: string, image?: Uint8Array, options: ChatOptions = {}): Promise<string> {
  // Compressed on the way out: an uncompressed strip of five 128px frames at
  // 4x is a megabyte of base64, over the chat route's body cap; deflated it
  // is a few tens of kilobytes.
  const content: ChatContent =
    image === undefined
      ? text
      : [
          { type: "text", text },
          { type: "image_url", image_url: { url: pngDataUrl(await compressIndexedPng(image)) } },
        ];
  // `paidChatRequest`, not `paid` directly: this buys text, so it belongs in the
  // chat category. Under the image category it would take the five-minute
  // timeout meant for generation, and — worse — occupy the image slot, so
  // planning a few poses would refuse a real generation and be refused by one.
  // That is the same usability failure per-category concurrency exists to stop.
  const response = await paidChatRequest(async (signal) =>
    fetch(`${API_BASE}/v1/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content }], ...options }),
      signal,
    }),
  );
  if (!response.ok) {
    throw new ToolError(
      describeFailure(response.status, (await response.json().catch(() => ({}))) as ApiError),
    );
  }
  const body = (await response.json()) as { message?: { content?: string } };
  return body.message?.content ?? "";
}

export async function planPoses(request: PlanRequest): Promise<PosePlan> {
  if (request.motion.trim().length === 0 || request.motion.length > MAX_ANIMATION_DESCRIPTION_LENGTH) {
    throw new ToolError(`Animation description must be non-empty and ${String(MAX_ANIMATION_DESCRIPTION_LENGTH)} characters or fewer. Shorten the motion brief before planning poses.`);
  }
  if (request.effects !== undefined && request.effects.length > MAX_EFFECTS_LENGTH) {
    throw new ToolError(`Effects must be ${String(MAX_EFFECTS_LENGTH)} characters or fewer; received ${String(request.effects.length)}.`);
  }
  return parsePosePlan(await askChat(buildPosePrompt(request), request.source, request.chat ?? PLANNER_CHAT), request.frames);
}

export interface JudgeRequest {
  /** The source at rest followed by every frame, left to right, as one PNG strip. */
  readonly strip: Uint8Array;
  readonly plan: readonly PlannedPose[];
  readonly effects?: string;
  /** Overrides the measured default for the judging call. */
  readonly chat?: ChatOptions;
}

/**
 * What the judge is asked, and in what order.
 *
 * Identity, scale, facing and pose are the properties a sheet is meant to
 * guarantee and the ones a mechanical check cannot see, so the judge is told
 * to be strict about exactly those and lenient about pixel-level detail — a
 * judge that rejects a frame for a differently shaded boot buys a repair
 * image for nothing.
 */
export function buildJudgePrompt(request: JudgeRequest): string {
  const count = String(request.plan.length);
  const plan = request.plan
    .map((entry, index) => `Frame ${String(index + 1)}: ${entry.pose}${entry.effect === undefined ? "" : ` Effect: ${entry.effect}`}`)
    .join(" ");
  return (
    `You are checking generated frames of a 2D pixel-art game sprite animation against their plan. The attached image is a strip: ` +
    `the source sprite at rest on the far left, then frames 1 to ${count} left to right, separated by transparent gaps. ` +
    `The plan: ${plan} ${request.effects === undefined ? "No effects were requested; a frame with added glows, trails or motion lines fails." : `Effects requested: "${request.effects}".`} ` +
    `Judge every frame against the source on: identity — the same character, costume, equipment, proportions and facing; ` +
    `scale — the body is the same size as the source; stage — the frame shows its own planned stage of the motion (its wind-up, ` +
    `extension, follow-through or recovery) rather than another frame's stage, the rest pose, or a turned or mirrored character; ` +
    `completeness — nothing important is cut off at the frame's edge; effects — the planned effect is present where planned and nothing else was added. ` +
    `Be strict about identity, scale, facing, completeness and the stage of the motion. Do not reject a frame for details of a ` +
    `foot, heel, hand, head or lean that differ from the plan while the stage is right; pixel art cannot show them exactly. ` +
    `Tolerate small pixel-art detail differences and slight shading changes. ` +
    `Reply with JSON only and no commentary: {"frames":[{"frame":1,"ok":true,"problems":[]}]} with exactly ${count} entries, ` +
    `where problems lists each failed check as one short sentence.`
  );
}

/** Reads verdicts leniently: a frame the judge did not mention passes, because an absent opinion is not a failure. */
export function parseVerdicts(content: string, frames: number): FrameVerdict[] {
  const parsed = outermostJson(content);
  const verdicts = new Map<number, FrameVerdict>();
  const raw = parsed === null ? [] : parsed["frames"];
  if (Array.isArray(raw)) {
    for (const [position, entry] of raw.entries()) {
      if (typeof entry !== "object" || entry === null) continue;
      const record = entry as { frame?: unknown; ok?: unknown; problems?: unknown };
      const frame = typeof record.frame === "number" && Number.isInteger(record.frame) ? record.frame : position + 1;
      if (frame < 1 || frame > frames) continue;
      const problems = Array.isArray(record.problems)
        ? record.problems.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim())
        : [];
      const ok = record.ok === true || (record.ok === undefined && problems.length === 0);
      verdicts.set(frame, { frame, ok, problems });
    }
  }
  return Array.from({ length: frames }, (_, index) => verdicts.get(index + 1) ?? { frame: index + 1, ok: true, problems: [] });
}

export async function judgeFrames(request: JudgeRequest): Promise<FrameVerdict[]> {
  if (request.plan.length === 0) return [];
  return parseVerdicts(await askChat(buildJudgePrompt(request), request.strip, request.chat ?? JUDGE_CHAT), request.plan.length);
}

export interface AnimationSheetRequest {
  /** The composed sheet PNG: the source in cell 1, every other cell transparent. */
  readonly sheet: Uint8Array;
  readonly motion: string;
  readonly columns: number;
  readonly rows: number;
  /** Frame descriptions in order; frame `i` is drawn into cell `i + 2`. */
  readonly poses: readonly string[];
  /** Effects the frames may carry; without it the prompt forbids them. */
  readonly effects?: string;
  /** Fidelity to buy; defaults to the measured choice in `SHEET_QUALITY`. */
  readonly quality?: "low" | "medium" | "high";
}

/** Placeholder until measured: the route's default. */
export const SHEET_QUALITY: "low" | "medium" | "high" = "high";

/**
 * Buys one sheet of frames.
 *
 * The motion brief travels only when it fits the instruction cap; the poses
 * already carry its constraints frame by frame, and a brief cut mid-sentence
 * would say something the user did not.
 */
export async function deriveAnimationSheet(request: AnimationSheetRequest): Promise<GenerateResponse> {
  const [result] = await deriveAnimationSheets([request]);
  if (result === undefined) throw new ToolError("The sheet request produced no result.");
  if (result.status === "rejected") throw result.reason;
  return result.value;
}

/** Validates and packs one sheet request; throws before anything is bought. */
async function sheetForm(request: AnimationSheetRequest): Promise<FormData> {
  if (request.poses.length === 0) throw new ToolError("A sheet needs at least one pose.");
  if (request.columns * request.rows < request.poses.length + 1) {
    throw new ToolError(
      `A ${String(request.columns)}x${String(request.rows)} sheet holds ${String(request.columns * request.rows - 1)} frames beside the source, not ${String(request.poses.length)}.`,
    );
  }
  for (const [index, pose] of request.poses.entries()) {
    if (pose.trim().length === 0 || pose.length > MAX_POSE_LENGTH) {
      throw new ToolError(`Pose ${String(index + 1)} must be 1 to ${String(MAX_POSE_LENGTH)} characters; received ${String(pose.length)}.`);
    }
  }
  if (request.effects !== undefined && (request.effects.trim().length === 0 || request.effects.length > MAX_EFFECTS_LENGTH)) {
    throw new ToolError(`Effects must be 1 to ${String(MAX_EFFECTS_LENGTH)} characters; received ${String(request.effects.length)}.`);
  }
  const instruction = request.motion.trim();
  validateImageText(instruction, "Instruction");

  const form = new FormData();
  form.set("instruction", instruction);
  form.set("kind", "sprite");
  form.set("mode", "animate");
  form.set("columns", String(request.columns));
  form.set("rows", String(request.rows));
  form.set("poses", JSON.stringify(request.poses));
  if (request.effects !== undefined) form.set("effects", request.effects.trim());
  form.set("quality", request.quality ?? SHEET_QUALITY);
  const sheet = await compressIndexedPng(request.sheet);
  form.set("source", new File([Uint8Array.from(sheet).buffer], "sheet.png", { type: "image/png" }));
  return form;
}

/** Sends one derive form and reads the image out of the reply, with the failure wording callers expect. */
async function sendDerive(form: FormData, signal: AbortSignal): Promise<GenerateResponse> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/v1/derive`, { method: "POST", body: form, signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") throw error;
    throw new ToolError(
      `Could not reach the generation service at ${API_BASE}: ${error instanceof Error ? error.message : String(error)}. ` +
        `The source asset was not changed.`,
    );
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ApiError;
    throw new ToolError(describeFailure(response.status, body));
  }
  const body = (await response.json()) as Partial<GenerateResponse>;
  if (typeof body.image !== "string" || body.image.length === 0) {
    throw new ToolError("The generation service returned no image data.");
  }
  return { image: body.image, model: body.model ?? "unknown" };
}

/**
 * Buys several sheets at once — one action, one hold on the slot, concurrent
 * requests. Every request is validated before any is sent, so a bad second
 * sheet costs nothing rather than a first sheet.
 */
export async function deriveAnimationSheets(
  requests: readonly AnimationSheetRequest[],
): Promise<PromiseSettledResult<GenerateResponse>[]> {
  const forms: FormData[] = [];
  for (const request of requests) forms.push(await sheetForm(request));
  return paidAll("animation sheet", forms.map((form) => (signal) => sendDerive(form, signal)));
}

export interface DeriveRequest {
  readonly source: Uint8Array;
  readonly instruction: string;
  readonly kind?: "sprite" | "texture";
  readonly mode?: "vary" | "rotate" | "pose" | "extract" | "inpaint";
  readonly mask?: Uint8Array;
}

/** Packs one derivation; throws before anything is bought. */
function deriveForm({ source, instruction, kind = "texture", mode = "vary", mask }: DeriveRequest): FormData {
  validateImageText(instruction, "Instruction");
  const form = new FormData();
  form.set("instruction", instruction);
  form.set("kind", kind);
  form.set("mode", mode);
  form.set("source", new File([Uint8Array.from(source).buffer], "source.png", { type: "image/png" }));
  if (mode === "inpaint" && mask === undefined) throw new ToolError("Inpainting requires a PNG mask.");
  if (mask !== undefined) form.set("mask", new File([Uint8Array.from(mask).buffer], "mask.png", { type: "image/png" }));
  return form;
}

/**
 * Several derivations as one action — a direction set's three turned views,
 * bought concurrently instead of one after another. Validated up front; the
 * results come back settled, in order.
 */
export async function deriveImages(requests: readonly DeriveRequest[]): Promise<PromiseSettledResult<GenerateResponse>[]> {
  const forms = requests.map(deriveForm);
  return paidAll("derivation", forms.map((form) => (signal) => sendDerive(form, signal)));
}

export async function deriveImage(
  source: Uint8Array,
  instruction: string,
  kind: "sprite" | "texture" = "texture",
  /**
   * `rotate` flips the camera clause in the server prompt.
   *
   * Without it the base prompt insists the camera angle be preserved, which
   * silently defeats every rotation: a request for a side view returns the
   * source view unchanged, and the asset is filed under a direction it does not
   * depict.
   */
  mode: "vary" | "rotate" | "pose" | "extract" | "inpaint" = "vary",
  mask?: Uint8Array,
): Promise<GenerateResponse> {
  const [result] = await deriveImages([{ source, instruction, kind, mode, mask }]);
  if (result === undefined) throw new ToolError("The derivation produced no result.");
  if (result.status === "rejected") throw result.reason;
  return result.value;
}

/**
 * The chat loop's entry to the paid guard.
 *
 * Separate from image work so a running generation does not block the
 * assistant, and with a shorter timeout because a chat turn that has not
 * answered in two minutes is stuck rather than thinking.
 */
export async function paidChatRequest(
  run: (signal: AbortSignal) => Promise<Response>,
): Promise<Response> {
  return await paid("chat", run, "chat", 120_000);
}
