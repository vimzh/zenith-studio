import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { health } from './routes/health'
import { pixel } from './routes/pixel'
import { createChatRoute } from './routes/chat'
import { createDeriveRoute, createGenerateRoute } from './routes/generate'
import { originMatcher, parseAllowedOrigins } from './lib/cors'
import { toErrorResponse } from './lib/http'

const app = new Hono()

/**
 * CORS is locked to the deployed frontend, not `*`.
 *
 * This service holds the OpenAI key; a wildcard origin would let any page spend
 * it. `WEB_ORIGIN` is a comma-separated list because a Vercel project serves
 * production and preview deployments from different origins.
 */
const allowedOrigins = parseAllowedOrigins(process.env.WEB_ORIGIN)

app.use(
  '/*',
  cors({
    origin: originMatcher(allowedOrigins),
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type'],
    // Preflight is cacheable for a day; generation is already slow enough.
    maxAge: 86400,
  }),
)

app.get('/', (c) => c.text('Zenith Studio API'))

app.route('/', health)
app.route('/', pixel)
app.route('/v1/generate', createGenerateRoute())
app.route('/v1/chat', createChatRoute())
app.route('/v1/derive', createDeriveRoute())

/**
 * Every thrown error leaves as the same structured body.
 *
 * A `PixelError` already names what was wrong and what to do instead — that
 * text goes to agents verbatim through the WebMCP tool layer, so it must not be
 * flattened into a generic 500.
 */
app.onError((error, c) => {
  const { status, body } = toErrorResponse(error)
  return c.json(body, status)
})

/** Unknown routes answer in the same error shape as everything else. */
app.notFound((c) =>
  c.json({ error: { code: 'not_found', message: `No route for ${c.req.method} ${c.req.path}.` } }, 404),
)

export default app
