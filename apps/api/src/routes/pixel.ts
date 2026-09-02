/**
 * The phase 01 document model, served.
 *
 * These endpoints wrap `@zenith/core` and add nothing: the browser holds the
 * authoritative store, so the server's job here is to answer questions about the
 * same model with the same code — which is also what proves the core runs
 * unchanged on both sides.
 */

import {
  BUILTIN_PALETTES,
  MAX_PALETTE_SIZE,
  PixelError,
  createPalette,
  deserializeDocument,
  encodeGrid,
  frameStats,
  quantize,
  serializeDocument,
  type Palette,
} from '@zenith/core'
import { Hono } from 'hono'
import { fromJson, requireRecord } from '../lib/http'

/** Roughly a 1024x1024 RGBA image once base64-decoded. */
const MAX_IMAGE_BYTES = 4 * 1024 * 1024

export const pixel = new Hono()

/** Built-in hardware palettes. Community palettes are fetched client-side with attribution, never bundled. */
pixel.get('/v1/palettes', (c) =>
  c.json({
    palettes: Object.values(BUILTIN_PALETTES).map((palette: Palette) => ({
      id: palette.id,
      name: palette.name,
      colors: palette.colors.map((color) => color.hex),
    })),
  }),
)

/**
 * Validates a serialised document against the five invariants.
 *
 * Returns the normalised document, so a caller can use the response as the
 * canonical form rather than trusting what it sent.
 */
pixel.post('/v1/documents/validate', async (c) => {
  const body = requireRecord(await fromJson(c), 'Request body')
  const document = deserializeDocument(body['document'] ?? body)
  const stats = frameStats(document, 0)

  return c.json({
    valid: true,
    document: serializeDocument(document),
    summary: {
      width: document.width,
      height: document.height,
      frames: document.frames.length,
      layers: document.frames[0]?.layers.length ?? 0,
      paletteSize: document.palette.colors.length,
      coverage: Number(stats.coverage.toFixed(4)),
      opaquePixels: stats.opaque,
    },
  })
})

/**
 * Reduces an RGBA image to an indexed grid on a palette of at most 16 colours.
 *
 * The response is the indexed text format, so the caller can hand it straight to
 * `writeRegion` without a second conversion step.
 */
pixel.post('/v1/quantize', async (c) => {
  const body = requireRecord(await fromJson(c), 'Request body')

  const width = readPositiveInteger(body['width'], 'width')
  const height = readPositiveInteger(body['height'], 'height')
  const maxColors = body['maxColors'] === undefined ? MAX_PALETTE_SIZE : readPositiveInteger(body['maxColors'], 'maxColors')
  const seed = body['seed'] === undefined ? undefined : readPositiveInteger(body['seed'], 'seed')

  const encoded = body['pixels']
  if (typeof encoded !== 'string') {
    throw new PixelError('invalid_argument', 'pixels must be a base64-encoded RGBA buffer, four bytes per pixel.')
  }
  const bytes = decodeBase64(encoded)
  if (bytes.length > MAX_IMAGE_BYTES) {
    throw new PixelError(
      'invalid_argument',
      `Image is ${String(bytes.length)} bytes, over the ${String(MAX_IMAGE_BYTES)} byte limit. Downscale before sending.`,
    )
  }
  if (bytes.length !== width * height * 4) {
    throw new PixelError(
      'invalid_argument',
      `pixels holds ${String(bytes.length)} bytes but ${String(width)}x${String(height)} RGBA needs ${String(width * height * 4)}.`,
    )
  }

  const result = quantize(new Uint8ClampedArray(bytes), seed === undefined ? { maxColors } : { maxColors, seed })
  const palette = createPalette({ id: 'quantized', name: 'Quantized', colors: result.colors })

  return c.json({
    palette: { id: palette.id, name: palette.name, colors: palette.colors.map((color) => color.hex) },
    grid: encodeGrid({ width, height, cells: result.indices }),
    sourceColorCount: result.sourceColorCount,
    meanError: Number(result.meanError.toFixed(6)),
  })
})

function readPositiveInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new PixelError('invalid_argument', `${label} must be a positive integer, received ${JSON.stringify(value)}.`)
  }
  return value
}

function decodeBase64(value: string): Uint8Array {
  try {
    return Uint8Array.from(Buffer.from(value, 'base64'))
  } catch {
    throw new PixelError('invalid_argument', 'pixels is not valid base64.')
  }
}
