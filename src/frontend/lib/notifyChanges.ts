// The seam between "the graph was replaced" and "tell the user about it".
//
// Separate from graphStore so that store stays a data holder: this module is
// the only place that knows a graph swap can be newsworthy, and the only one
// that reaches across to viewStore / workspaceStore for the context the scope
// gate needs.
//
// Called from the two silent refetch paths, and from `forceSync` — pressing
// Refresh is the most deliberate "tell me what changed" gesture there is, and
// leaving it out (on the grounds that it reloads through `load()`) meant the
// one moment someone was actively asking was the one moment nothing answered.
//
// The remaining `graph` writers stay silent, because each changes the *set* of
// issues without anything having happened in Linear:
//
//   - `load()`            — first paint, and the post-switch reload. There is
//                           no baseline to diff against in either case.
//   - `extendScope(days)` — pulls in hundreds of Completed/Canceled issues the
//                           moment someone ticks a state box. Every one of them
//                           is "new" to the diff, and none of them is news.

import type { GraphResponse } from '@shared/types.js'
import { diffIssues } from './issueDiff'
import { gateChanges, parseScope } from './notificationScope'
import { useNotificationStore } from '../store/notificationStore'
import { useViewStore } from '../store/viewStore'
import { useWorkspaceStore } from '../store/workspaceStore'

// No cross-workspace guard here, deliberately.
//
// There used to be a remembered `lastWorkspaceId`, on the theory that moving a
// tab between workspaces would diff A's issues against B's. It cannot: at every
// site that calls this, `prev` and `next` already belong to the same workspace.
// `loadTab` restores that tab's OWN graph before App.tsx re-fetches, and an
// in-place workspace change (the SyncBanner picker) takes the `load()` path,
// which never notifies at all. What the guard actually did was fire on tab
// switch — dropping a perfectly good diff AND advancing the baseline past it,
// so everything an agent had done in the workspace you were switching TO was
// swallowed and could never be reported.

/**
 * Diff `prev` against `next`, apply the stored scope, and record what survives.
 *
 * Never throws into the caller: a refetch that succeeded must not be undone by
 * a notification that failed.
 */
export function notifyOnGraphSwap(prev: GraphResponse | null, next: GraphResponse): void {
  try {
    const workspaceId = useWorkspaceStore.getState().currentWorkspaceId

    // The first graph a tab ever sees is not news — there is nothing to diff
    // it against.
    if (!prev) return

    const changes = diffIssues(prev.data.issues, next.data.issues)
    if (changes.length === 0) return

    const notifications = useNotificationStore.getState()
    if (!notifications.enabled) return

    const view = useViewStore.getState()
    const kept = gateChanges(
      changes,
      parseScope(notifications.scopeQuery),
      prev.data.issues,
      next.data.issues,
      {
        staleDays: view.staleDays,
        myUserName: next.data.viewer?.displayName ?? null,
      },
    )
    notifications.record(kept, workspaceId)
  } catch {
    // Any failure here is cosmetic by definition — the graph is already fresh.
  }
}
