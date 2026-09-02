import { PixelError } from "@zenith/core";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export interface ErrorBody {
  readonly error: {
    readonly code: string;
    readonly message: string;
  };
}

/**
 * Turns a thrown error into the same shape the WebMCP tool layer returns.
 *
 * A `PixelError` is a rejected request, not a server fault: it already says what
 * was wrong and what to do instead, so it goes back verbatim with a 400.
 */
export function toErrorResponse(error: unknown): { status: ContentfulStatusCode; body: ErrorBody } {
  if (error instanceof PixelError) {
    return { status: 400, body: { error: { code: error.code, message: error.message } } };
  }
  return {
    status: 500,
    body: {
      error: {
        code: "internal_error",
        message: error instanceof Error ? error.message : "Unexpected server error.",
      },
    },
  };
}

export function fromJson(context: Context): Promise<unknown> {
  return context.req.json().catch(() => {
    throw new PixelError("invalid_document", "Request body is not valid JSON.");
  });
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new PixelError("invalid_argument", `${label} must be a JSON object.`);
  }
  return value;
}
