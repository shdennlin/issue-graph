// What changed between two graph snapshots.
//
// The app's issues are increasingly written by an AI agent over MCP, and that
// agent authenticates AS the user — so Linear, which never notifies you about
// your own actions, emits nothing for any of it. Probed 2026-08-25 across two
// workspaces: `issue.creator` is always the user with `isMe: true`, and
// `botActor` / `integrationSourceType` / `externalUserCreator` are all null.
// There is no server-side discriminator to query, and no Linear notification
// to forward. Diffing two consecutive cache reads is the only signal there is.
//
// **Deliberately not keyed on `updatedAt`.** The backend bumps an issue's
// `updatedAt` when someone merely points a relation AT it (see `linkTouch.ts`),
// so an issue nobody touched looks freshly changed. Comparing semantic fields
// instead means a relation being drawn is silently ignored, which is the
// intended behavior — `relations` is likewise absent from the field list.
//
// The returned change carries the whole `before`/`after` issue rather than
// just field names, because the notification scope gate has to run
// `applyFilters` over BOTH states: an issue moved INTO a filtered-out state
// (say Completed) must still notify, and testing only the new state would
// silently drop the single most notable event. Callers that persist changes
// should project them down to something lighter first.

import type { NormalizedIssue } from '@shared/types.js'

/**
 * Which semantic dimension moved. `comment` covers `lastCommentAt`.
 *
 * The list is "what an agent doing CRUD plausibly writes", minus anything the
 * backend can move on its own. `estimate`, `cycle`, `team` and `parent` are
 * left out as marginal rather than as wrong — add them here if an agent starts
 * writing them, but do not add `updatedAt` or `relations` (see the header).
 */
export type ChangedField =
  | 'title'
  | 'state'
  | 'assignee'
  | 'priority'
  | 'labels'
  | 'project'
  | 'milestone'
  | 'dueDate'
  | 'comment'

export interface IssueCreated {
  kind: 'created'
  identifier: string
  title: string
  before: null
  after: NormalizedIssue
}

export interface IssueChanged {
  kind: 'changed'
  identifier: string
  title: string
  /** Non-empty by construction — a change with no moved field is not emitted. */
  fields: ChangedField[]
  before: NormalizedIssue
  after: NormalizedIssue
}

export type IssueChange = IssueCreated | IssueChanged

/**
 * Identity for the assignee dimension.
 *
 * `NormalizedAssignee.id` is optional (a backend adapter need not expose one),
 * so `displayName` is the fallback rather than a second comparison — two people
 * sharing a display name is a far smaller problem than every assignee change
 * going unnoticed on an adapter that omits ids.
 */
function assigneeKey(issue: NormalizedIssue): string | null {
  const a = issue.assignee
  if (!a) return null
  return a.id ?? a.displayName
}

/**
 * Order-insensitive identity for the label set.
 *
 * Linear returns labels in no guaranteed order, and a sync that reorders them
 * without changing membership must not read as a change.
 */
function labelKey(issue: NormalizedIssue): string {
  return issue.labels
    .map((l) => l.id)
    .sort()
    .join(',')
}

/**
 * True when `after` carries a comment that `before` did not.
 *
 * One-directional on purpose: `lastCommentAt` can legitimately move backwards
 * when the newest comment is deleted, and "a comment vanished" is not something
 * to interrupt anyone for.
 */
function gainedComment(before: NormalizedIssue, after: NormalizedIssue): boolean {
  const next = after.lastCommentAt
  if (!next) return false
  const prev = before.lastCommentAt
  if (!prev) return true
  return next > prev
}

function changedFields(before: NormalizedIssue, after: NormalizedIssue): ChangedField[] {
  const fields: ChangedField[] = []
  if (before.title !== after.title) fields.push('title')
  // state.name rather than state.type: moving between two states of the same
  // canonical type ("Todo" -> "Review Spec") is a real transition the user
  // cares about, and the type list would flatten it away.
  if (before.state.name !== after.state.name) fields.push('state')
  if (assigneeKey(before) !== assigneeKey(after)) fields.push('assignee')
  if (before.priority !== after.priority) fields.push('priority')
  if (labelKey(before) !== labelKey(after)) fields.push('labels')
  if ((before.project?.id ?? null) !== (after.project?.id ?? null)) fields.push('project')
  if ((before.projectMilestone?.id ?? null) !== (after.projectMilestone?.id ?? null)) {
    fields.push('milestone')
  }
  // `?? null` rather than a truthiness check: dueDate is nullable and clearing
  // one is an edit worth reporting, same as setting one.
  if ((before.dueDate ?? null) !== (after.dueDate ?? null)) fields.push('dueDate')
  if (gainedComment(before, after)) fields.push('comment')
  return fields
}

/**
 * Semantic changes between two issue lists, keyed by `identifier`.
 *
 * Issues present in `prev` but absent from `next` produce nothing. That is not
 * an oversight: the 24h reconcile inside `syncOnce` runs `deleteIssuesNotIn`,
 * and its results land in an ordinary refetch — so "disappeared" fires for
 * housekeeping far more often than for anything a person did.
 */
export function diffIssues(
  prev: readonly NormalizedIssue[],
  next: readonly NormalizedIssue[],
): IssueChange[] {
  const byIdentifier = new Map<string, NormalizedIssue>()
  for (const issue of prev) byIdentifier.set(issue.identifier, issue)

  const changes: IssueChange[] = []
  for (const after of next) {
    const before = byIdentifier.get(after.identifier)
    if (!before) {
      changes.push({
        kind: 'created',
        identifier: after.identifier,
        title: after.title,
        before: null,
        after,
      })
      continue
    }
    const fields = changedFields(before, after)
    if (fields.length === 0) continue
    changes.push({
      kind: 'changed',
      identifier: after.identifier,
      title: after.title,
      fields,
      before,
      after,
    })
  }
  return changes
}
