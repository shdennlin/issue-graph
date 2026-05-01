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
  }
  return applyFilters(issues, f, staleDays, myUserName, search)
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
    if (filters.activeOnly && (i.state.type === 'completed' || i.state.type === 'canceled')) return false
    // State filter: stateNames (specific Linear state names) takes precedence
    // when non-empty; otherwise fall back to canonical stateTypes.
    if (filters.stateNames.length > 0) {
      if (!filters.stateNames.includes(i.state.name)) return false
    } else if (filters.stateTypes.length > 0) {
      if (!filters.stateTypes.includes(i.state.type)) return false
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
    return true
  })
}
