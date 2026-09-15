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
const AUTH_KEY = 'ig-linear-auth-v1'

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
}

export interface StoredAuth {
  token: string
  /** Epoch ms. Recorded so the UI can say "expired, reconnect" instead of
   *  surfacing a bare 401 from a write the user thought would work. */
  expiresAt: number
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
export async function beginAuth(clientId: string): Promise<void> {
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
  | { ok: true; verifier: string; clientId: string; returnTo: string }
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
  if (!pending?.verifier) return { ok: false, reason: 'no_pending', returnTo: '' }

  const returnTo = pending.returnTo ?? ''
  // The CSRF check. A callback whose state does not match the nonce we stored
  // was not started by this tab, so the code in it is not ours to exchange.
  if (!state || state !== pending.nonce) {
    return { ok: false, reason: 'state_mismatch', returnTo }
  }
  return { ok: true, verifier: pending.verifier, clientId: pending.clientId ?? '', returnTo }
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
    exchange: exchangeCode(code, resolution.verifier, resolution.clientId),
    rejected: null,
  }
}

async function exchangeCode(code: string, verifier: string, clientId: string): Promise<void> {
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
  const json = (await res.json()) as { access_token?: string; expires_in?: number }
  if (!json.access_token) throw new Error('token exchange returned no access_token')
  storeAuth(json.access_token, json.expires_in)
}

/**
 * **The access token only — never the refresh token.**
 *
 * Linear returns a ~24h access token (`expires_in: 86399`) alongside a
 * long-lived refresh token. Keeping the refresh token here would turn a
 * one-day exposure into a permanent one, which is a poor trade for saving a
 * single click a day while the user's Linear session is already live.
 */
export function storeAuth(token: string, expiresInSeconds: number | undefined): void {
  const ttl = typeof expiresInSeconds === 'number' && expiresInSeconds > 0 ? expiresInSeconds : 0
  const auth: StoredAuth = { token, expiresAt: Date.now() + ttl * 1000 }
  writeRaw('local', AUTH_KEY, JSON.stringify(auth))
}

export function readAuth(): StoredAuth | null {
  const raw = readRaw('local', AUTH_KEY)
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
export function hasValidAuth(): boolean {
  const auth = readAuth()
  return auth !== null && auth.expiresAt > Date.now()
}

export function clearAuth(): void {
  writeRaw('local', AUTH_KEY, null)
}

/** The Authorization header for a write request, or `{}` when there is no
 *  usable token — the server answers 401 either way, and sending `Bearer `
 *  (empty) would only make the failure harder to read in a network log. */
export function authHeader(): Record<string, string> {
  const auth = readAuth()
  return auth && auth.expiresAt > Date.now() ? { Authorization: `Bearer ${auth.token}` } : {}
}
