// Which changes are worth interrupting someone for.
//
// The scope is a stored query string, deliberately NOT the tab's live filters.
// Those answer a different question — "what do I draw?" — and binding the two
// together produces the failure this feature exists to prevent: while you are
// looking at Project A, the agent edits Project B and you never hear about it.
// Reviewing agent work means not knowing in advance where it will write, so
// the default is no filter at all.
//
// The two pipelines share `applyFilters` as a mechanism and share no state.

import type { NormalizedIssue } from '@shared/types.js'
import type { CodecState } from '../store/filterCodec'
import { fillLegacyState, parseFilters } from '../store/filterCodec'
import { applyFilters } from '../views/filters'
import type { IssueChange } from './issueDiff'

/** Resolved scope, or `null` for "notify about everything". */
export type NotificationScope = CodecState | null

export interface ScopeContext {
  staleDays: number
  myUserName: string | null
}

/**
 * Turn a stored query string into a scope.
 *
 * An empty query resolves to `null` rather than to a default `Filters`, and the
 * distinction is load-bearing. `Filters.stateTypes` defaults to four of the six
 * state types, so a "default" filter object is not neutral — running unfiltered
 * changes through it would silently swallow every transition into Completed or
 * Canceled, which is precisely the event an agent-review notification exists
 * for. "No scope" therefore has to bypass `applyFilters` entirely, not pass
 * through it with default arguments.
 */
export function parseScope(query: string): NotificationScope {
  const trimmed = query.trim()
  if (trimmed === '') return null
  // `fillLegacyState` first, exactly as `applySavedQuery` and `savedViewMatch`
  // do, and for the same reason: a query that names no `state` was written when
  // omission meant the EMPTY selection, while `parseFilters` reads an absent
  // `state` as the default four types. Skipping it turns "any state" into
  // "anything but Completed and Canceled" — so a saved view that shows every
  // state on the canvas would gate notifications to four of six, and a scope
  // snapshotted from a bare deep-link URL would drop every completion.
  return parseFilters(fillLegacyState(new URLSearchParams(trimmed)))
}

/**
 * Identifiers from `issues` that survive `scope`.
 *
 * Runs over the WHOLE list rather than over just the changed issues, because
 * `applyFilters` builds its link-touch and child-activity indexes from the
 * array it is given. Handing it a few changed rows would compute those indexes
 * against a near-empty graph, and any recency-mode filter would answer
 * differently than it does for the same issue on screen.
 */
function passing(
  issues: readonly NormalizedIssue[],
  scope: CodecState,
  ctx: ScopeContext,
): Set<string> {
  const kept = applyFilters(
    issues as NormalizedIssue[],
    scope.filters,
    ctx.staleDays,
    ctx.myUserName,
    scope.search,
  )
  return new Set(kept.map((i) => i.identifier))
}

/**
 * Drop the changes that fall outside `scope`.
 *
 * An issue qualifies if it passed the scope **before or after** the change.
 * Testing only the new state would drop exactly the events worth the most:
 * a scope carrying the default `state=` list excludes Completed, so an agent
 * marking something done would move it out of scope and go unreported. The
 * question to ask of a filter is whether it constrains, not whether the issue
 * still matches once the dust settles.
 *
 * Costs two `applyFilters` passes per sync regardless of how many issues moved.
 */
export function gateChanges(
  changes: readonly IssueChange[],
  scope: NotificationScope,
  prevAll: readonly NormalizedIssue[],
  nextAll: readonly NormalizedIssue[],
  ctx: ScopeContext,
): IssueChange[] {
  if (scope === null) return [...changes]
  if (changes.length === 0) return []

  const passedBefore = passing(prevAll, scope, ctx)
  const passedAfter = passing(nextAll, scope, ctx)

  return changes.filter(
    (c) => passedBefore.has(c.identifier) || passedAfter.has(c.identifier),
  )
}
