import { RateLimiter, clientKey, type RateLimitVerdict } from './rate-limit'
import type { ErrorBody } from './http'

/**
 * The budgets for the endpoints that spend money.
 *
 * Chosen for a judged demo, not production: generous enough that nobody trying
 * the app in good faith hits them, tight enough that a public URL cannot run up
 * a bill overnight. Override per deployment when the traffic shape is known.
 */
function budget(name: string, perClient: number, global: number, windowMs: number): RateLimiter {
  const read = (suffix: string, fallback: number): number => {
    const raw = process.env[`RATE_LIMIT_${name}_${suffix}`]
    const parsed = raw === undefined ? Number.NaN : Number.parseInt(raw, 10)
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
  }
  return new RateLimiter({
    perClient: read('PER_CLIENT', perClient),
    global: read('GLOBAL', global),
    windowMs: read('WINDOW_MS', windowMs),
  })
}

const HOUR = 60 * 60 * 1000

/** Image generation: slow, and the most expensive call per request. */
export const generateLimiter = budget('GENERATE', 10, 60, HOUR)

/**
 * Chat: cheaper per call but called far more often — one user message can drive
 * several model turns as the agent reads, edits and re-checks.
 */
export const chatLimiter = budget('CHAT', 60, 400, HOUR)

export function limitVerdict(
  limiter: RateLimiter,
  headers: { get: (name: string) => string | null },
): RateLimitVerdict {
  return limiter.check(clientKey(headers))
}

export function limitedBody(verdict: RateLimitVerdict): ErrorBody {
  const message =
    verdict.scope === 'global'
      ? `This deployment has reached its shared usage budget. Try again in ${String(verdict.retryAfterSeconds)}s.`
      : `Too many requests. Try again in ${String(verdict.retryAfterSeconds)}s.`
  return { error: { code: 'rate_limited', message } }
}
