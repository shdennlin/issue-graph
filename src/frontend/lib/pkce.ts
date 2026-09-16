// PKCE (RFC 7636) for the Linear OAuth flow.
//
// Split out from linearAuth.ts and kept free of `window` on purpose: WebCrypto
// is a *global* in Node, not a DOM API, so this is one of the few modules under
// src/frontend/ that vitest can actually exercise (see vitest.config.ts — every
// suite runs `environment: 'node'`). Anything here that reached for
// `location` or `sessionStorage` would give that up.
//
// Why PKCE at all: it lets a browser complete an OAuth exchange with no client
// secret. The verifier never leaves this origin; only its SHA-256 hash rides on
// the authorize redirect, so intercepting that redirect yields nothing that can
// be exchanged for a token.

/** RFC 7636 §4.1: 43-128 chars of [A-Za-z0-9-._~]. base64url of 32 random bytes
 *  lands on exactly 43, the minimum, which is also the recommended length. */
const VERIFIER_BYTES = 32

/**
 * base64url without padding — the only encoding RFC 7636 accepts, and *not*
 * what `btoa` produces: `+` and `/` are invalid in a query parameter and `=`
 * would be re-encoded by URLSearchParams into `%3D`, breaking the comparison
 * Linear does against the stored challenge.
 */
export function base64Url(bytes: Uint8Array): string {
  // Built one char at a time rather than String.fromCharCode(...bytes): the
  // spread form is a stack overflow waiting for a larger input, and this is a
  // general helper.
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** A fresh code verifier. Cryptographic randomness only — `Math.random` is
 *  predictable enough to defeat the entire point of PKCE. */
export function randomVerifier(): string {
  const bytes = new Uint8Array(VERIFIER_BYTES)
  crypto.getRandomValues(bytes)
  return base64Url(bytes)
}

/** The S256 challenge derived from a verifier. Async because `subtle.digest`
 *  is; callers are already crossing a redirect boundary, so it costs nothing. */
export async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return base64Url(new Uint8Array(digest))
}

/** The CSRF nonce for the `state` round trip. Same generator as the verifier —
 *  it needs the same unguessability, and there is no reason to have two. */
export function randomNonce(): string {
  return randomVerifier()
}
