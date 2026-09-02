import { Hono } from 'hono'
import OpenAI from 'openai'
import { chatLimiter, limitVerdict, limitedBody } from '../lib/limits'

/**
 * The chat relay.
 *
 * Deliberately stateless and deliberately ignorant of the canvas. The browser
 * owns the conversation and executes every tool call locally against the store,
 * because that is the whole architecture: the tools operate on the live document
 * the human is looking at, and a server that touched pixels would be a second
 * source of truth for them.
 *
 * So this endpoint does exactly two things the browser cannot: it holds the API
 * key, and it meters spend. Messages and tool schemas go in, an assistant
 * message or a set of tool calls comes out, and the browser decides what happens
 * next.
 */

const DEFAULT_MODEL = 'gpt-5'
/** A conversation carrying grids grows fast; this bounds one request's cost. */
const MAX_MESSAGES = 60
const MAX_BODY_CHARS = 400_000

export interface ChatRequestBody {
  messages: unknown
  tools?: unknown
  model?: string
}

function badRequest(message: string) {
  return { error: { code: 'invalid_argument', message } } as const
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Validates shape only, not semantics.
 *
 * The message and tool schemas are the OpenAI wire format, and re-deriving that
 * here would be a second definition to keep in sync. What matters is that the
 * body is the right kind of thing and is not unbounded.
 */
function validate(body: ChatRequestBody): string | null {
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return '"messages" must be a non-empty array.'
  }
  if (body.messages.length > MAX_MESSAGES) {
    return `"messages" holds ${String(body.messages.length)} entries; the cap is ${String(MAX_MESSAGES)}. Summarise or trim the conversation.`
  }
  if (!body.messages.every((message) => isRecord(message) && typeof message['role'] === 'string')) {
    return 'Every message must be an object with a "role".'
  }
  if (body.tools !== undefined && !Array.isArray(body.tools)) {
    return '"tools" must be an array of tool definitions.'
  }
  if (body.model !== undefined && typeof body.model !== 'string') {
    return '"model" must be a string.'
  }
  return null
}

export function createChatRoute(): Hono {
  const app = new Hono()

  app.post('/', async (c) => {
    const verdict = limitVerdict(chatLimiter, c.req.raw.headers)
    if (!verdict.allowed) {
      c.header('Retry-After', String(verdict.retryAfterSeconds))
      return c.json(limitedBody(verdict), 429)
    }

    const raw = await c.req.text()
    if (raw.length > MAX_BODY_CHARS) {
      return c.json(
        badRequest(`Request body is ${String(raw.length)} characters; the cap is ${String(MAX_BODY_CHARS)}.`),
        400,
      )
    }

    let body: ChatRequestBody
    try {
      body = JSON.parse(raw) as ChatRequestBody
    } catch {
      return c.json(badRequest('Request body must be JSON.'), 400)
    }

    const invalid = validate(body)
    if (invalid !== null) return c.json(badRequest(invalid), 400)

    const key = process.env.OPENAI_API_KEY
    if (!key) {
      return c.json(
        {
          error: {
            code: 'chat_unconfigured',
            message:
              'Chat is not configured: OPENAI_API_KEY is not set on the server. The editor and every deterministic tool are unaffected.',
          },
        },
        503,
      )
    }

    try {
      const openai = new OpenAI({ apiKey: key })
      const completion = await openai.chat.completions.create({
        model: body.model ?? process.env.OPENAI_CHAT_MODEL ?? DEFAULT_MODEL,
        messages: body.messages as never,
        ...(Array.isArray(body.tools) && body.tools.length > 0
          ? { tools: body.tools as never, tool_choice: 'auto' as const }
          : {}),
      })

      const choice = completion.choices[0]
      if (choice === undefined) {
        return c.json({ error: { code: 'upstream_error', message: 'The model returned no choices.' } }, 502)
      }

      return c.json({
        message: choice.message,
        finishReason: choice.finish_reason,
        model: completion.model,
        usage: completion.usage ?? null,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return c.json({ error: { code: 'upstream_error', message: `Chat failed: ${message}` } }, 502)
    }
  })

  return app
}
