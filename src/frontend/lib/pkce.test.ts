import { describe, expect, it } from 'vitest'
import { base64Url, challengeFor, randomNonce, randomVerifier } from './pkce'

describe('base64Url', () => {
  // The three characters that make plain base64 unusable in a query string.
  it('emits none of +, / or =', () => {
    // 0xfb 0xff produces "+/8=" in standard base64 — all three in four chars.
    const out = base64Url(new Uint8Array([0xfb, 0xff, 0xfe]))
    expect(out).not.toMatch(/[+/=]/)
  })

  it('substitutes - and _ rather than dropping the bytes', () => {
    expect(base64Url(new Uint8Array([0xfb, 0xff, 0xfe]))).toBe('-__-')
  })

  it('strips padding instead of encoding it', () => {
    expect(base64Url(new Uint8Array([1]))).toBe('AQ')
  })

  it('handles an empty input', () => {
    expect(base64Url(new Uint8Array([]))).toBe('')
  })
})

describe('randomVerifier', () => {
  // RFC 7636 §4.1. Too short and Linear rejects the authorize request; the
  // failure surfaces as a redirect back with an error, not as a local throw.
  it('is within the 43-128 character range', () => {
    const v = randomVerifier()
    expect(v.length).toBeGreaterThanOrEqual(43)
    expect(v.length).toBeLessThanOrEqual(128)
  })

  it('uses only the unreserved characters the RFC allows', () => {
    expect(randomVerifier()).toMatch(/^[A-Za-z0-9\-._~]+$/)
  })

  it('does not repeat itself', () => {
    const seen = new Set(Array.from({ length: 50 }, () => randomVerifier()))
    expect(seen.size).toBe(50)
  })
})

describe('challengeFor', () => {
  // RFC 7636 Appendix B, the canonical S256 vector. If this passes, the digest
  // and the encoding are both right; a hand-rolled check of either alone can
  // pass while the pair is wrong.
  it('matches the RFC 7636 Appendix B vector', async () => {
    const challenge = await challengeFor('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')
    expect(challenge).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
  })

  it('is deterministic for a given verifier', async () => {
    const v = randomVerifier()
    expect(await challengeFor(v)).toBe(await challengeFor(v))
  })

  it('differs for different verifiers', async () => {
    expect(await challengeFor('a'.repeat(43))).not.toBe(await challengeFor('b'.repeat(43)))
  })

  it('is itself query-safe', async () => {
    expect(await challengeFor(randomVerifier())).not.toMatch(/[+/=]/)
  })
})

describe('randomNonce', () => {
  it('is unguessable and unique, like the verifier', () => {
    const seen = new Set(Array.from({ length: 50 }, () => randomNonce()))
    expect(seen.size).toBe(50)
    expect(randomNonce().length).toBeGreaterThanOrEqual(43)
  })
})
