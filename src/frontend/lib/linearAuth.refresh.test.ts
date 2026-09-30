// @vitest-environment happy-dom
//
// The impure half of the refresh: storage plus fetch. Its own file rather than
// an addition to linearAuth.test.ts, because that suite's `consumeCallback`
// test depends on node's *missing* sessionStorage to exercise the "callback we
// never started" path — the pragma above would silently delete that coverage.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RefreshFailedError, authHeader, readAuth, type StoredAuth } from './linearAuth'

const AUTH_KEY = 'ig-linear-auth-v1'
const HOUR = 3600_000

function seed(over: Partial<StoredAuth> = {}): void {
  const auth: StoredAuth = {
    token: 'old-access',
    expiresAt: Date.now() - HOUR, // expired, but renewable
    refreshToken: 'refresh-token',
    clientId: 'client-abc',
    ...over,
  }
  localStorage.setItem(AUTH_KEY, JSON.stringify(auth))
}

beforeEach(() => localStorage.clear())
afterEach(() => vi.unstubAllGlobals())

describe('authHeader when the token is expired but renewable', () => {
  it('renews and returns the NEW token', async () => {
    seed()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({ access_token: 'fresh-access', expires_in: 86399, refresh_token: 'rotated' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    )
    expect(await authHeader()).toEqual({ Authorization: 'Bearer fresh-access' })
    expect(readAuth()?.refreshToken).toBe('rotated')
  })

  // The hole this file exists for. A 5xx says nothing about the credential, so
  // performRefresh keeps it — but returning `{}` here sends a write with no
  // bearer, the server answers 401 `unauthenticated`, and the write store's
  // forgetTokenIfRejected then deletes the very entry we just preserved. The
  // user is told to reconnect because Linear had a bad minute.
  it('throws rather than sending an unauthenticated write when renewal fails transiently', async () => {
    seed()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })))
    await expect(authHeader()).rejects.toBeInstanceOf(RefreshFailedError)
  })

  it('keeps the credential across a transient failure', async () => {
    seed()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })))
    await expect(authHeader()).rejects.toThrow()
    expect(readAuth()?.refreshToken).toBe('refresh-token')
  })

  // A 4xx IS about the credential — invalid_grant. Keeping it would fire a
  // doomed request on every app load forever.
  it('discards the credential when Linear rejects the refresh token outright', async () => {
    seed()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"invalid_grant"}', { status: 401 })))
    expect(await authHeader()).toEqual({})
    expect(readAuth()).toBeNull()
  })
})

describe('authHeader in the cases that are not a renewal failure', () => {
  // Still inside its life: no renewal, no network call, no throw.
  it('returns the stored token untouched when it has hours left', async () => {
    seed({ expiresAt: Date.now() + 20 * HOUR })
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    expect(await authHeader()).toEqual({ Authorization: 'Bearer old-access' })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  // An entry from before refresh existed, now lapsed. There is nothing to
  // renew, so this genuinely IS "connect your account" — `{}`, not a throw.
  it('returns no header, without throwing, for an expired entry it cannot renew', async () => {
    seed({ refreshToken: undefined, clientId: undefined })
    expect(await authHeader()).toEqual({})
  })

  it('returns no header when nothing is stored at all', async () => {
    expect(await authHeader()).toEqual({})
  })
})
