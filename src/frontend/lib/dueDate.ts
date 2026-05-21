// Date helpers + predicates for `NormalizedIssue.dueDate`. Extracted once a
// third caller appeared (IssueNode chip, DetailPanel row, filter logic) —
// the rule across these is "active actionable issues only", so consolidating
// keeps the semantics aligned across surfaces.

import type { NormalizedIssue } from '@shared/types.js'

/** Local-date "YYYY-MM-DD". Avoids UTC drift that `new Date().toISOString()`
 *  would introduce for users in tz where local-midnight is yesterday-UTC. */
export function todayDateKey(now: Date = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** Add N days to a "YYYY-MM-DD" key. Uses Date arithmetic for month/year
 *  rollover, but anchors to local-noon so DST transitions can't push a day
 *  backwards or forwards. */
export function addDaysToDateKey(key: string, days: number): string {
  const parts = key.split('-').map(Number)
  const y = parts[0] ?? new Date().getFullYear()
  const m = parts[1] ?? 1
  const d = parts[2] ?? 1
  const dt = new Date(y, m - 1, d, 12, 0, 0)
  dt.setDate(dt.getDate() + days)
  return todayDateKey(dt)
}

/** Active = not yet shipped or dropped. Once an issue is completed/canceled
 *  its `dueDate` is moot — overdue/soon predicates exclude these so the
 *  card chip color and the filter results stay in sync. */
function isActionable(issue: NormalizedIssue): boolean {
  return issue.state.type !== 'completed' && issue.state.type !== 'canceled'
}

/** Past due AND still actionable. Equality with today is *not* overdue —
 *  it's "due today", which falls under `isDueWithin(_, 0)` semantics. */
export function isOverdueIssue(issue: NormalizedIssue, today: string = todayDateKey()): boolean {
  if (!issue.dueDate) return false
  if (!isActionable(issue)) return false
  return issue.dueDate < today
}

/** Within the next `days` calendar days (inclusive of today and `today+days`)
 *  AND still actionable. `days=7` answers "due this week"; `days=0` answers
 *  "due today". Past-due issues are NOT included (use `isOverdueIssue` for
 *  that) so the two predicates partition rather than overlap. */
export function isDueWithin(
  issue: NormalizedIssue,
  days: number,
  today: string = todayDateKey(),
): boolean {
  if (!issue.dueDate) return false
  if (!isActionable(issue)) return false
  if (issue.dueDate < today) return false
  const cutoff = addDaysToDateKey(today, days)
  return issue.dueDate <= cutoff
}
