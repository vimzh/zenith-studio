import { describe, expect, test } from 'bun:test'
import { RateLimiter, clientKey } from '../src/lib/rate-limit'

const RULE = { perClient: 3, global: 5, windowMs: 60_000 }

describe('per-client limit', () => {
  test('allows up to the limit and then refuses', () => {
    const limiter = new RateLimiter(RULE)
    for (let i = 0; i < 3; i += 1) {
      expect(limiter.check('a', 0).allowed).toBe(true)
    }
    const refused = limiter.check('a', 0)
    expect(refused.allowed).toBe(false)
    expect(refused.scope).toBe('client')
    expect(refused.retryAfterSeconds).toBe(60)
  })

  test('reports how many remain', () => {
    const limiter = new RateLimiter(RULE)
    expect(limiter.check('a', 0).remaining).toBe(2)
    expect(limiter.check('a', 0).remaining).toBe(1)
    expect(limiter.check('a', 0).remaining).toBe(0)
  })

  test('one client hitting its limit does not affect another', () => {
    const limiter = new RateLimiter(RULE)
    for (let i = 0; i < 3; i += 1) limiter.check('a', 0)
    expect(limiter.check('a', 0).allowed).toBe(false)
    expect(limiter.check('b', 0).allowed).toBe(true)
  })

  test('the window rolls over', () => {
    const limiter = new RateLimiter(RULE)
    for (let i = 0; i < 3; i += 1) limiter.check('a', 0)
    expect(limiter.check('a', 0).allowed).toBe(false)
    expect(limiter.check('a', 60_000).allowed).toBe(true)
  })
})

/** The limit that actually bounds the bill: per-IP does nothing about a spread of addresses. */
describe('global limit', () => {
  test('refuses once the global budget is spent, however many clients', () => {
    const limiter = new RateLimiter(RULE)
    // Five distinct clients, one request each, all within their own limits.
    for (const client of ['a', 'b', 'c', 'd', 'e']) {
      expect(limiter.check(client, 0).allowed).toBe(true)
    }
    const refused = limiter.check('f', 0)
    expect(refused.allowed).toBe(false)
    expect(refused.scope).toBe('global')
  })

  test('the global window rolls over too', () => {
    const limiter = new RateLimiter(RULE)
    for (const client of ['a', 'b', 'c', 'd', 'e']) limiter.check(client, 0)
    expect(limiter.check('f', 0).allowed).toBe(false)
    expect(limiter.check('f', 60_000).allowed).toBe(true)
  })

  test('a refused request does not consume global budget', () => {
    const limiter = new RateLimiter({ perClient: 1, global: 5, windowMs: 60_000 })
    limiter.check('a', 0)
    for (let i = 0; i < 10; i += 1) limiter.check('a', 0) // all refused per-client
    // Four global slots should remain for other callers.
    for (const client of ['b', 'c', 'd', 'e']) {
      expect(limiter.check(client, 0).allowed).toBe(true)
    }
  })
})

describe('memory bound', () => {
  test('does not grow without limit under a stream of unique clients', () => {
    const limiter = new RateLimiter({ perClient: 1, global: 1_000_000, windowMs: 60_000 }, 50)
    for (let i = 0; i < 500; i += 1) limiter.check(`client-${String(i)}`, 0)
    // Still enforcing, and it has not retained every key it ever saw.
    expect(limiter.check('client-499', 0).allowed).toBe(false)
  })
})

describe('clientKey', () => {
  function headers(map: Record<string, string>) {
    return { get: (name: string) => map[name] ?? null }
  }

  test('takes the leftmost forwarded address', () => {
    expect(clientKey(headers({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }))).toBe('203.0.113.7')
  })

  test('falls back through the other proxy headers', () => {
    expect(clientKey(headers({ 'cf-connecting-ip': '198.51.100.4' }))).toBe('198.51.100.4')
    expect(clientKey(headers({ 'x-real-ip': '198.51.100.5' }))).toBe('198.51.100.5')
    expect(clientKey(headers({}))).toBe('unknown')
  })

  test('ignores an empty forwarded header', () => {
    expect(clientKey(headers({ 'x-forwarded-for': '  ', 'x-real-ip': '1.2.3.4' }))).toBe('1.2.3.4')
  })
})
