/**
 * Spend protection for the endpoints that call a paid model.
 *
 * This service holds an OpenAI key and sits behind a deliberately login-free
 * public URL, so nothing but this stands between a stranger and the bill. A chat
 * loop makes it worse than it sounds: one user message can produce several model
 * calls as the agent reads the canvas, edits, and re-checks its work.
 *
 * Two limits, because they stop different things:
 *
 *  - **Per-client**, keyed on the forwarded IP, stops one caller hammering it.
 *  - **Global**, across all callers, is the one that actually bounds the bill.
 *    A per-IP limit does nothing about a spread of addresses, and the cost of
 *    being wrong here is money rather than latency.
 *
 * In-memory and therefore per-instance: with `min-instances: 1` and hackathon
 * traffic that is the right trade, but the global cap is per instance, so N
 * instances allow N budgets. Documented rather than hidden.
 */

export interface RateLimitRule {
  /** Requests allowed per window, per client. */
  readonly perClient: number;
  /** Requests allowed per window across every client. */
  readonly global: number;
  readonly windowMs: number;
}

export interface RateLimitVerdict {
  readonly allowed: boolean;
  /** Which limit refused, for the message and for logs. */
  readonly scope?: "client" | "global";
  /** Whole seconds until the caller may retry. */
  readonly retryAfterSeconds: number;
  readonly remaining: number;
}

interface Window {
  count: number;
  resetAt: number;
}

function hit(window: Window | undefined, now: number, windowMs: number): Window {
  if (window === undefined || now >= window.resetAt) {
    return { count: 0, resetAt: now + windowMs };
  }
  return window;
}

export class RateLimiter {
  readonly #rule: RateLimitRule;
  readonly #clients = new Map<string, Window>();
  #global: Window | undefined;
  /** Bounds memory: a stream of unique IPs must not grow the map without limit. */
  readonly #maxClients: number;

  constructor(rule: RateLimitRule, maxClients = 10_000) {
    this.#rule = rule;
    this.#maxClients = maxClients;
  }

  /** Records a request and says whether it may proceed. */
  check(client: string, now: number = Date.now()): RateLimitVerdict {
    const global = hit(this.#global, now, this.#rule.windowMs);
    if (global.count >= this.#rule.global) {
      this.#global = global;
      return {
        allowed: false,
        scope: "global",
        retryAfterSeconds: Math.max(1, Math.ceil((global.resetAt - now) / 1000)),
        remaining: 0,
      };
    }

    const existing = this.#clients.get(client);
    const window = hit(existing, now, this.#rule.windowMs);
    if (window.count >= this.#rule.perClient) {
      this.#clients.set(client, window);
      this.#global = global;
      return {
        allowed: false,
        scope: "client",
        retryAfterSeconds: Math.max(1, Math.ceil((window.resetAt - now) / 1000)),
        remaining: 0,
      };
    }

    window.count += 1;
    global.count += 1;
    this.#global = global;

    if (!this.#clients.has(client)) this.#evictIfFull(now);
    this.#clients.set(client, window);

    return {
      allowed: true,
      retryAfterSeconds: 0,
      remaining: this.#rule.perClient - window.count,
    };
  }

  /** Drops expired windows, then the oldest, so the map cannot grow unbounded. */
  #evictIfFull(now: number): void {
    if (this.#clients.size < this.#maxClients) return;
    for (const [key, window] of this.#clients) {
      if (now >= window.resetAt) this.#clients.delete(key);
    }
    while (this.#clients.size >= this.#maxClients) {
      const oldest = this.#clients.keys().next();
      if (oldest.done === true) break;
      this.#clients.delete(oldest.value);
    }
  }
}

/**
 * Identifies the caller.
 *
 * Cloud Run appends the client address to `x-forwarded-for`, and the leftmost
 * entry is the closest thing to a real client we get. It is spoofable, which is
 * exactly why the global cap exists alongside it.
 */
export function clientKey(headers: { get: (name: string) => string | null }): string {
  const forwarded = headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  if (first !== undefined && first.length > 0) return first;
  return headers.get("cf-connecting-ip") ?? headers.get("x-real-ip") ?? "unknown";
}
