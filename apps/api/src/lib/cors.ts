/**
 * Which browser origins may call this service.
 *
 * A list, not a single value: a Vercel project serves production and preview
 * deployments from different origins, and both need to reach the API. `*` is
 * never an option — this service holds the OpenAI key, and a wildcard origin
 * lets any page on the internet spend it.
 *
 * Extracted and tested because the shape of `WEB_ORIGIN` is not self-evident
 * from `index.ts`, and collapsing the list back to one string is a silent
 * failure: it still works in development, where there is only ever one origin.
 */

export const DEFAULT_WEB_ORIGIN = 'http://localhost:3000';

/**
 * Splits the comma-separated `WEB_ORIGIN` into origins, ignoring blanks and padding.
 *
 * An explicitly empty `WEB_ORIGIN` yields an empty list, which allows nothing.
 * That is deliberate: a misconfigured allowlist should fail closed and be
 * obvious at integration time, not fall back to a localhost origin that no
 * deployed frontend will ever match.
 */
export function parseAllowedOrigins(value: string | undefined): readonly string[] {
  return (value ?? DEFAULT_WEB_ORIGIN)
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

/**
 * The matcher Hono's `cors({ origin })` takes.
 *
 * Returns the request's own origin when allowed, so the response echoes it
 * rather than advertising the whole list, and `null` otherwise.
 */
export function originMatcher(allowed: readonly string[]): (origin: string) => string | null {
  return (origin: string) => (allowed.includes(origin) ? origin : null);
}
