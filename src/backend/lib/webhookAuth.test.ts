import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { isFreshTimestamp, verifyLinearSignature } from './webhookAuth.js'

const SECRET = 'lin_wh_testsecret'
const BODY = JSON.stringify({ action: 'update', type: 'Issue' })

function sign(body: string, secret = SECRET): string {
  return createHmac('sha256', secret).update(body).digest('hex')
}

describe('verifyLinearSignature', () => {
  it('accepts a signature computed over the exact raw body', () => {
    expect(verifyLinearSignature(BODY, sign(BODY), SECRET)).toBe(true)
  })

  it('rejects a body altered after signing', () => {
    expect(verifyLinearSignature(`${BODY} `, sign(BODY), SECRET)).toBe(false)
  })

  it('rejects a signature made with a different secret', () => {
    expect(verifyLinearSignature(BODY, sign(BODY, 'other'), SECRET)).toBe(false)
  })

  // timingSafeEqual throws on length mismatch, so every malformed input has to
  // be screened before it gets there — a throw here would surface as a 500 and
  // tell an attacker their probe was structurally interesting.
  it('returns false rather than throwing on a missing header', () => {
    expect(verifyLinearSignature(BODY, undefined, SECRET)).toBe(false)
    expect(verifyLinearSignature(BODY, '', SECRET)).toBe(false)
  })

  it('returns false rather than throwing on a too-short signature', () => {
    expect(verifyLinearSignature(BODY, 'abcd', SECRET)).toBe(false)
  })

  it('returns false rather than throwing on odd-length hex', () => {
    expect(verifyLinearSignature(BODY, sign(BODY).slice(0, 63), SECRET)).toBe(false)
  })

  it('returns false rather than throwing on non-hex characters', () => {
    expect(verifyLinearSignature(BODY, 'z'.repeat(64), SECRET)).toBe(false)
  })

  it('returns false when no secret is configured', () => {
    expect(verifyLinearSignature(BODY, sign(BODY), '')).toBe(false)
  })
})

describe('isFreshTimestamp', () => {
  const NOW = 1_755_670_000_000

  it('accepts a timestamp at the current time', () => {
    expect(isFreshTimestamp(NOW, NOW)).toBe(true)
  })

  it('accepts a timestamp just inside the tolerance either way', () => {
    expect(isFreshTimestamp(NOW - 59_000, NOW)).toBe(true)
    expect(isFreshTimestamp(NOW + 59_000, NOW)).toBe(true)
  })

  it('rejects a replayed timestamp older than the tolerance', () => {
    expect(isFreshTimestamp(NOW - 61_000, NOW)).toBe(false)
  })

  it('rejects a timestamp too far in the future', () => {
    expect(isFreshTimestamp(NOW + 61_000, NOW)).toBe(false)
  })

  it('rejects anything that is not a finite number', () => {
    expect(isFreshTimestamp(undefined, NOW)).toBe(false)
    expect(isFreshTimestamp(null, NOW)).toBe(false)
    expect(isFreshTimestamp('1755670000000', NOW)).toBe(false)
    expect(isFreshTimestamp(NaN, NOW)).toBe(false)
    expect(isFreshTimestamp(Infinity, NOW)).toBe(false)
  })
})
