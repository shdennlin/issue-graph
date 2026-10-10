# 4. Refresh the Linear token in the browser

Status: Accepted — 2026-09-30

## Context

Write-back carries the caller's own Linear OAuth token, obtained by PKCE in the
browser and forwarded by the server without being stored. `lib/linearAuth.ts`
originally kept **only the access token**, discarding the refresh token Linear
returns beside it. Its reasoning, quoted from the code it justified:

> Keeping the refresh token here would turn a one-day exposure into a permanent
> one, which is a poor trade for saving a single click a day while the user's
> Linear session is already live.

Linear's access token lives 24 hours (`expires_in: 86399`). So that decision has
a price, and it is not "a single click a day" — it is a click a day *forever*,
paid at the moment the user is trying to do something else.

The cost was measured rather than argued. Reading `localStorage` on a live
deployment found `ig-linear-auth-v1` still present with
`expiresAt: 2026-09-22T08:54:26Z` against a clock reading `2026-09-30` — the key
was intact, so nothing had cleared it; it had simply lapsed **eight days
earlier** and the user had been looking at a "Connect your Linear account"
banner ever since. A daily re-auth is not a small tax on a tool people keep open
for weeks. It is a feature that switches itself off.

## Decision

Keep the rotating refresh token alongside the access token, and renew from the
browser.

The trade the original note describes is not the trade on offer:

- The refresh token **rotates on every use**, so it is not a static long-lived
  secret.
- It lives in **the same `localStorage`, on the same origin**, as the access
  token it renews. Anything that can read one can read the other. The blast
  radius does not grow; only the window does.
- Refreshing a **PKCE-generated** token needs no `client_secret`. That is the
  fact the whole design rests on — the alternative is a server-side exchange,
  and the server holding a caller's credential is the one thing `CLAUDE.md`
  forbids outright — so it was verified rather than read. Linear's own wording
  is ambiguous: `client_id` and `client_secret` carry the *identical*
  parenthetical, "required if not using HTTP basic authentication or refreshing
  a PKCE-generated token", which read literally demands the secret it elsewhere
  says to omit.

  Probing `api.linear.app/oauth/token` from the deployed origin settles it. With
  a deliberately invalid refresh token and **no** secret, the response is 401
  `invalid_client` / "Invalid refresh token" — identical with a real client id,
  a bogus one, or none at all, so Linear evaluates the refresh token first and
  never complains that a secret is missing. Add a *wrong* secret and the error
  changes to 400 `invalid_secret` / "Invalid secret", proving the secret is
  checked when present, and checked earlier. A required-but-absent secret would
  have surfaced the same way. It does not, so it is not required — and sending
  one anyway is worse than sending none.

  The same probe confirms CORS is open on both `/oauth/token` and
  `/oauth/revoke`, without which neither half of this could run in a browser.

Three pure functions carry the decisions, so they can be tested under vitest's
node environment while the `fetch` and the cross-tab lock stay thin:
`decideRefresh`, `mergeRefreshResponse`, `classifyRefreshFailure`.

`authHeader()` became **async**. That is the enforcement mechanism, not a side
effect: a future write path that writes `headers: authHeader()` without the
`await` puts a Promise where a record belongs and fails `tsc`, rather than
shipping a token that quietly lapses.

### What this obliges

**Disconnect must revoke, not forget.** While the stored credential died on its
own inside a day, clearing it locally was near enough to ending it. A rotating
refresh token has no such horizon, so `revokeAuth()` calls Linear's
`/oauth/revoke` for both tokens before dropping local state. Without this the
argument above does not hold, because "Disconnect" would leave a live credential
in existence.

## Consequences

- A connected user stops seeing the banner. The first renewal happens on app
  load, folded into `capabilityStore.load()`'s existing wait so the controls do
  not flash from locked to unlocked.
- `StoredAuth.refreshToken` and `.clientId` are **optional**. Entries written
  before this change still parse; they just cannot renew. Anyone holding one
  pays one more manual Connect and then never again.
- A failed refresh is classified, not assumed. A 4xx means the refresh token is
  dead and it is cleared (a spent one answers 401, which the probe above also
  showed); a 5xx, a rate limit or an offline laptop leaves it in place, because
  discarding it there would turn Linear's outage into a manual reconnect.
- **Preserving it obliges `authHeader()` to throw.** Keeping the credential
  through a transient failure is undone if the write then goes out without a
  bearer: the server answers 401 `unauthenticated`, and that is the one code
  `forgetTokenIfRejected` reacts to by clearing. The entry would be deleted
  milliseconds after being deliberately kept, and a Linear outage would read as
  "connect your account". So a renewable entry that could not be renewed raises
  `RefreshFailedError` (`code: 'refresh_failed'`) instead of degrading to no
  header. An entry with nothing to renew *with* still returns `{}` — there,
  reconnecting genuinely is the answer.
- Multiple tabs serialise on a `navigator.locks` request and **re-read storage
  inside the lock** — the rotated token may already have been spent by whoever
  held it first. Nothing may cache `StoredAuth` in memory; `readAuth()` re-reads
  raw storage on every call, and that is what makes rotation safe across tabs.

### Rejected alternative

**Keep discarding it, and soften the prompt** — a banner that warns before
expiry, or a one-click reconnect that skips the consent screen. This was the
status quo with better manners. It still interrupts the user daily, and the
interruption is the cost, not the number of clicks it takes to clear.

## Revisit when

- **Linear documents a refresh-token lifetime.** It currently does not state
  one, which is why "an eight-day-old entry is still renewable" is an
  expectation here and not a guarantee. If a lifetime exists and is short, the
  self-healing property this record is built on is weaker than claimed.
- **The app gains more than one origin per user in practice.** `localStorage` is
  per-origin and `ig-linear-auth-v1` is one key per browser, so a person
  alternating between the dev server and a deployment already authorises twice.
  That is latent today; if it becomes routine, the key needs scoping and this
  record needs a successor.
- **A second workspace becomes normal.** A Linear OAuth token belongs to one
  workspace installation, and the storage key does not record which. Today a
  mismatch surfaces as a failed write; with refresh it also means renewing a
  token for the wrong workspace. Scoping the key by workspace id is the fix, and
  it is deliberately not in this change.
