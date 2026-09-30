// Per-user Linear authorisation: the whole OAuth 2.0 + PKCE flow, and the token
// it produces.
//
// This replaced a shared secret pasted into every browser, which could answer
// "may someone write" but never "who wrote this" — every change reached Linear
// as the owner of the workspace's API key. Here each person authorises Linear
// directly, so Linear itself answers both questions and attributes the change
// to them (`actor=user` is the default for OAuth tokens; no parameter needed).
//
// Deliberately does NOT import ./api: api.ts imports *this* module for the
// Authorization header, so the dependency has to run one way. That is also the
// correct shape on its own terms — api.ts talks to our backend, while the token
// exchange talks to api.linear.app directly, with no server in between.
//
// The token lives in this browser and is sent on write requests, which the
// server forwards to Linear without storing. Nothing about it is persisted
// server-side, by design: there is no token store to breach.

import { challengeFor, randomNonce, randomVerifier } from './pkce'

/** Thrown when the page is not a secure context, so `crypto.subtle` — and
 *  therefore the PKCE challenge — does not exist. */
export class InsecureContextError extends Error {}

const AUTHORIZE_URL = 'https://linear.app/oauth/authorize'

/** The exchange runs from the browser because PKCE removes the need for a
 *  client secret. If Linear turns out to require one anyway, this is the single
 *  line that moves: point it at our own `/api/oauth/exchange`, which adds the
 *  secret server-side and returns the same JSON. Nothing else here changes. */
const TOKEN_URL = 'https://api.linear.app/oauth/token'

/**
 * `read` alongside `write` because a write-only token's ability to resolve an
 * issue by id before mutating it is undocumented — a failure that could not be
 * reproduced in tests. Someone granting write access to their own Linear is not
 * surprised by read.
 */
const SCOPES = 'read,write'

const PENDING_KEY = 'ig-linear-pkce-v1'

/**
 * One slot per issue-graph workspace.
 *
 * A Linear OAuth token belongs to ONE workspace installation — Linear's docs
 * say to store the installation id alongside the token for exactly this
 * reason. A single browser-wide slot sent workspace A's token for workspace B's
 * writes and, once refresh existed, dutifully renewed it there. Same
 * `prefix:<workspaceId>` shape as `ig-notify-log`. `v2` because v1 was
 * unscoped; see `dropLegacyAuth`.
 *
 * Every export below that touches the slot takes the workspace as a REQUIRED
 * parameter rather than reading a store: this module must not import stores
 * (see the header), and a required parameter makes a forgotten call site a type
 * error instead of a token sent to the wrong organisation.
 */
export function authKey(workspaceId: string): string {
  return `ig-linear-auth-v2:${workspaceId}`
}

export interface PendingAuth {
  verifier: string
  nonce: string
  /** Carried through the redirect rather than re-read from /api/settings on
   *  return. Two reasons: the callback is consumed at the top of parseUrl,
   *  before the settings fetch has resolved, so there would be nothing to read;
   *  and the exchange must use the id the code was *issued* for, which a server
   *  reconfigured mid-flow would no longer report. A client id is public, so
   *  there is nothing to protect by keeping it out of the stash. */
  clientId: string
  /** The app's query string from before the redirect, restored on return so
   *  the round trip does not cost the user their filters, focus and view. */
  returnTo: string
  /** The workspace whose Connect started this flow. The code Linear returns is
   *  for the installation that workspace points at, so the token is stored
   *  there — not under whatever `?w=` the tab shows on return. */
  workspaceId: string
}

export interface StoredAuth {
  token: string
  /** Epoch ms. Recorded so the UI can say "expired, reconnect" instead of
   *  surfacing a bare 401 from a write the user thought would work. */
  expiresAt: number
  /**
   * Linear's rotating refresh token. **Optional**, and that is a migration
   * story rather than a nicety: entries written before this existed hold an
   * access token and nothing else, and must keep parsing. They simply cannot
   * be renewed — one more manual Connect and the next entry can.
   */
  refreshToken?: string
  /**
   * The client id this token was issued for. Stored for the same reason
   * `PendingAuth` carries one: a refresh must present the id the credential
   * belongs to, and a server reconfigured since would report a different one.
   * Reading it back from /api/settings would also make this module depend on
   * ./api, which the header explains it must not.
   */
  clientId?: string
}

/**
 * Renew this long before the access token actually lapses.
 *
 * Without a margin, a write begun a few seconds before expiry arrives at Linear
 * after it — a 401 on an action the user had every reason to think would work.
 */
const REFRESH_SKEW_MS = 5 * 60_000

export type RefreshDecision = 'fresh' | 'stale' | 'unrefreshable'

/**
 * Whether the stored credential needs renewing, can be renewed at all, or is
 * fine as it stands. Pure, and separated from the fetch because this is the
 * part with edge cases.
 *
 * Note that an *expired* entry is 'stale', not a lost cause: Linear's refresh
 * token outlives the 24h access token, so a tab left over a weekend heals
 * itself. Only an entry with nothing to refresh *with* is unrefreshable.
 */
export function decideRefresh(auth: StoredAuth | null, now: number): RefreshDecision {
  if (!auth) return 'unrefreshable'
  const renewable = Boolean(auth.refreshToken && auth.clientId)
  if (auth.expiresAt - now > REFRESH_SKEW_MS) return 'fresh'
  // Past the skew line. Renewable entries get renewed; the rest are only
  // reportable as broken once they have actually lapsed — until then there is
  // a usable token and nothing to be done about its lack of a successor.
  if (renewable) return 'stale'
  return auth.expiresAt > now ? 'fresh' : 'unrefreshable'
}

/** The shape Linear's token endpoint returns, for both grant types. */
export interface TokenResponse {
  access_token?: string
  expires_in?: number
  refresh_token?: string
}

/**
 * Fold a refresh response into the entry it renews, or null when the response
 * carried no access token and there is nothing to store.
 *
 * The `?? prev.refreshToken` is load-bearing. Linear rotates the refresh token
 * on every use and documents returning a new one, but a response that omits it
 * must leave the old one in place — overwriting with undefined would silently
 * demote the entry to one that can never refresh again.
 */
export function mergeRefreshResponse(
  prev: StoredAuth,
  json: TokenResponse,
  now: number,
): StoredAuth | null {
  if (!json.access_token) return null
  const ttl = typeof json.expires_in === 'number' && json.expires_in > 0 ? json.expires_in : 0
  return {
    token: json.access_token,
    expiresAt: now + ttl * 1000,
    refreshToken: json.refresh_token ?? prev.refreshToken,
    clientId: prev.clientId,
  }
}

/**
 * Whether a failed refresh means the token is dead or merely that this attempt
 * did not land.
 *
 * The distinction decides whether we throw the credential away. A 4xx is
 * `invalid_grant` — keeping it means every app load fires a request that can
 * never succeed. A 5xx, a rate limit or an offline laptop says nothing about
 * the token, and discarding it there turns Linear's bad afternoon into the user
 * reconnecting by hand.
 */
export function classifyRefreshFailure(status: number | null): 'transient' | 'rejected' {
  if (status === 400 || status === 401 || status === 403) return 'rejected'
  return 'transient'
}

/** sessionStorage/localStorage are absent under vitest's node environment and
 *  can throw outright in a Safari private window. Same guarded shape as
 *  lib/preferences.ts. */
function readRaw(store: 'session' | 'local', key: string): string | null {
  if (typeof window === 'undefined') return null
  try {
    const s = store === 'session' ? window.sessionStorage : window.localStorage
    return s?.getItem(key) ?? null
  } catch {
    return null
  }
}

function writeRaw(store: 'session' | 'local', key: string, value: string | null): void {
  if (typeof window === 'undefined') return
  try {
    const s = store === 'session' ? window.sessionStorage : window.localStorage
    if (value === null) s?.removeItem(key)
    else s?.setItem(key, value)
  } catch {
    /* quota or private mode — dropped, the same as preferences */
  }
}

/**
 * The redirect URI, derived rather than configured.
 *
 * Linear matches it byte-for-byte against the app's registered list, and this
 * app is served from more origins than one config value could hold: Vite on
 * :31414 under `bun run dev`, the backend on :31415 for a built or Docker run,
 * plus whatever tailnet or proxy host a deployment uses. Deriving it means the
 * deployer registers each origin they browse from and configures nothing.
 *
 * `/?code=…` rather than a path like `/oauth/callback`: with SERVE_STATIC=false
 * the backend registers no SPA fallback, so a real path 404s in dev, and the
 * service worker's navigateFallbackDenylist does not exclude it either.
 */
export function redirectUri(): string {
  return `${window.location.origin}/`
}

// ---------------------------------------------------------------------------
// Starting the flow
// ---------------------------------------------------------------------------

/**
 * Stash the PKCE state and hand the browser to Linear. Never returns in
 * practice — `location.assign` navigates away.
 */
export async function beginAuth(clientId: string, workspaceId: string): Promise<void> {
  // WebCrypto's SubtleCrypto is only exposed in a secure context, so PKCE is
  // impossible over plain http to a LAN or tailnet IP — a documented way to run
  // this app, and the same constraint that costs it offline support there.
  // Named explicitly because the alternative is a bare TypeError surfacing as
  // "check your client id", which sends the reader after the wrong thing.
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new InsecureContextError(
      'Connecting Linear needs a secure context (https, or localhost).',
    )
  }
  const verifier = randomVerifier()
  const pending: PendingAuth = {
    verifier,
    nonce: randomNonce(),
    clientId,
    returnTo: window.location.search,
    workspaceId,
  }
  // Stashed before navigating, and in sessionStorage rather than localStorage:
  // the verifier is single-use material for one redirect in one tab, and an
  // abandoned flow should not leave it sitting there indefinitely.
  writeRaw('session', PENDING_KEY, JSON.stringify(pending))

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: SCOPES,
    state: pending.nonce,
    code_challenge: await challengeFor(verifier),
    code_challenge_method: 'S256',
  })
  window.location.assign(`${AUTHORIZE_URL}?${params.toString()}`)
}

// ---------------------------------------------------------------------------
// Returning from the flow
// ---------------------------------------------------------------------------

export type CallbackRejection = 'no_pending' | 'state_mismatch'

export type CallbackResolution =
  | { ok: true; verifier: string; clientId: string; returnTo: string; workspaceId: string }
  | { ok: false; reason: CallbackRejection; returnTo: string }

/**
 * The pure half of the callback, so it can be tested without a browser.
 *
 * `returnTo` is produced on every path, including the failures: the user's
 * filters and focus should survive a rejected callback just as they survive a
 * successful one. An unparseable stash yields '' — a bare app, which is the
 * same thing a cold start gives them.
 */
export function resolveCallback(stashRaw: string | null, state: string | null): CallbackResolution {
  let pending: PendingAuth | null
  try {
    pending = stashRaw ? (JSON.parse(stashRaw) as PendingAuth) : null
  } catch {
    pending = null
  }
  // A stash with no workspace predates scoping. Storing its token under a
  // guessed workspace is the very defect scoping fixes, so it is refused like
  // any other callback we cannot vouch for.
  if (!pending?.verifier || !pending.workspaceId) {
    return { ok: false, reason: 'no_pending', returnTo: pending?.returnTo ?? '' }
  }

  const returnTo = pending.returnTo ?? ''
  // The CSRF check. A callback whose state does not match the nonce we stored
  // was not started by this tab, so the code in it is not ours to exchange.
  if (!state || state !== pending.nonce) {
    return { ok: false, reason: 'state_mismatch', returnTo }
  }
  return {
    ok: true,
    verifier: pending.verifier,
    clientId: pending.clientId ?? '',
    returnTo,
    workspaceId: pending.workspaceId,
  }
}

/**
 * Consume an OAuth callback. **Synchronous URL restoration, asynchronous token
 * exchange** — the caller (parseUrl) has to swap the query string before any
 * store write happens, and cannot await.
 *
 * Returns the query string to restore, plus the exchange promise when there is
 * one, so the caller can refresh the capability store once it settles and the
 * write controls enable without a reload.
 */
export function consumeCallback(
  code: string,
  state: string | null,
): { returnTo: string; exchange: Promise<void> | null; rejected: CallbackRejection | null } {
  const resolution = resolveCallback(readRaw('session', PENDING_KEY), state)
  // Cleared on every path: a verifier that has been through one callback must
  // never be reusable, and a rejected one is not worth keeping either.
  writeRaw('session', PENDING_KEY, null)

  if (!resolution.ok) {
    return { returnTo: resolution.returnTo, exchange: null, rejected: resolution.reason }
  }
  return {
    returnTo: resolution.returnTo,
    exchange: exchangeCode(code, resolution.verifier, resolution.clientId, resolution.workspaceId),
    rejected: null,
  }
}

async function exchangeCode(
  code: string,
  verifier: string,
  clientId: string,
  workspaceId: string,
): Promise<void> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      redirect_uri: redirectUri(),
      client_id: clientId,
      code_verifier: verifier,
      grant_type: 'authorization_code',
    }).toString(),
  })
  if (!res.ok) throw new Error(`token exchange failed (${res.status})`)
  const json = (await res.json()) as TokenResponse
  if (!json.access_token) throw new Error('token exchange returned no access_token')
  storeAuth(json, clientId, workspaceId)
}

/**
 * **The refresh token is kept, and this reverses an earlier decision.**
 *
 * Linear returns a ~24h access token (`expires_in: 86399`) alongside a
 * rotating refresh token. This module used to discard the latter, on the
 * grounds that holding it turns a one-day exposure into a permanent one. That
 * reasoning does not survive the details: the refresh token rotates on every
 * use, and it lives in the same localStorage, on the same origin, as the access
 * token it renews — same reachability, same attacker. What the old shape
 * actually bought was a mandatory reconnect every single day.
 *
 * What the trade DOES require is that Disconnect revoke rather than forget —
 * see `revokeAuth`. Forgetting a 24h token was near enough to ending it;
 * forgetting a long-lived one is not. See docs/adr/0004.
 */
export function storeAuth(json: TokenResponse, clientId: string, workspaceId: string): void {
  if (!json.access_token) return
  const ttl = typeof json.expires_in === 'number' && json.expires_in > 0 ? json.expires_in : 0
  const auth: StoredAuth = {
    token: json.access_token,
    expiresAt: Date.now() + ttl * 1000,
    refreshToken: json.refresh_token,
    clientId,
  }
  writeRaw('local', authKey(workspaceId), JSON.stringify(auth))
}

const REVOKE_URL = 'https://api.linear.app/oauth/revoke'

/**
 * Serialise refreshes across tabs.
 *
 * Two tabs waking together would otherwise both spend the same rotating refresh
 * token; the loser's copy is then stale and its next attempt fails. `Web Locks`
 * is absent under vitest's node environment and in older browsers, where
 * running unserialised is the right fallback — Linear's 30-minute replay grace
 * on a refresh covers the race that remains.
 *
 * One lock per workspace: each slot rotates its own refresh token, so two tabs
 * on different workspaces have nothing to serialise against each other.
 */
async function withRefreshLock(workspaceId: string, fn: () => Promise<void>): Promise<void> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
  if (!locks) return fn()
  await locks.request(`ig-linear-refresh:${workspaceId}`, fn)
}

async function performRefresh(prev: StoredAuth, workspaceId: string): Promise<void> {
  let status: number | null = null
  try {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: prev.refreshToken ?? '',
        // No client_secret: Linear documents it as unnecessary when refreshing
        // a PKCE-generated token, which is the only kind this app issues. That
        // one fact is what keeps the whole flow in the browser and out of the
        // server, where a caller's token must never be persisted.
        client_id: prev.clientId ?? '',
      }).toString(),
    })
    status = res.status
    if (!res.ok) throw new Error(`refresh failed (${res.status})`)
    const next = mergeRefreshResponse(prev, (await res.json()) as TokenResponse, Date.now())
    if (!next) throw new Error('refresh returned no access_token')
    writeRaw('local', authKey(workspaceId), JSON.stringify(next))
  } catch {
    if (classifyRefreshFailure(status) === 'rejected') clearAuth(workspaceId)
  }
}

/**
 * Renew the stored token if it is near or past expiry. A no-op otherwise, and
 * safe to call on every app load and before every write.
 *
 * The re-read *inside* the lock is the load-bearing part: by the time this tab
 * acquires it, another may already have refreshed, and spending the rotated
 * token a second time would fail. Nothing anywhere caches `StoredAuth` in
 * memory for the same reason — `readAuth()` re-reads raw storage each call, and
 * that is what makes rotation safe between tabs.
 */
export async function refreshAuthIfStale(workspaceId: string): Promise<void> {
  if (decideRefresh(readAuth(workspaceId), Date.now()) !== 'stale') return
  await withRefreshLock(workspaceId, async () => {
    const current = readAuth(workspaceId)
    if (!current || decideRefresh(current, Date.now()) !== 'stale') return
    await performRefresh(current, workspaceId)
  })
}

/**
 * End the credential at Linear, not just in this browser.
 *
 * While a stored token died on its own within 24 hours, forgetting it locally
 * was equivalent to revoking it. A rotating refresh token has no such horizon,
 * so Disconnect has to say so upstream — otherwise "disconnect" leaves a live
 * credential behind, and the argument in `storeAuth` for keeping it stops
 * holding. Local state is cleared first and synchronously: the user asked to
 * disconnect, and a network failure must not leave the token sitting there.
 */
export async function revokeAuth(workspaceId: string): Promise<void> {
  const auth = readAuth(workspaceId)
  clearAuth(workspaceId)
  if (auth) await revokeTokens(auth)
}

const LEGACY_AUTH_KEY = 'ig-linear-auth-v1'

/**
 * Remove the pre-scoping entry. It cannot be migrated — it never recorded which
 * workspace it belonged to, and guessing is what scoping exists to stop — so it
 * is revoked (when it holds a refresh token, which only entries from the
 * refresh commit do; an access-only one dies within a day on its own) and
 * deleted. Idempotent; called once per app load.
 */
export async function dropLegacyAuth(): Promise<void> {
  const raw = readRaw('local', LEGACY_AUTH_KEY)
  if (raw === null) return
  writeRaw('local', LEGACY_AUTH_KEY, null)
  let legacy: StoredAuth | null
  try {
    legacy = JSON.parse(raw) as StoredAuth
  } catch {
    return
  }
  if (legacy?.token && legacy.refreshToken) await revokeTokens(legacy)
}

/** The upstream half of a disconnect, shared by revokeAuth and dropLegacyAuth. */
async function revokeTokens(auth: StoredAuth): Promise<void> {
  const revoke = (token: string, hint: string) =>
    fetch(REVOKE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token, token_type_hint: hint }).toString(),
    })
  const calls = [revoke(auth.token, 'access_token')]
  if (auth.refreshToken) calls.push(revoke(auth.refreshToken, 'refresh_token'))
  // Best effort, and both are attempted: Linear does not document revoking one
  // as revoking the other, and the local state is already gone either way.
  await Promise.allSettled(calls)
}

export function readAuth(workspaceId: string): StoredAuth | null {
  const raw = readRaw('local', authKey(workspaceId))
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as StoredAuth
    return parsed?.token ? parsed : null
  } catch {
    return null
  }
}

/** Whether this browser holds an unexpired token. Expiry is checked locally so
 *  the UI can offer "reconnect" instead of letting the user discover it as a
 *  401 on a write they thought had worked. */
export function hasValidAuth(workspaceId: string): boolean {
  const auth = readAuth(workspaceId)
  return auth !== null && auth.expiresAt > Date.now()
}

export function clearAuth(workspaceId: string): void {
  writeRaw('local', authKey(workspaceId), null)
}

/**
 * A renewal that did not land, on a credential that is still good.
 *
 * Carries a `code` because that is how `apiErrorMessage` and the write store
 * read an error, and because the code it must NOT be is `unauthenticated` —
 * see the comment in `authHeader`.
 */
export class RefreshFailedError extends Error {
  readonly code = 'refresh_failed'
  constructor() {
    super('Could not renew the Linear token.')
    this.name = 'RefreshFailedError'
  }
}

/**
 * The Authorization header for a write request, or `{}` when there is no usable
 * token — the server answers 401 either way, and sending `Bearer ` (empty)
 * would only make the failure harder to read in a network log.
 *
 * **Async, and deliberately so.** Renewing here rather than in the callers is
 * what makes it impossible to add a write path that forgets: `headers:
 * authHeader()` without the await is a Promise where a record belongs, which
 * is a type error rather than a token that quietly lapses in production.
 *
 * **Throws rather than returning `{}` when a renewable entry could not be
 * renewed.** `performRefresh` deliberately keeps the credential through a 5xx
 * or an offline laptop, since neither says anything about it — but falling
 * through to `{}` here would send the write with no bearer, the server would
 * answer 401 `unauthenticated`, and `forgetTokenIfRejected` would delete the
 * entry that was just preserved. Linear having a bad minute would read to the
 * user as "connect your account". An entry that is expired and has nothing to
 * renew *with* still returns `{}`: there, reconnecting really is the answer.
 */
export async function authHeader(workspaceId: string): Promise<Record<string, string>> {
  await refreshAuthIfStale(workspaceId)
  const auth = readAuth(workspaceId)
  const now = Date.now()
  if (auth && auth.expiresAt > now) return { Authorization: `Bearer ${auth.token}` }
  if (decideRefresh(auth, now) === 'stale') throw new RefreshFailedError()
  return {}
}
