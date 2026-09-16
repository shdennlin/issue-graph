import { describe, expect, it } from 'vitest'
import { consumeCallback, resolveCallback, type PendingAuth } from './linearAuth'

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
