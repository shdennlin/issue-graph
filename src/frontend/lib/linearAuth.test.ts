import { describe, expect, it } from 'vitest'
import {
  classifyRefreshFailure,
  consumeCallback,
  decideRefresh,
  mergeRefreshResponse,
  resolveCallback,
  type PendingAuth,
  type StoredAuth,
} from './linearAuth'

function stash(over: Partial<PendingAuth> = {}): string {
  return JSON.stringify({
    verifier: 'v'.repeat(43),
    nonce: 'n'.repeat(43),
    clientId: 'client-abc',
    returnTo: '?w=team_a&view=project&state=started,unstarted',
    ...over,
  } satisfies PendingAuth)
}

describe('resolveCallback', () => {
  it('accepts a callback whose state matches the stored nonce', () => {
    const out = resolveCallback(stash(), 'n'.repeat(43))
    expect(out.ok).toBe(true)
    expect(out.ok && out.verifier).toBe('v'.repeat(43))
  })

  // The CSRF check. A code delivered with someone else's state was not started
  // by this tab and must not be exchanged.
  it('rejects a mismatched state', () => {
    const out = resolveCallback(stash(), 'somebody-elses-nonce')
    expect(out).toMatchObject({ ok: false, reason: 'state_mismatch' })
  })

  it('rejects a missing state rather than treating it as a match', () => {
    expect(resolveCallback(stash(), null)).toMatchObject({ ok: false, reason: 'state_mismatch' })
  })

  it('rejects when nothing was stashed — a callback we never started', () => {
    expect(resolveCallback(null, 'n'.repeat(43))).toMatchObject({ ok: false, reason: 'no_pending' })
  })

  it('treats an unparseable stash as no pending flow instead of throwing', () => {
    expect(resolveCallback('{not json', 'n')).toMatchObject({ ok: false, reason: 'no_pending' })
  })

  it('rejects a stash with no verifier, which could not be exchanged anyway', () => {
    expect(resolveCallback(JSON.stringify({ nonce: 'n' }), 'n')).toMatchObject({
      ok: false,
      reason: 'no_pending',
    })
  })

  // The second landmine: parseUrl applies the URL wholesale, so returning to a
  // bare `/?code=…` would reset filters, focus and view to defaults. The stashed
  // query is what prevents that.
  it('restores the pre-redirect query on success', () => {
    const out = resolveCallback(stash(), 'n'.repeat(43))
    expect(out.returnTo).toBe('?w=team_a&view=project&state=started,unstarted')
  })

  // A rejected callback is still a navigation the user did not ask for. Losing
  // their view on top of losing the authorisation would be two failures.
  it('restores the query even when the state check fails', () => {
    expect(resolveCallback(stash(), 'wrong').returnTo).toBe(
      '?w=team_a&view=project&state=started,unstarted',
    )
  })

  it('falls back to a bare query when there is nothing to restore', () => {
    expect(resolveCallback(stash({ returnTo: '' }), 'n'.repeat(43)).returnTo).toBe('')
    expect(resolveCallback(null, 'n').returnTo).toBe('')
  })

  // The restored query legitimately contains `state=` — the state-type filter.
  // It is a different `state` from OAuth's, and it survives precisely because
  // the arrival URL is discarded rather than merged.
  it('keeps the filter `state` param, which is not the OAuth one', () => {
    const out = resolveCallback(stash(), 'n'.repeat(43))
    expect(new URLSearchParams(out.returnTo).get('state')).toBe('started,unstarted')
  })
})

describe('resolveCallback client id', () => {
  // Carried through the redirect: the exchange has to use the id the code was
  // issued for, and at callback time /api/settings has not resolved yet.
  it('returns the client id the flow was started with', () => {
    const out = resolveCallback(stash(), 'n'.repeat(43))
    expect(out.ok && out.clientId).toBe('client-abc')
  })

  // Old stash shape, or a flow started before this field existed. An empty id
  // fails the exchange with Linear's own error rather than throwing here.
  it('tolerates a stash with no client id', () => {
    const out = resolveCallback(stash({ clientId: undefined as unknown as string }), 'n'.repeat(43))
    expect(out.ok && out.clientId).toBe('')
  })
})

// consumeCallback reaches sessionStorage, which the node test environment does
// not have — the guarded read returns null there, which is exactly the
// "callback we never started" path. That makes the one behaviour worth pinning
// testable: a rejection must be *reported*, not swallowed into a null exchange
// that leaves the caller unable to tell success from failure.
describe('consumeCallback', () => {
  it('reports why it rejected rather than returning a bare null exchange', () => {
    const out = consumeCallback('some-code', 'some-state')
    expect(out.exchange).toBeNull()
    expect(out.rejected).toBe('no_pending')
  })
})

// ---------------------------------------------------------------------------
// Refresh. The decision, the merge and the failure classification are pure so
// they can be tested in node — the fetch and the cross-tab lock around them
// cannot, and are kept correspondingly thin.
// ---------------------------------------------------------------------------

const HOUR = 3600_000
const NOW = 1_700_000_000_000

function auth(over: Partial<StoredAuth> = {}): StoredAuth {
  return {
    token: 'access-token',
    expiresAt: NOW + 20 * HOUR,
    refreshToken: 'refresh-token',
    clientId: 'client-abc',
    ...over,
  }
}

describe('decideRefresh', () => {
  it('leaves a token with hours left alone', () => {
    expect(decideRefresh(auth(), NOW)).toBe('fresh')
  })

  // The skew exists so a write started 30 seconds before expiry does not race
  // the clock and land as a 401 the user has to retry by hand.
  it('renews inside the skew window, before the token actually lapses', () => {
    expect(decideRefresh(auth({ expiresAt: NOW + 60_000 }), NOW)).toBe('stale')
  })

  // A long-lived refresh token outlives the access token by design, so an
  // expired entry is renewable — this is the case that makes a tab left open
  // over a weekend heal itself instead of demanding a reconnect.
  it('renews a token that already expired, rather than giving up on it', () => {
    expect(decideRefresh(auth({ expiresAt: NOW - 8 * 24 * HOUR }), NOW)).toBe('stale')
  })

  // Entries written before refresh existed. They cannot be renewed, but while
  // they are still valid there is nothing to do about that.
  it('reports an unexpired entry with no refresh token as fresh, not broken', () => {
    expect(decideRefresh(auth({ refreshToken: undefined }), NOW)).toBe('fresh')
  })

  it('reports an EXPIRED entry with no refresh token as unrefreshable', () => {
    expect(decideRefresh(auth({ refreshToken: undefined, expiresAt: NOW - HOUR }), NOW)).toBe(
      'unrefreshable',
    )
  })

  // The exchange must use the id the token was issued for. Without it we would
  // be guessing, and a wrong id fails the refresh in a way that looks like a
  // dead token.
  it('cannot renew without the client id the token was issued for', () => {
    expect(decideRefresh(auth({ clientId: undefined, expiresAt: NOW - HOUR }), NOW)).toBe(
      'unrefreshable',
    )
  })

  it('has nothing to decide when there is no stored auth at all', () => {
    expect(decideRefresh(null, NOW)).toBe('unrefreshable')
  })
})

describe('mergeRefreshResponse', () => {
  it('takes the new access token and dates it from now', () => {
    const next = mergeRefreshResponse(auth(), { access_token: 'new-access', expires_in: 86399 }, NOW)
    expect(next?.token).toBe('new-access')
    expect(next?.expiresAt).toBe(NOW + 86399_000)
  })

  // Linear rotates the refresh token on every use. Storing the new one is the
  // whole reason this merge exists rather than a field assignment.
  it('stores the rotated refresh token', () => {
    const next = mergeRefreshResponse(
      auth(),
      { access_token: 'a', expires_in: 10, refresh_token: 'rotated' },
      NOW,
    )
    expect(next?.refreshToken).toBe('rotated')
  })

  // Dropping to an entry that cannot refresh would cost the user a manual
  // reconnect a day later, for a response that never asked us to.
  it('keeps the previous refresh token when the response omits one', () => {
    const next = mergeRefreshResponse(auth(), { access_token: 'a', expires_in: 10 }, NOW)
    expect(next?.refreshToken).toBe('refresh-token')
  })

  it('carries the client id forward so the NEXT refresh can run too', () => {
    const next = mergeRefreshResponse(auth(), { access_token: 'a', expires_in: 10 }, NOW)
    expect(next?.clientId).toBe('client-abc')
  })

  it('refuses a response with no access token rather than storing a blank one', () => {
    expect(mergeRefreshResponse(auth(), { expires_in: 10 }, NOW)).toBeNull()
  })
})

describe('classifyRefreshFailure', () => {
  // invalid_grant: the refresh token is dead. Keeping it means every app load
  // fires a request that cannot ever succeed.
  it('treats a 400 as the refresh token being rejected', () => {
    expect(classifyRefreshFailure(400)).toBe('rejected')
  })

  it('treats a 401 as rejected', () => {
    expect(classifyRefreshFailure(401)).toBe('rejected')
  })

  // A 5xx or an offline laptop says nothing about the token. Discarding it here
  // would turn Linear's bad afternoon into the user reconnecting by hand.
  it('treats a 500 as transient, leaving the token in place', () => {
    expect(classifyRefreshFailure(500)).toBe('transient')
  })

  it('treats a rate limit as transient', () => {
    expect(classifyRefreshFailure(429)).toBe('transient')
  })

  it('treats a network failure — no status at all — as transient', () => {
    expect(classifyRefreshFailure(null)).toBe('transient')
  })
})
