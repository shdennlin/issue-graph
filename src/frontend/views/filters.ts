// Shared filter logic across views.

import type { NormalizedIssue } from '@shared/types.js'
import type { Filters } from '../store/viewStore'

// Filter-panel "leave-one-out" counting: when showing the count next to e.g.
// "(unassigned)", we want it to reflect "if you click this, how many issues
// will be visible?" — not "how many unassigned issues exist in cache total"
// (which would include canceled ones the active-only filter hides).
//
// Achieved by clearing only the named dimension's filter values, then re-
// running applyFilters. All other dimensions stay applied.
export type FilterDimension =
  | 'state'
  | 'priority'
  | 'assignee'
  | 'primary'
  | 'type'
  | 'prefix'
  | 'project'

export function applyFiltersExcluding(
  issues: NormalizedIssue[],
  filters: Filters,
  staleDays: number,
  myUserName: string | null,
  search: string | undefined,
  exclude: FilterDimension,
): NormalizedIssue[] {
  const f: Filters = { ...filters }
  switch (exclude) {
    case 'state':
      f.stateTypes = []
      f.stateNames = []
      // activeOnly is a state-dimension shortcut ("state ∈ active set").
      // Drop it too so counts for Canceled / Completed reflect reality
      // instead of always showing 0 because activeOnly hides them.
      f.activeOnly = false
      break
    case 'priority':
      f.priorities = []
      break
    case 'assignee':
      f.assignees = []
      // myIssuesOnly is part of the assignee dimension conceptually.
      f.myIssuesOnly = false
      break
    case 'primary':
      f.primaryValues = []
      break
    case 'type':
      f.typeValues = []
      break
    case 'prefix':
      f.prefixSelections = {}
      break
    case 'project':
      // Project and milestone are the same hierarchical dimension. Clearing
      // 'project' clears both so leave-one-out counts for any row in that
      // section share the same base (mirrors how 'state' clears stateTypes
      // + stateNames + activeOnly together).
      f.projectIds = []
      f.milestoneIds = []
      break
  }
  return applyFilters(issues, f, staleDays, myUserName, search)
}

/** Composite key for issues that have a project but no milestone within it.
 *  Stored inside Filters.milestoneIds as '<projectId>::__nomilestone'. */
export const NO_MILESTONE_TOKEN = '__nomilestone'

/** Build the composite key used in Filters.milestoneIds for an issue. */
export function milestoneFilterKey(projectId: string, milestoneId: string | null): string {
  return `${projectId}::${milestoneId ?? NO_MILESTONE_TOKEN}`
}

export function applyFilters(
  issues: NormalizedIssue[],
  filters: Filters,
  staleDays: number,
  myUserName: string | null,
  search?: string,
): NormalizedIssue[] {
  const cutoff = Date.now() - staleDays * 24 * 3600 * 1000
  const q = (search ?? '').trim().toLowerCase()
  return issues.filter((i) => {
    if (q.length > 0) {
      // Match against identifier, title, or assignee. Case-insensitive substring.
      const hay = `${i.identifier} ${i.title} ${i.assignee?.displayName ?? ''}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    // State filter precedence:
    //   stateNames (explicit Linear state.name pick) > stateTypes + activeOnly
    // When user explicitly picks named states, the activeOnly shortcut is
    // overridden — it's a quick filter, not a hard gate. Without this, a
    // user picking "Duplicate" (canonical=canceled) with activeOnly still
    // on would silently see nothing.
    if (filters.stateNames.length > 0) {
      if (!filters.stateNames.includes(i.state.name)) return false
    } else {
      if (filters.activeOnly && (i.state.type === 'completed' || i.state.type === 'canceled')) return false
      if (filters.stateTypes.length > 0 && !filters.stateTypes.includes(i.state.type)) return false
    }
    if (filters.priorities.length > 0 && !filters.priorities.includes(i.priority)) return false
    if (filters.assignees.length > 0) {
      const name = i.assignee?.displayName ?? '(unassigned)'
      if (!filters.assignees.includes(name)) return false
    }
    if (filters.myIssuesOnly && myUserName && i.assignee?.displayName !== myUserName) return false
    if (filters.staleOnly) {
      const u = new Date(i.updatedAt).getTime()
      if (u >= cutoff) return false
    }
    if (filters.primaryValues.length > 0) {
      const hit = i.labels.some((l) => filters.primaryValues.includes(l.id))
      if (!hit) return false
    }
    if (filters.typeValues.length > 0) {
      const hit = i.labels.some((l) => filters.typeValues.includes(l.id))
      if (!hit) return false
    }
    for (const [, ids] of Object.entries(filters.prefixSelections)) {
      if (ids.length === 0) continue
      const hit = i.labels.some((l) => ids.includes(l.id))
      if (!hit) return false
    }
    // Project / milestone hierarchy. Child (milestoneIds) takes precedence
    // over parent (projectIds) — mirrors stateNames > stateTypes. When the
    // child is empty, parent applies; when child is set, parent is ignored.
    if (filters.milestoneIds.length > 0) {
      const projId = i.project?.id
      // Issues without a project can never match any milestone selection
      // (milestones are project-scoped in Linear's data model).
      if (!projId) return false
      const key = milestoneFilterKey(projId, i.projectMilestone?.id ?? null)
      if (!filters.milestoneIds.includes(key)) return false
    } else if (filters.projectIds.length > 0) {
      // '__noproject' is the sentinel for "issues without a Linear project".
      // Mirrors the Project view's grouping key so the filter UI and view
      // stay aligned.
      const key = i.project?.id ?? '__noproject'
      if (!filters.projectIds.includes(key)) return false
    }
    return true
  })
}
