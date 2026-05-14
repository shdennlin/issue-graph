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
