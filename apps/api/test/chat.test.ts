import { describe, expect, test } from 'bun:test'
import app from '../src/index'

async function post(body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return await app.request('/v1/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

async function errorOf(response: Response): Promise<{ code: string; message: string }> {
  return ((await response.json()) as { error: { code: string; message: string } }).error
}

const HELLO = { messages: [{ role: 'user', content: 'hello' }] }

describe('POST /v1/chat', () => {
  test('rejects a body that is not JSON', async () => {
    const response = await app.request('/v1/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{ nope',
    })
    expect(response.status).toBe(400)
    expect((await errorOf(response)).message).toContain('JSON')
  })

  test('requires a non-empty messages array', async () => {
    expect((await errorOf(await post({}))).message).toContain('non-empty array')
    expect((await errorOf(await post({ messages: [] }))).message).toContain('non-empty array')
  })

  test('requires every message to have a role', async () => {
    const error = await errorOf(await post({ messages: [{ content: 'no role' }] }))
    expect(error.message).toContain('"role"')
  })

  /** A conversation carrying indexed grids grows fast; unbounded history is unbounded cost. */
  test('caps conversation length rather than relaying it', async () => {
    const messages = Array.from({ length: 61 }, () => ({ role: 'user', content: 'x' }))
    const error = await errorOf(await post({ messages }))
    expect(error.message).toContain('cap is 60')
  })

  test('rejects tools that are not an array', async () => {
    expect((await errorOf(await post({ ...HELLO, tools: {} }))).message).toContain('"tools"')
  })

  test('rejects a non-string model', async () => {
    expect((await errorOf(await post({ ...HELLO, model: 5 }))).message).toContain('"model"')
  })

  test('reports an unconfigured key with a distinguishable code', async () => {
    const response = await post(HELLO)
    expect(response.status).toBe(503)
    const error = await errorOf(response)
    expect(error.code).toBe('chat_unconfigured')
    // Says what still works, so the client can degrade rather than break.
    expect(error.message).toContain('deterministic tool')
  })
})

/** The limit that bounds the bill. A chat loop calls this many times per user message. */
describe('rate limiting', () => {
  test('refuses past the per-client budget with Retry-After', async () => {
    const ip = `203.0.113.${String(Math.floor(Math.random() * 200) + 1)}`
    let limited: Response | null = null

    for (let i = 0; i < 70; i += 1) {
      const response = await post(HELLO, { 'x-forwarded-for': ip })
      if (response.status === 429) {
        limited = response
        break
      }
    }

    expect(limited).not.toBeNull()
    const response = limited as Response
    expect(response.headers.get('Retry-After')).toMatch(/^\d+$/)
    const error = await errorOf(response)
    expect(error.code).toBe('rate_limited')
    expect(error.message).toContain('Try again in')
  })
})
