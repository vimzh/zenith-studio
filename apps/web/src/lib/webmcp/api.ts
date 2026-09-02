/**
 * The client for `apps/api`.
 *
 * The only network call the app makes. Everything else — the store, the whole
 * pixelisation pipeline, every deterministic tool — runs in the browser, so this
 * failing degrades generation and nothing else. Callers are expected to say so.
 */

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
    return await run(AbortSignal.timeout(timeoutMs));
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new ToolError(
        `The ${label} request did not finish within ${String(Math.round(timeoutMs / 1000))}s and was abandoned. ` +
          `The image may still have been generated and charged for. Check the library before trying again.`,
      );
    }
    throw error;
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
 * Asks the chat model to break a motion into per-frame poses.
 *
 * One cheap text call before N expensive image calls. A generic phase hint
 * ("40% through the motion") produces frames that differ arbitrarily rather
 * than describing a cycle, because the image model has no idea what 40% of a
 * weapon pull-out looks like. Naming the pose is what makes the frames read as
 * one motion.
 */
export function buildPosePrompt(subject: string, motion: string, frames: number): string {
  return (
    `A 2D game sprite of: ${subject}. Break the motion "${motion}" into exactly ${String(frames)} ` +
    `animation frames that loop cleanly. Reply with exactly ${String(frames)} lines, one per frame, ` +
    `no numbering and no commentary. Each line is a short physical description of the subject's pose ` +
    `in that frame — what moves, what remains stable, limb positions, visible equipment or weapon position, ` +
    `body lean, and contact with the ground. Keep the motion grounded in the named subject. Do not invent or ` +
    `remove equipment, props, or effects unless the requested motion requires them. Describe only the pose, ` +
    `never the art style or colours.`
  );
}

export async function describePoses(
  subject: string,
  motion: string,
  frames: number,
): Promise<readonly string[]> {
  const ask = buildPosePrompt(subject, motion, frames);

  // `paidChatRequest`, not `paid` directly: this buys text, so it belongs in the
  // chat category. Under the image category it would take the five-minute
  // timeout meant for generation, and — worse — occupy the image slot, so
  // planning a few poses would refuse a real generation and be refused by one.
  // That is the same usability failure per-category concurrency exists to stop.
  const response = await paidChatRequest(async (signal) =>
    fetch(`${API_BASE}/v1/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: ask }] }),
      signal,
    }),
  );
  if (!response.ok) {
    throw new ToolError(
      describeFailure(response.status, (await response.json().catch(() => ({}))) as ApiError),
    );
  }
  const body = (await response.json()) as { message?: { content?: string } };
  const lines = (body.message?.content ?? "")
    .split("\n")
    .map((line) => line.replace(/^\s*[-*\d.)\]]+\s*/, "").trim())
    .filter((line) => line.length > 0);

  if (lines.length < frames) {
    throw new ToolError(
      `The model described ${String(lines.length)} poses but ${String(frames)} were asked for. ` +
        `Try fewer frames, or a motion with more distinct stages.`,
    );
  }
  return lines.slice(0, frames);
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
  const form = new FormData();
  form.set("instruction", instruction);
  form.set("kind", kind);
  form.set("mode", mode);
  form.set(
    "source",
    new File([Uint8Array.from(source).buffer], "source.png", {
      type: "image/png",
    }),
  );
  if (mode === "inpaint" && mask === undefined) {
    throw new ToolError("Inpainting requires a PNG mask.");
  }
  if (mask !== undefined) {
    form.set(
      "mask",
      new File([Uint8Array.from(mask).buffer], "mask.png", {
        type: "image/png",
      }),
    );
  }

  let response: Response;
  try {
    response = await paid("derivation", (signal) =>
      fetch(`${API_BASE}/v1/derive`, { method: "POST", body: form, signal }),
    );
  } catch (error) {
    if (error instanceof ToolError) throw error;
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
