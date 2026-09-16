// Optimistic repaint of one issue in the cached graph.
//
// Why this is a *second* patch shape, separate from the backend's IssuePatch:
// the two sides of the wire want different things. The server takes ids
// (`stateId`, `assigneeId`), because that is what the tracker's API keys off.
// The card renders `{ name, type }` and a whole NormalizedAssignee, and
// NormalizedIssue.state carries no id at all — so the server's patch simply
// cannot repaint anything. The caller has both, having matched the chosen
// WorkflowState: it sends `{ stateId: ws.id }` and paints `{ name, type }` from
// the same object.
//
// The paint is a placeholder, not a source of truth. A write is followed by a
// sync (webhook-driven remotely, client-driven locally) whose reload replaces
// the whole issue list; whatever this wrote is overwritten by the server's
// version a few seconds later. That is the intended lifecycle, and it is why
// nothing here tries to be clever about merging.

import type {
  IssueStateType,
  NormalizedAssignee,
  NormalizedIssue,
  NormalizedLabel,
  Priority,
} from '@shared/types.js'

export interface IssueDisplayPatch {
  state?: { name: string; type: IssueStateType }
  /** `null` paints "unassigned". Absent leaves the assignee alone — the same
   *  absent-vs-null distinction the wire patch makes, for the same reason. */
  assignee?: NormalizedAssignee | null
  /** 0 is a real priority ("No priority"), so this is guarded on `!== undefined`
   *  everywhere, never on truthiness. */
  priority?: Priority
  /** The whole label set, already resolved by the caller. The wire sends a
   *  delta (added/removed) to avoid clobbering a concurrent change; the paint
   *  needs the resulting set, because that is what the card renders. */
  labels?: NormalizedLabel[]
}

/**
 * Return a new issue list with `identifier`'s display fields patched.
 *
 * Returns the original array reference untouched when nothing matches, so a
 * caller can skip a store write (and the re-render behind it) when a stale
 * identifier arrives — a reload can land between the optimistic write and its
 * own response.
 */
export function applyIssueDisplayPatch(
  issues: NormalizedIssue[],
  identifier: string,
  patch: IssueDisplayPatch,
): NormalizedIssue[] {
  const idx = issues.findIndex((i) => i.identifier === identifier)
  if (idx === -1) return issues

  const current = issues[idx]
  if (!current) return issues

  const next: NormalizedIssue = { ...current }
  if (patch.state) next.state = { name: patch.state.name, type: patch.state.type }
  // `'assignee' in patch` rather than a truthiness check: null is a request to
  // unassign, undefined is a request to leave it alone, and conflating them
  // would make unassigning impossible while clearing the assignee on every
  // state-only change.
  if ('assignee' in patch) next.assignee = patch.assignee ?? null
  if (patch.priority !== undefined) next.priority = patch.priority
  if (patch.labels) next.labels = patch.labels

  const out = issues.slice()
  out[idx] = next
  return out
}
