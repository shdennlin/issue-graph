// What the agent just did, and whether to interrupt you about it.
//
// Two halves with deliberately different lifetimes:
//
//   - **Preferences** (enabled / desktop / scope) persist, per browser, via
//     `preferences.ts`. Per browser is the feature's point, not a side effect:
//     several people reach one instance and each wants different interruptions.
//   - **Entries** persist too, but keyed per workspace and in their own module
//     (`lib/notificationHistory.ts`) — they are a log, and reviewing what an
//     agent did overnight is exactly the case that outlives a tab. The store
//     holds only the workspace currently on screen; `hydrate` swaps the set.
//
// Desktop delivery lives here rather than in a component because it must fire
// exactly once per sync regardless of how many components are mounted.

import { create } from 'zustand'
import type { IssueChange } from '../lib/issueDiff'
import {
  readNotifyDesktop,
  readNotifyEnabled,
  readNotifyScope,
  writeNotifyDesktop,
  writeNotifyEnabled,
  writeNotifyScope,
} from '../lib/preferences'
import {
  MAX_ENTRIES,
  clearHistory,
  readHistory,
  writeHistory,
  type StoredEntry,
} from '../lib/notificationHistory'

/** One row. Identical to the stored shape — the log is the state, so a second
 *  type would only be somewhere for the two to drift apart. */
export type NotificationEntry = StoredEntry

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
  /** Workspace the `entries` belong to. Null until the first hydrate. */
  workspaceId: string | null
  /** Point the store at a workspace, loading its log. A no-op when already
   *  there, so it is safe to call from an effect that runs on every render. */
  hydrate: (workspaceId: string | null) => void

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
    to: change.kind === 'changed' ? change.to : {},
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
  workspaceId: null,

  hydrate(workspaceId) {
    if (get().workspaceId === workspaceId) return
    // Dropping the toast matters: it announces a batch from the workspace we
    // are leaving, and "3 issues changed" over a graph where none of them
    // appear is worse than no toast at all.
    set({ workspaceId, entries: readHistory(workspaceId), toast: null })
  },

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
    get().hydrate(workspaceId)
    if (!get().enabled || changes.length === 0) return
    const at = Date.now()
    const fresh = changes.map((c) => toEntry(c, at))
    // Newest first, oldest dropped past the cap.
    const entries = [...fresh, ...get().entries].slice(0, MAX_ENTRIES)
    writeHistory(workspaceId, entries)
    set({ entries, toast: { count: fresh.length, at } })
    if (get().desktopEnabled) raiseDesktop(fresh, workspaceId)
  },

  markAllRead() {
    const { entries, workspaceId } = get()
    if (!entries.some((e) => !e.read)) {
      set({ toast: null })
      return
    }
    const next = entries.map((e) => (e.read ? e : { ...e, read: true }))
    writeHistory(workspaceId, next)
    set({ entries: next, toast: null })
  },

  clear() {
    clearHistory(get().workspaceId)
    set({ entries: [], toast: null })
  },
}))

/** Unread count, derived rather than stored so it cannot drift from `entries`. */
export function unreadCount(entries: readonly NotificationEntry[]): number {
  return entries.reduce((n, e) => (e.read ? n : n + 1), 0)
}
