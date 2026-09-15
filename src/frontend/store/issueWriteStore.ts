// Writes that leave this app: an issue's state, its assignee, a new comment.
//
// Shaped after savedViewsStore — optimistic first, `error` held as the raw
// thrown value so apiErrorMessage(err, t) can translate it at render time
// rather than freezing a sentence in whatever locale was active when the
// request failed — with one deliberate departure.
//
// **Failures reload instead of rolling back.** savedViewsStore can restore a
// snapshot because it owns the state it changed. Here the server is the
// authority and a sync can land between the optimistic paint and the write's
// response (the webhook path fires on its own schedule), so a saved "previous
// value" may already be stale by the time we would restore it. Reloading is
// both simpler and correct; it costs a round trip on a path that is rare by
// construction. savedViewsStore.reorder does the same thing for the same
// reason, including re-setting the error *after* the refetch so the refetch
// does not clear it.
//
// Consequently the write's own response may only ever touch `status` and
// `error`. Success is a no-op against the graph: the optimistic paint already
// happened, and the reload that follows is what makes it real.

import { create } from 'zustand'
import type {
  IssueStateType,
  NormalizedAssignee,
  NormalizedLabel,
  Priority,
} from '@shared/types.js'
import { api } from '../lib/api'
import { clearAuth } from '../lib/linearAuth'
import { useCapabilityStore } from './capabilityStore'
import { useGraphStore } from './graphStore'

export type WriteStatus = 'idle' | 'saving' | 'error'

interface IssueWriteState {
  /** Keyed by issue identifier, so two panels (or a panel and a card) can be
   *  mid-write independently without one clearing the other's error. */
  status: Record<string, WriteStatus>
  /** Raw thrown value — translated by the component, not here. */
  error: Record<string, unknown>
  setState: (
    identifier: string,
    state: { id: string; name: string; type: IssueStateType },
  ) => Promise<void>
  setAssignee: (identifier: string, assignee: NormalizedAssignee | null) => Promise<void>
  setPriority: (identifier: string, priority: Priority) => Promise<void>
  /** Label edits take the issue's *current* set so the optimistic paint can
   *  show the result, while the wire carries only the one-label delta. */
  addLabel: (identifier: string, label: NormalizedLabel, current: NormalizedLabel[]) => Promise<void>
  removeLabel: (identifier: string, label: NormalizedLabel, current: NormalizedLabel[]) => Promise<void>
  addComment: (identifier: string, body: string) => Promise<boolean>
  clearError: (identifier: string) => void
}

function begin(identifier: string, set: (fn: (s: IssueWriteState) => Partial<IssueWriteState>) => void) {
  set((s) => ({
    status: { ...s.status, [identifier]: 'saving' },
    error: { ...s.error, [identifier]: undefined },
  }))
}

export const useIssueWriteStore = create<IssueWriteState>((set) => ({
  status: {},
  error: {},

  clearError(identifier) {
    set((s) => ({
      status: { ...s.status, [identifier]: 'idle' },
      error: { ...s.error, [identifier]: undefined },
    }))
  },

  async setState(identifier, state) {
    begin(identifier, set)
    // Paint from the WorkflowState we already matched: the wire wants the id,
    // the card wants name + type, and NormalizedIssue.state carries no id to
    // derive one from. Both come from this one object.
    useGraphStore.getState().applyIssuePatch(identifier, {
      state: { name: state.name, type: state.type },
    })
    try {
      await api.updateIssue(identifier, { stateId: state.id })
      set((s) => ({ status: { ...s.status, [identifier]: 'idle' } }))
      await settle()
    } catch (e) {
      await fail(identifier, e, set)
    }
  },

  async setAssignee(identifier, assignee) {
    begin(identifier, set)
    useGraphStore.getState().applyIssuePatch(identifier, { assignee })
    try {
      // `null` unassigns; the key's presence is what carries that, so it is
      // always sent rather than spread conditionally.
      await api.updateIssue(identifier, { assigneeId: assignee?.id ?? null })
      set((s) => ({ status: { ...s.status, [identifier]: 'idle' } }))
      await settle()
    } catch (e) {
      await fail(identifier, e, set)
    }
  },

  async setPriority(identifier, priority) {
    begin(identifier, set)
    useGraphStore.getState().applyIssuePatch(identifier, { priority })
    try {
      await api.updateIssue(identifier, { priority })
      set((s) => ({ status: { ...s.status, [identifier]: 'idle' } }))
      await settle()
    } catch (e) {
      await fail(identifier, e, set)
    }
  },

  async addLabel(identifier, label, current) {
    begin(identifier, set)
    useGraphStore.getState().applyIssuePatch(identifier, { labels: [...current, label] })
    try {
      // A delta, not the resulting set: `labelIds` would overwrite any label
      // someone else added since our last sync, and the graph is a cache so
      // our idea of "current" is always slightly behind.
      await api.updateIssue(identifier, { addedLabelIds: [label.id] })
      set((s) => ({ status: { ...s.status, [identifier]: 'idle' } }))
      await settle()
    } catch (e) {
      await fail(identifier, e, set)
    }
  },

  async removeLabel(identifier, label, current) {
    begin(identifier, set)
    useGraphStore.getState().applyIssuePatch(identifier, {
      labels: current.filter((l) => l.id !== label.id),
    })
    try {
      await api.updateIssue(identifier, { removedLabelIds: [label.id] })
      set((s) => ({ status: { ...s.status, [identifier]: 'idle' } }))
      await settle()
    } catch (e) {
      await fail(identifier, e, set)
    }
  },

  // Returns whether it landed, so the composer knows whether to clear itself —
  // a failed comment whose text was thrown away is worse than no comment.
  async addComment(identifier, body) {
    begin(identifier, set)
    try {
      await api.addIssueComment(identifier, body)
      set((s) => ({ status: { ...s.status, [identifier]: 'idle' } }))
      // No optimistic append: comments live inside the lazily-fetched issue
      // detail, not in the graph, and the route busts that cache on write. The
      // panel refetches and gets the real comment, author and timestamp.
      await settle()
      return true
    } catch (e) {
      await fail(identifier, e, set)
      return false
    }
  },
}))

/**
 * Ask the server to re-pull after a successful write — but only where nothing
 * else will.
 *
 * A webhook deployment already re-syncs on Linear's callback, and a forced
 * syncOnce does NOT merge into an in-flight one: it waits for it and then runs
 * a second full pull (sync.ts:56-60 — the early return is guarded on `!force`,
 * and POST /api/sync always forces). Unconditional would therefore cost a whole
 * extra Linear pull per write, and double the rate-limit spend, to learn a
 * field we already know.
 *
 * The risk of skipping it is a configured-but-broken webhook (tunnel down), in
 * which case the write is correct but the graph looks stale. The 30s poller in
 * App.tsx is the backstop, and a webhook that stops arriving is a bigger
 * problem than a slow repaint.
 *
 * `null` (not yet asked) counts as "no webhook" so an early write still
 * refreshes. Failures are swallowed — the write already landed.
 */
async function settle(): Promise<void> {
  if (useCapabilityStore.getState().webhookConfigured === true) return
  try {
    await useGraphStore.getState().forceSync()
  } catch {
    /* the write landed; the refresh is best-effort */
  }
}

/**
 * A write refused for authentication: the token is gone as far as Linear is
 * concerned, whatever this browser still believes about its expiry.
 *
 * Dropping it locally matters because expiry is the only thing checked here,
 * and a token revoked upstream still looks valid until it lapses. Without this
 * the controls stay enabled and every write fails the same way, with no path
 * back — clearing it flips them to the locked state whose hint says "connect".
 */
function forgetTokenIfRejected(e: unknown): void {
  const code = e && typeof e === 'object' && 'code' in e ? (e as { code: unknown }).code : null
  if (code !== 'unauthenticated') return
  clearAuth()
  useCapabilityStore.getState().refreshUnlocked()
}

async function fail(
  identifier: string,
  e: unknown,
  set: (fn: (s: IssueWriteState) => Partial<IssueWriteState>) => void,
): Promise<void> {
  forgetTokenIfRejected(e)
  // Reload first, so the optimistic paint is replaced by the server's truth,
  // then set the error — the reload must not be what clears it.
  try {
    await useGraphStore.getState().refetchSilent()
  } catch {
    /* the error below is the thing the user needs either way */
  }
  set((s) => ({
    status: { ...s.status, [identifier]: 'error' },
    error: { ...s.error, [identifier]: e },
  }))
}
