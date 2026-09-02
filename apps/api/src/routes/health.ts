import { Hono } from 'hono'
import { DOCUMENT_FORMAT, DOCUMENT_VERSION } from '@zenith/core'

export const health = new Hono()

health.get('/health', (c) =>
  c.json({
    ok: true,
    service: 'zenith-api',
    documentFormat: DOCUMENT_FORMAT,
    documentVersion: DOCUMENT_VERSION,
  }),
)
