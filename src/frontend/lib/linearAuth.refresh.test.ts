// @vitest-environment happy-dom
//
// The impure half of the refresh: storage plus fetch. Its own file rather than
// an addition to linearAuth.test.ts, because that suite's `consumeCallback`
// test depends on node's *missing* sessionStorage to exercise the "callback we
// never started" path — the pragma above would silently delete that coverage.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  RefreshFailedError,
  authHeader,
  authKey,
  clearAuth,
  dropLegacyAuth,
  readAuth,
  type StoredAuth,
} from './linearAuth'

const WS = 'team_a'
const HOUR = 3600_000

function seed(over: Partial<StoredAuth> = {}, workspaceId = WS): void {
  const auth: StoredAuth = {
    token: 'old-access',
    expiresAt: Date.now() - HOUR, // expired, but renewable
    refreshToken: 'refresh-token',
    clientId: 'client-abc',
    ...over,
  }
  localStorage.setItem(authKey(workspaceId), JSON.stringify(auth))
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
    expect(await authHeader(WS)).toEqual({ Authorization: 'Bearer fresh-access' })
    expect(readAuth(WS)?.refreshToken).toBe('rotated')
  })

  // The hole this file exists for. A 5xx says nothing about the credential, so
  // performRefresh keeps it — but returning `{}` here sends a write with no
  // bearer, the server answers 401 `unauthenticated`, and the write store's
  // forgetTokenIfRejected then deletes the very entry we just preserved. The
  // user is told to reconnect because Linear had a bad minute.
  it('throws rather than sending an unauthenticated write when renewal fails transiently', async () => {
    seed()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })))
    await expect(authHeader(WS)).rejects.toBeInstanceOf(RefreshFailedError)
  })

  it('keeps the credential across a transient failure', async () => {
    seed()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })))
    await expect(authHeader(WS)).rejects.toThrow()
    expect(readAuth(WS)?.refreshToken).toBe('refresh-token')
  })

  // A 4xx IS about the credential — invalid_grant. Keeping it would fire a
  // doomed request on every app load forever.
  it('discards the credential when Linear rejects the refresh token outright', async () => {
    seed()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"invalid_grant"}', { status: 401 })))
    expect(await authHeader(WS)).toEqual({})
    expect(readAuth(WS)).toBeNull()
  })
})

describe('authHeader in the cases that are not a renewal failure', () => {
  // Still inside its life: no renewal, no network call, no throw.
  it('returns the stored token untouched when it has hours left', async () => {
    seed({ expiresAt: Date.now() + 20 * HOUR })
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    expect(await authHeader(WS)).toEqual({ Authorization: 'Bearer old-access' })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  // An entry from before refresh existed, now lapsed. There is nothing to
  // renew, so this genuinely IS "connect your account" — `{}`, not a throw.
  it('returns no header, without throwing, for an expired entry it cannot renew', async () => {
    seed({ refreshToken: undefined, clientId: undefined })
    expect(await authHeader(WS)).toEqual({})
  })

  it('returns no header when nothing is stored at all', async () => {
    expect(await authHeader(WS)).toEqual({})
  })
})

describe('workspace scoping', () => {
  it('derives a per-workspace key in the house format', () => {
    expect(authKey('team_a')).toBe('ig-linear-auth-v2:team_a')
  })

  // The defect this exists for: A's token must never be sent for B.
  it('returns no header in a workspace that has not been connected', async () => {
    seed({ expiresAt: Date.now() + 20 * HOUR }, 'team_a')
    vi.stubGlobal('fetch', vi.fn())
    expect(await authHeader('team_b')).toEqual({})
  })

  it('renews one workspace without touching another', async () => {
    seed({}, 'team_a')
    seed({ token: 'b-access', expiresAt: Date.now() + 20 * HOUR, refreshToken: 'b-refresh' }, 'team_b')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ access_token: 'a-fresh', expires_in: 86399, refresh_token: 'a-rotated' }), {
          status: 200,
        }),
      ),
    )
    await authHeader('team_a')
    expect(readAuth('team_a')?.token).toBe('a-fresh')
    expect(readAuth('team_b')).toMatchObject({ token: 'b-access', refreshToken: 'b-refresh' })
  })

  it('clears only the workspace it is told to', () => {
    seed({}, 'team_a')
    seed({}, 'team_b')
    clearAuth('team_b')
    expect(readAuth('team_a')).not.toBeNull()
    expect(readAuth('team_b')).toBeNull()
  })
})

describe('dropLegacyAuth', () => {
  const V1 = 'ig-linear-auth-v1'

  // v1 cannot be migrated: it never recorded which workspace it was for, and
  // guessing is the defect. It is removed; the user connects once per workspace.
  it('removes the unscoped entry', async () => {
    localStorage.setItem(V1, JSON.stringify({ token: 't', expiresAt: 0 }))
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 200 })))
    await dropLegacyAuth()
    expect(localStorage.getItem(V1)).toBeNull()
  })

  // A v1 entry written by the refresh commit holds a long-lived refresh token.
  // Deleting it locally without revoking would leave a live credential behind.
  it('revokes a legacy refresh token before forgetting it', async () => {
    localStorage.setItem(V1, JSON.stringify({ token: 't', expiresAt: 0, refreshToken: 'r', clientId: 'c' }))
    const fetchSpy = vi.fn(async (_url: string, _init?: RequestInit) => new Response('', { status: 200 }))
    vi.stubGlobal('fetch', fetchSpy)
    await dropLegacyAuth()
    const bodies = fetchSpy.mock.calls.map(([, init]) => String(init?.body))
    expect(bodies.some((b) => new URLSearchParams(b).get('token') === 'r')).toBe(true)
  })

  it('does nothing when there is no legacy entry', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    await dropLegacyAuth()
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
