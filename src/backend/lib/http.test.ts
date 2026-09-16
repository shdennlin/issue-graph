import { describe, expect, it } from 'vitest'
import type { Context } from 'hono'
import { bearerToken, originAllowed } from './http.js'

/** Only `c.req.header(name)` is reached, so the rest of Context is not worth
 *  constructing. Same shape as the header stubs in savedViews.test.ts. */
function ctx(headers: Record<string, string>): Context {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]))
  return { req: { header: (name: string) => lower[name.toLowerCase()] } } as unknown as Context
}

describe('originAllowed', () => {
  it('allows a same-origin request', () => {
    expect(originAllowed(ctx({ origin: 'http://localhost:31415', host: 'localhost:31415' }))).toBe(true)
  })

  // The CSRF case this exists for: a page on another site posting at a local
  // instance the user's browser can reach.
  it('rejects a cross-origin request', () => {
    expect(originAllowed(ctx({ origin: 'http://evil.com', host: 'localhost:31415' }))).toBe(false)
  })

  // Deliberate: curl and same-origin form posts send no Origin. This is a CSRF
  // guard against *browsers*, not an authentication check — that is what the
  // caller's token is for.
  it('allows a request with no Origin at all', () => {
    expect(originAllowed(ctx({ host: 'localhost:31415' }))).toBe(true)
  })

  it('compares host including port, not just hostname', () => {
    expect(originAllowed(ctx({ origin: 'http://localhost:31414', host: 'localhost:31415' }))).toBe(false)
  })

  // The scheme is not part of `host`, so an https page talking to the same
  // host:port passes. That is intended — a reverse proxy terminating TLS
  // forwards the original Host, and rejecting it would break every such deploy.
  it('ignores the scheme', () => {
    expect(originAllowed(ctx({ origin: 'https://app.example.com', host: 'app.example.com' }))).toBe(true)
  })

  it('rejects an unparseable Origin rather than throwing', () => {
    expect(originAllowed(ctx({ origin: 'not a url', host: 'localhost:31415' }))).toBe(false)
  })

  it('rejects when there is an Origin but no Host to compare it against', () => {
    expect(originAllowed(ctx({ origin: 'http://localhost:31415' }))).toBe(false)
  })
})

describe('bearerToken', () => {
  it('strips the scheme', () => {
    expect(bearerToken('Bearer lin_oauth_abc')).toBe('lin_oauth_abc')
  })

  it('accepts the scheme in any case, as RFC 7235 requires', () => {
    expect(bearerToken('bearer abc')).toBe('abc')
    expect(bearerToken('BEARER abc')).toBe('abc')
  })

  it('tolerates extra whitespace', () => {
    expect(bearerToken('Bearer    abc  ')).toBe('abc')
  })

  // Not everything arrives with the scheme; a raw credential is still a
  // credential, and rejecting it would be a gratuitous difference from the
  // Linear API itself, which accepts personal keys bare.
  it('passes through a bare credential', () => {
    expect(bearerToken('lin_api_abc')).toBe('lin_api_abc')
  })

  // The reason this is not an inline `.replace` at the call site: an empty
  // credential forwarded to Linear turns a clear local 401 into a confusing
  // remote one.
  it('returns empty for a scheme with nothing after it', () => {
    expect(bearerToken('Bearer')).toBe('')
    expect(bearerToken('Bearer ')).toBe('')
  })

  it('returns empty for a missing header', () => {
    expect(bearerToken(undefined)).toBe('')
    expect(bearerToken(null)).toBe('')
    expect(bearerToken('')).toBe('')
  })
})
