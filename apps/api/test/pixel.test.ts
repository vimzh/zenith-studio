import { describe, expect, test } from 'bun:test'
import {
  builtinPalette,
  createDocument,
  createStore,
  parseHex,
  serializeDocument,
} from '@zenith/core'
import app from '../src/index'

const ORIGIN = 'http://localhost:3000'

async function post(path: string, body: unknown): Promise<Response> {
  return await app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
    body: JSON.stringify(body),
  })
}

describe('health', () => {
  test('reports the document format it speaks', async () => {
    const response = await app.request('/health')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      ok: true,
      service: 'zenith-api',
      documentFormat: 'zenith.document',
      documentVersion: 1,
    })
  })
})

describe('CORS', () => {
  test('echoes an allowed origin', async () => {
    const response = await app.request('/health', { headers: { Origin: ORIGIN } })
    expect(response.headers.get('access-control-allow-origin')).toBe(ORIGIN)
  })

  test('refuses an origin that is not on the list', async () => {
    const response = await app.request('/health', { headers: { Origin: 'https://evil.example' } })
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
  })
})

describe('GET /v1/palettes', () => {
  test('serves the built-in hardware palettes', async () => {
    const response = await app.request('/v1/palettes')
    const body = (await response.json()) as { palettes: { id: string; colors: string[] }[] }
    const ids = body.palettes.map((palette) => palette.id)
    expect(ids).toContain('gb-dmg')
    expect(ids).toContain('pico-8')
    expect(body.palettes.find((palette) => palette.id === 'pico-8')?.colors).toHaveLength(16)
  })
})

describe('POST /v1/documents/validate', () => {
  test('accepts a valid document and returns it normalised', async () => {
    const store = createStore(createDocument({ name: 'cobble_01', width: 4, height: 4, palette: builtinPalette('gb-dmg') }))
    store.writeRegion(0, 0, '0123\n1230\n2301\n3012')

    const response = await post('/v1/documents/validate', { document: serializeDocument(store.snapshot()) })
    expect(response.status).toBe(200)

    const body = (await response.json()) as {
      valid: boolean
      summary: { width: number; frames: number; paletteSize: number; coverage: number }
      document: { frames: { layers: { grid: string }[] }[] }
    }
    expect(body.valid).toBe(true)
    expect(body.summary).toMatchObject({ width: 4, frames: 1, paletteSize: 4, coverage: 1 })
    expect(body.document.frames[0]?.layers[0]?.grid).toBe('0123\n1230\n2301\n3012')
  })

  test('accepts a bare document body as well as a wrapped one', async () => {
    const document = serializeDocument(createDocument({ width: 2, height: 2, palette: builtinPalette('gb-dmg') }))
    expect((await post('/v1/documents/validate', document)).status).toBe(200)
  })

  test('rejects an invariant violation with the invariant code', async () => {
    const document = serializeDocument(createDocument({ width: 2, height: 2, palette: builtinPalette('gb-dmg') })) as unknown as {
      frames: { layers: { grid: string }[] }[]
    }
    const tampered = JSON.parse(JSON.stringify(document)) as typeof document
    // Index 9 is a legal cell character, but gb-dmg only defines indices 0-3.
    ;(tampered.frames[0] as { layers: { grid: string }[] }).layers[0] = {
      ...((tampered.frames[0] as { layers: { grid: string }[] }).layers[0] as { grid: string }),
      grid: '9.\n..',
    }

    const response = await post('/v1/documents/validate', { document: tampered })
    expect(response.status).toBe(400)
    const body = (await response.json()) as { error: { code: string; message: string } }
    expect(body.error.code).toBe('invalid_index')
    expect(body.error.message).toContain('(0, 0)')
  })

  test('rejects a ragged grid', async () => {
    const document = JSON.parse(
      JSON.stringify(serializeDocument(createDocument({ width: 2, height: 2, palette: builtinPalette('gb-dmg') }))),
    ) as { frames: { layers: { grid: string }[] }[] }
    ;(document.frames[0] as { layers: { grid: string }[] }).layers[0] = {
      ...((document.frames[0] as { layers: { grid: string }[] }).layers[0] as { grid: string }),
      grid: '01\n0',
    }

    const response = await post('/v1/documents/validate', { document })
    expect(response.status).toBe(400)
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe('dimension_mismatch')
  })

  test('reports unparseable JSON as a client error', async () => {
    const response = await app.request('/v1/documents/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{ nope',
    })
    expect(response.status).toBe(400)
    expect(((await response.json()) as { error: { message: string } }).error.message).toContain('not valid JSON')
  })
})

describe('POST /v1/quantize', () => {
  /** A 4x4 image of four flat colours, two pixels of each pair per row. */
  function image(colors: readonly string[], width: number, height: number): string {
    const bytes = new Uint8Array(width * height * 4)
    for (let i = 0; i < width * height; i += 1) {
      const rgb = parseHex(colors[i % colors.length] as string)
      bytes[i * 4] = rgb.r
      bytes[i * 4 + 1] = rgb.g
      bytes[i * 4 + 2] = rgb.b
      bytes[i * 4 + 3] = 255
    }
    return Buffer.from(bytes).toString('base64')
  }

  test('returns a palette and an indexed grid the store can write directly', async () => {
    const response = await post('/v1/quantize', {
      pixels: image(['#0f380f', '#306230', '#8bac0f', '#9bbc0f'], 4, 4),
      width: 4,
      height: 4,
      maxColors: 4,
    })
    expect(response.status).toBe(200)

    const body = (await response.json()) as { palette: { colors: string[] }; grid: string; sourceColorCount: number }
    expect(body.palette.colors).toHaveLength(4)
    expect(body.sourceColorCount).toBe(4)
    expect(body.grid.split('\n')).toHaveLength(4)
    expect(body.grid.split('\n').every((row) => row.length === 4)).toBe(true)

    // The response round-trips into the same store the human is editing.
    const store = createStore(createDocument({ width: 4, height: 4, palette: body.palette.colors }))
    expect(store.writeRegion(0, 0, body.grid)).toBeGreaterThan(0)
    expect(store.encode()).toBe(body.grid)
  })

  test('reduces many colours to the 16-colour cap', async () => {
    const colors = Array.from({ length: 64 }, (_, i) => `#${(i * 4).toString(16).padStart(2, '0').repeat(3)}`)
    const response = await post('/v1/quantize', { pixels: image(colors, 8, 8), width: 8, height: 8 })
    const body = (await response.json()) as { palette: { colors: string[] }; sourceColorCount: number }
    expect(body.sourceColorCount).toBe(64)
    expect(body.palette.colors).toHaveLength(16)
  })

  test('rejects a buffer that does not match the stated size', async () => {
    const response = await post('/v1/quantize', { pixels: image(['#000000'], 4, 4), width: 8, height: 8 })
    expect(response.status).toBe(400)
    expect(((await response.json()) as { error: { message: string } }).error.message).toContain('256')
  })

  test('rejects a palette request over the cap', async () => {
    const response = await post('/v1/quantize', { pixels: image(['#000000'], 2, 2), width: 2, height: 2, maxColors: 32 })
    expect(response.status).toBe(400)
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe('palette_overflow')
  })

  test('rejects missing dimensions', async () => {
    const response = await post('/v1/quantize', { pixels: image(['#000000'], 2, 2) })
    expect(response.status).toBe(400)
    expect(((await response.json()) as { error: { message: string } }).error.message).toContain('width must be a positive integer')
  })
})

describe('unknown routes', () => {
  test('return a structured 404', async () => {
    const response = await app.request('/v1/nope')
    expect(response.status).toBe(404)
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe('not_found')
  })
})
