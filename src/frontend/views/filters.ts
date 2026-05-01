// Shared filter logic across views.

import type { NormalizedIssue } from '@shared/types.js'
import type { Filters } from '../store/viewStore'

export function applyFilters(
  issues: NormalizedIssue[],
  filters: Filters,
  staleDays: number,
  myUserName: string | null,
): NormalizedIssue[] {
  const cutoff = Date.now() - staleDays * 24 * 3600 * 1000
  return issues.filter((i) => {
    if (filters.activeOnly && (i.state.type === 'completed' || i.state.type === 'canceled')) return false
    if (filters.stateTypes.length > 0 && !filters.stateTypes.includes(i.state.type)) return false
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
