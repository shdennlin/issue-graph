// Shared HTTP helpers for route modules.

import type { Context } from 'hono'

/**
 * Same-origin check used as lightweight CSRF protection for mutating
 * endpoints. Requests without an Origin header (same-origin form posts,
 * curl) are allowed; cross-origin browsers are rejected.
 */
export function originAllowed(c: Context): boolean {
  const origin = c.req.header('origin')
  const host = c.req.header('host')
  if (!origin) return true
  try {
    const u = new URL(origin)
    return u.host === host
  } catch {
    return false
  }
}

/**
 * The credential presented on a write, or '' when there isn't a usable one.
 *
 * The server does not validate what comes back — Linear does, when the token is
 * used. This only establishes that *something* was presented, so a request with
 * no credential fails locally as 401 instead of travelling to Linear to be told
 * the same thing. A bare `Bearer` with nothing after it returns '' for exactly
 * that reason: forwarding an empty credential turns a clear 401 into a confusing
 * one.
 *
 * Pure (string in, string out) so it is unit-testable — this module must never
 * reach `bun:sqlite`, which no test can resolve.
 */
export function bearerToken(authorizationHeader: string | undefined | null): string {
  if (typeof authorizationHeader !== 'string') return ''
  // `\b\s*` rather than `\s+`: with the latter a bare "Bearer" does not match
  // the scheme at all and is returned as though it were the credential, which
  // is how an empty header reaches Linear looking like a real one.
  return authorizationHeader.replace(/^Bearer\b\s*/i, '').trim()
}
