// Shared HTTP helpers for route modules.

import type { Context } from 'hono'
import { loadConfig } from './env.js'

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

/**
 * Constant-time-ish comparison. Not a defence against a remote timing attack —
 * network jitter swamps the signal at this scale — but it costs nothing and
 * avoids the reflex of writing `a === b` for a secret, which is the habit worth
 * not having.
 */
function tokenMatches(presented: string, expected: string): boolean {
  if (presented.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < presented.length; i++) diff |= presented.charCodeAt(i) ^ expected.charCodeAt(i)
  return diff === 0
}

/**
 * Does this request carry the agent shared secret?
 *
 * Used by the routes the Claude Code plugin calls, which are not browsers and
 * send no Origin, so `originAllowed` cannot speak for them.
 *
 * AN UNSET AGENT_SESSION_TOKEN RETURNS FALSE — unset means closed, not open.
 * These routes are meant to be reachable from outside an app that has no auth
 * by design, so a deployment without the variable must not quietly accept
 * writes from anywhere.
 */
export function agentTokenValid(header: string | undefined): boolean {
  const expected = loadConfig().AGENT_SESSION_TOKEN
  if (!expected) return false
  const presented = header?.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : ''
  if (presented.length === 0) return false
  return tokenMatches(presented, expected)
}
