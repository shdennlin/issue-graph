import type { IssueStateType, NormalizedIssue } from '@shared/types.js'

/**
 * Which Linear issue states count as "done" for our count-based progress.
 *
 * Centralizes a policy that used to be hardcoded at 5 call sites. This
 * helper is a *count* policy, distinct from Linear's scope-weighted
 * `progress` field on Project/ProjectMilestone which we use directly
 * where available (ProjectPanel bar). Helper covers the cases where
 * Linear's own number isn't yet loaded (canvas headers).
 *
 * Policy: `completed` is done. `canceled` is excluded from total
 * entirely — matches Linear's own scope semantics (a milestone with
 * only canceled issues reads 0/0, and Linear's progress reports 100%
 * because there is nothing left in scope to ship). Without this, the
 * local count contradicted the Linear-driven bar: panel would show
 * 0/1 next to a 100%-full bar for an all-canceled milestone.
 */
export function isDoneState(t: IssueStateType): boolean {
  return t === 'completed'
}

export function isCountedInTotal(t: IssueStateType): boolean {
  return t !== 'canceled'
}

export interface ProgressCounts {
  done: number
  total: number
}

export function rollupProgress(issues: Iterable<NormalizedIssue>): ProgressCounts {
  let done = 0
  let total = 0
  for (const i of issues) {
    if (!isCountedInTotal(i.state.type)) continue
    total += 1
    if (isDoneState(i.state.type)) done += 1
  }
  return { done, total }
}
