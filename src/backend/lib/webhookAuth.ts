// Authenticating an inbound Linear webhook.
//
// This is the one route that is reachable from the public internet (via a
// Tailscale Funnel path mount), and the rest of the app has no auth at all —
// see the warning block in README.md. So the guarantee here is not "probably
// Linear": it is that a request with no valid HMAC never reaches any code that
// touches the cache.
//
// Linear signs the *raw* request body with a shared secret and sends the hex
// digest in `Linear-Signature`. The body must therefore be read as text and
// verified before any JSON parsing — a re-serialized object will not match.

import { createHmac, timingSafeEqual } from 'node:crypto'

const HEX_64 = /^[0-9a-f]{64}$/i

/** Replay window, matching Linear's documented guidance. */
export const TIMESTAMP_TOLERANCE_MS = 60_000

/**
 * Constant-time check that `headerSignature` is the HMAC-SHA256 of `rawBody`
 * under `secret`.
 *
 * Never throws. `timingSafeEqual` throws when the two buffers differ in
 * length, so anything malformed — absent header, wrong length, odd-length or
 * non-hex string — is screened out first and reported as a plain false. A
 * thrown error would become a 500, which tells whoever is probing that their
 * input was structurally more interesting than the ones that got a 401.
 */
export function verifyLinearSignature(
  rawBody: string,
  headerSignature: string | undefined | null,
  secret: string,
): boolean {
  if (!secret) return false
  if (typeof headerSignature !== 'string' || !HEX_64.test(headerSignature)) return false

  const expected = createHmac('sha256', secret).update(rawBody).digest()
  const received = Buffer.from(headerSignature, 'hex')
  // HEX_64 already fixes the length at 32 bytes; belt-and-braces so a future
  // change to the pattern cannot reintroduce the throw.
  if (received.length !== expected.length) return false
  return timingSafeEqual(expected, received)
}

/**
 * True when `webhookTimestamp` (epoch ms, from the payload) is within the
 * replay window of `now`. Both directions are bounded: a clock ahead of ours
 * is as suspicious as one behind, and rejecting only the past would let a
 * captured request be replayed indefinitely by a sender whose clock drifts
 * forward.
 */
export function isFreshTimestamp(
  webhookTimestamp: unknown,
  now: number,
  toleranceMs: number = TIMESTAMP_TOLERANCE_MS,
): boolean {
  if (typeof webhookTimestamp !== 'number' || !Number.isFinite(webhookTimestamp)) return false
  return Math.abs(now - webhookTimestamp) <= toleranceMs
}
