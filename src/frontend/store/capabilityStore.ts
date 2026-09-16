// What this server instance will let the client do.
//
// The write controls have three states, not two, and this store carries the two
// bits that pick between them:
//
//   - writes impossible — the server has no Linear OAuth client id, so nobody
//     can authorise and the controls should not appear at all;
//   - writes possible but not authorised here — this browser holds no unexpired
//     token, so the controls appear disabled with a pointer to Settings;
//   - writes available.
//
// Its own store rather than a field on schemaStore: that store is about the
// workspace's label/state vocabulary and reloads per workspace, while this is a
// property of the process serving the page. Folding them together would mean
// re-asking on every tab switch for an answer that cannot have changed.

import { create } from 'zustand'
import { api } from '../lib/api'
import { hasValidAuth } from '../lib/linearAuth'

interface CapabilityState {
  /** null until asked. Distinguished from `false` so the UI can avoid
   *  flashing a disabled control before the answer arrives. */
  writeEnabled: boolean | null
  /**
   * The server's Linear OAuth client id, or null when write-back is
   * unconfigured. A real value rather than a `*_set` boolean because it is
   * public by design and the browser cannot start the authorize redirect
   * without it — it is the one thing this app needs *from* the server in order
   * to obtain a credential the server never sees.
   */
  clientId: string | null
  /**
   * Whether THIS browser holds an unexpired Linear token. Mirrored into the
   * store rather than read from localStorage at render time so that completing
   * the OAuth round trip re-renders the panels that gate on it — a plain read is
   * not a subscription, and the controls would stay disabled until a reload.
   */
  unlocked: boolean
  /**
   * Whether the server has an inbound webhook configured.
   *
   * Not a capability the user sees — it decides whether the client fires its
   * own re-sync after a write. `POST /api/sync` forces, and a forced syncOnce
   * does NOT collapse into an in-flight one (sync.ts:56-60 returns the existing
   * promise only when force is false; with force it waits and then runs a
   * second full pull). So on a webhook deployment an unconditional client sync
   * costs a whole extra Linear pull per write, serialized behind the webhook's.
   * null until asked — treated as "no webhook", so the first write after load
   * still refreshes.
   */
  webhookConfigured: boolean | null
  /**
   * Why the last authorisation attempt did not produce a token, or null.
   *
   * It lives in the store rather than in SettingsPage because the failure
   * happens during URL parsing, potentially with Settings closed — the panel
   * has to be able to *find* the error when it opens, not be told about it
   * while it is mounted.
   */
  authError: AuthFailure | null
  load: () => Promise<void>
  refreshUnlocked: () => void
  setAuthError: (failure: AuthFailure | null) => void
}

/** 'rejected' covers everything the callback could not vouch for (no stashed
 *  flow, or a state that did not match); 'exchange' is a token request that
 *  reached Linear and failed. They need different advice. */
export type AuthFailure = 'rejected' | 'exchange'

export const useCapabilityStore = create<CapabilityState>((set) => ({
  writeEnabled: null,
  clientId: null,
  webhookConfigured: null,
  authError: null,
  unlocked: hasValidAuth(),
  refreshUnlocked() {
    set({ unlocked: hasValidAuth() })
  },
  setAuthError(failure) {
    set({ authError: failure })
  },
  async load() {
    try {
      const res = await api.fetchSettings()
      // `env` is typed Record<string, unknown>, so a backend rename does not
      // surface here as a type error — it surfaces as a permanently undefined
      // field. Worth reading the key name twice.
      const clientId = res.env?.linear_oauth_client_id
      set({
        clientId: typeof clientId === 'string' && clientId ? clientId : null,
        writeEnabled: typeof clientId === 'string' && clientId.length > 0,
        webhookConfigured: Boolean(res.webhook?.secret_set),
      })
    } catch {
      // Treat unreachable as "no writes". The optimistic alternative shows
      // controls that fail on use, which reads as the feature being broken
      // rather than as the backend being down.
      set({ writeEnabled: false, clientId: null, webhookConfigured: false })
    }
  },
}))
