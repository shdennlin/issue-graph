import type { IssueStateType, NormalizedIssue } from '@shared/types.js'

/**
 * Which Linear issue states count as "done" for our count-based progress.
 *
 * Centralizes a policy that used to be hardcoded at 5 call sites
 * (ProjectPanel, milestone view, project view). Note: this is a *count*
 * policy, distinct from Linear's `progress` field on Project/ProjectMilestone
 * which is scope-weighted and already comes from the API. Where Linear's
 * own `progress` is available, prefer it; this helper covers the cases
 * where it isn't (canvas headers rendered before detail loads).
 *
 * Current policy: only `completed` is done. `canceled` is NOT done, but
 * still counts toward total (i.e. an all-canceled milestone reads 0/N).
 * If we ever switch to Linear's semantics (canceled excluded from total),
 * change `isCountedInTotal` below — every consumer goes through it.
 */
export function isDoneState(t: IssueStateType): boolean {
  return t === 'completed'
}

export function isCountedInTotal(_t: IssueStateType): boolean {
  return true
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
