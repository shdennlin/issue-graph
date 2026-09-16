// What the agent just did, and whether to interrupt you about it.
//
// Two halves with deliberately different lifetimes:
//
//   - **Preferences** (enabled / desktop / scope) persist, per browser, via
//     `preferences.ts`. Per browser is the feature's point, not a side effect:
//     several people reach one instance and each wants different interruptions.
//   - **Entries** do NOT persist. They are a window onto the last few minutes,
//     not a record. A reload would repopulate the list with "SHA-12 -> In
//     Review" lines describing a state that has since moved twice more, which
//     is worse than showing nothing. The durable answer to "what changed while
//     I was away" is the recency facet, which reads the same cache the graph
//     does and cannot drift from it.
//
// Desktop delivery lives here rather than in a component because it must fire
// exactly once per sync regardless of how many components are mounted.

import { create } from 'zustand'
import type { IssueChange } from '../lib/issueDiff'
import type { ChangedField } from '../lib/issueDiff'
import {
  readNotifyDesktop,
  readNotifyEnabled,
  readNotifyScope,
  writeNotifyDesktop,
  writeNotifyEnabled,
  writeNotifyScope,
} from '../lib/preferences'

/** Ring capacity. Beyond this the oldest entries fall off; anything older is
 *  the recency facet's job, not this list's. */
const MAX_ENTRIES = 50

export interface NotificationEntry {
  /** Stable React key. An identifier alone is not unique — the same issue can
   *  change twice in one session and both rows must survive. */
  id: string
  identifier: string
  title: string
  kind: 'created' | 'changed'
  fields: ChangedField[]
  at: number
  read: boolean
}

/**
 * Whether this browser can show a desktop notification at all.
 *
 * Three states, not two — the same shape as `capabilityStore`, for the same
 * reason. `null` means "not determined yet" so the UI can avoid flashing a
 * disabled control before the answer arrives.
 *
 *   - `unsupported` — no `Notification` constructor, or an insecure context.
 *     The API is only exposed on secure origins, which localhost satisfies but
 *     a plain-HTTP Tailscale IP does not. Surface it; do not fail silently.
 *   - `granted` / `denied` / `default` — the browser's own answer.
 */
export type DesktopSupport = 'unsupported' | NotificationPermission | null

let seq = 0

function nextId(identifier: string): string {
  seq += 1
  return `${identifier}#${seq}`
}

/** Reading `Notification.permission` can throw in hardened contexts, so every
 *  probe is guarded. */
function probeSupport(): DesktopSupport {
  if (typeof window === 'undefined') return 'unsupported'
  try {
    if (!('Notification' in window)) return 'unsupported'
    return window.Notification.permission
  } catch {
    return 'unsupported'
  }
}

interface NotificationState {
  entries: NotificationEntry[]
  enabled: boolean
  desktopEnabled: boolean
  /** Raw query string. Empty means "everything" — see `parseScope`. */
  scopeQuery: string
  support: DesktopSupport
  /**
   * The batch the in-app toast is currently announcing, or null.
   *
   * Held here rather than derived from `entries` because a toast is about one
   * sync, while the list accumulates: after two syncs the newest entries alone
   * cannot say whether they arrived together.
   */
  toast: { count: number; at: number } | null
  dismissToast: () => void

  setEnabled: (v: boolean) => void
  setDesktopEnabled: (v: boolean) => void
  setScopeQuery: (q: string) => void
  /** Ask the browser. MUST be called from a user gesture or the prompt is
   *  suppressed, which is why no effect calls it on mount. */
  requestPermission: () => Promise<void>

  /**
   * Fold one sync's worth of already-gated changes into the list, and raise at
   * most one desktop notification for the batch.
   */
  record: (changes: readonly IssueChange[], workspaceId: string | null) => void
  markAllRead: () => void
  clear: () => void
}

function toEntry(change: IssueChange, at: number): NotificationEntry {
  return {
    id: nextId(change.identifier),
    identifier: change.identifier,
    title: change.title,
    kind: change.kind,
    fields: change.kind === 'changed' ? change.fields : [],
    at,
    read: false,
  }
}

/**
 * One notification per sync, never one per issue.
 *
 * A bulk agent run writes issues in bursts — measured gaps within a burst are
 * under half a minute while gaps between sessions are over ten — so per-issue
 * delivery would stack a dozen banners for what a person experiences as a
 * single act.
 */
function desktopBody(entries: NotificationEntry[]): string {
  const head = entries
    .slice(0, 3)
    .map((e) => e.identifier)
    .join(', ')
  return entries.length > 3 ? `${head} +${entries.length - 3}` : head
}

function raiseDesktop(entries: NotificationEntry[], workspaceId: string | null): void {
  if (entries.length === 0) return
  // A desktop banner for something you are looking at is noise; the in-app
  // toast covers that case. `hasFocus()` rather than `visibilityState`: a
  // standalone PWA window sitting behind another app is still "visible".
  if (typeof document !== 'undefined' && document.hasFocus()) return
  try {
    if (typeof window === 'undefined' || !('Notification' in window)) return
    if (window.Notification.permission !== 'granted') return
    new window.Notification(
      entries.length === 1 ? entries[0]!.identifier : `${entries.length} issues changed`,
      {
        body: desktopBody(entries),
        // Collapses duplicates when the same instance is open in several
        // windows, each of which runs its own copy of this store.
        tag: `ig-${workspaceId ?? 'default'}`,
      },
    )
  } catch {
    // Permission revoked mid-session, or a platform that throws on construct.
    // Losing a banner must never break the sync that produced it.
  }
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  entries: [],
  enabled: readNotifyEnabled(),
  desktopEnabled: readNotifyDesktop(),
  scopeQuery: readNotifyScope(),
  support: probeSupport(),
  toast: null,

  dismissToast() {
    set({ toast: null })
  },

  setEnabled(v) {
    writeNotifyEnabled(v)
    set({ enabled: v })
  },
  setDesktopEnabled(v) {
    writeNotifyDesktop(v)
    set({ desktopEnabled: v })
  },
  setScopeQuery(q) {
    writeNotifyScope(q)
    set({ scopeQuery: q })
  },

  async requestPermission() {
    try {
      if (typeof window === 'undefined' || !('Notification' in window)) {
        set({ support: 'unsupported' })
        return
      }
      const result = await window.Notification.requestPermission()
      set({ support: result })
      if (result !== 'granted') {
        // Turning the toggle on while the browser says no would leave a
        // control that claims to work and does not.
        writeNotifyDesktop(false)
        set({ desktopEnabled: false })
      }
    } catch {
      set({ support: 'unsupported' })
    }
  },

  record(changes, workspaceId) {
    if (!get().enabled || changes.length === 0) return
    const at = Date.now()
    const fresh = changes.map((c) => toEntry(c, at))
    // Newest first, oldest dropped past the cap.
    set((s) => ({
      entries: [...fresh, ...s.entries].slice(0, MAX_ENTRIES),
      toast: { count: fresh.length, at },
    }))
    if (get().desktopEnabled) raiseDesktop(fresh, workspaceId)
  },

  markAllRead() {
    set({ toast: null })
    set((s) => ({
      entries: s.entries.some((e) => !e.read)
        ? s.entries.map((e) => (e.read ? e : { ...e, read: true }))
        : s.entries,
    }))
  },

  clear() {
    set({ entries: [], toast: null })
  },
}))

/** Unread count, derived rather than stored so it cannot drift from `entries`. */
export function unreadCount(entries: readonly NotificationEntry[]): number {
  return entries.reduce((n, e) => (e.read ? n : n + 1), 0)
}
