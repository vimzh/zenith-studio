import { describe, expect, test } from 'bun:test'
import { DEFAULT_WEB_ORIGIN, originMatcher, parseAllowedOrigins } from '../src/lib/cors'

describe('allowed origins', () => {
  test('defaults to the local frontend', () => {
    expect(parseAllowedOrigins(undefined)).toEqual([DEFAULT_WEB_ORIGIN])
  })

  /**
   * The case a single-string implementation gets wrong, and that development
   * never exercises because there is only ever one origin locally.
   */
  test('accepts a comma-separated list', () => {
    expect(parseAllowedOrigins('https://zenith.vercel.app,https://preview.vercel.app')).toEqual([
      'https://zenith.vercel.app',
      'https://preview.vercel.app',
    ])
  })

  test('tolerates padding and empty entries', () => {
    expect(parseAllowedOrigins(' https://a.example , , https://b.example ')).toEqual([
      'https://a.example',
      'https://b.example',
    ])
  })

  /** A misconfigured allowlist allows nothing, rather than falling back to a useless default. */
  test('fails closed when the variable is explicitly blank', () => {
    expect(parseAllowedOrigins('')).toEqual([])
    expect(originMatcher(parseAllowedOrigins(''))('https://zenith.vercel.app')).toBeNull()
  })
})

describe('origin matcher', () => {
  const match = originMatcher(['https://zenith.vercel.app', 'https://preview.vercel.app'])

  test('echoes an allowed origin rather than the whole list', () => {
    expect(match('https://zenith.vercel.app')).toBe('https://zenith.vercel.app')
    expect(match('https://preview.vercel.app')).toBe('https://preview.vercel.app')
  })

  test('refuses anything else, including near-misses', () => {
    expect(match('https://evil.example')).toBeNull()
    expect(match('https://zenith.vercel.app.evil.example')).toBeNull()
    expect(match('http://zenith.vercel.app')).toBeNull()
    expect(match('*')).toBeNull()
    expect(match('')).toBeNull()
  })
})
