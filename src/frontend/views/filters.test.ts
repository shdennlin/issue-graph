import { describe, expect, it } from 'vitest'
import type { NormalizedIssue } from '@shared/types.js'
import type { Filters } from '../store/viewStore'
import { applyFilters } from './filters'

function baseFilters(overrides: Partial<Filters> = {}): Filters {
  return {
    stateTypes: [],
    stateNames: [],
    activeOnly: false,
    myIssuesOnly: false,
    staleOnly: false,
    primaryValues: [],
    typeValues: [],
    priorities: [],
    assignees: [],
    prefixSelections: {},
    tagIds: [],
    designdocFilter: 'all',
    dueFilter: 'any',
    projectIds: [],
    milestoneIds: [],
    ...overrides,
  }
}

function makeIssue(overrides: Partial<NormalizedIssue> = {}): NormalizedIssue {
  return {
    id: overrides.identifier ?? 'x',
    identifier: overrides.identifier ?? 'X-1',
    title: 't',
    url: 'u',
    priority: 0,
    state: { name: 'In Progress', type: 'started' },
    assignee: null,
    labels: [],
    parent: null,
    children: [],
    relations: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    completedAt: null,
    ...overrides,
  }
}

// applyFilters reads "today" from system clock. The cases below use date
// offsets relative to *real* today so they stay correct regardless of when
// the test runs. The bug surface this protects against is "filter logic
// silently uses UTC and gets the wrong day in non-UTC timezones" — and
// that's a property of the helper, tested separately in dueDate.test.ts.
function offsetFromToday(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const da = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${da}`
}

describe('applyFilters · dueFilter', () => {
  const noDue = makeIssue({ identifier: 'A', dueDate: null })
  const pastDue = makeIssue({ identifier: 'B', dueDate: offsetFromToday(-3) })
  const dueToday = makeIssue({ identifier: 'C', dueDate: offsetFromToday(0) })
  const dueIn5 = makeIssue({ identifier: 'D', dueDate: offsetFromToday(5) })
  const dueIn20 = makeIssue({ identifier: 'E', dueDate: offsetFromToday(20) })
  const dueIn90 = makeIssue({ identifier: 'F', dueDate: offsetFromToday(90) })
  const completedPastDue = makeIssue({
    identifier: 'G',
    dueDate: offsetFromToday(-3),
    state: { name: 'Done', type: 'completed' },
  })
  const all = [noDue, pastDue, dueToday, dueIn5, dueIn20, dueIn90, completedPastDue]

  function ids(result: NormalizedIssue[]): string[] {
    return result.map((i) => i.identifier).sort()
  }

  it("'any' is a no-op", () => {
    const out = applyFilters(all, baseFilters({ dueFilter: 'any' }), 365, null)
    expect(out.length).toBe(all.length)
  })

  it("'has' keeps any issue with a dueDate, regardless of state", () => {
    const out = applyFilters(all, baseFilters({ dueFilter: 'has' }), 365, null)
    expect(ids(out)).toEqual(['B', 'C', 'D', 'E', 'F', 'G'])
  })

  it("'overdue' = past due AND actionable (excludes completed/canceled)", () => {
    const out = applyFilters(all, baseFilters({ dueFilter: 'overdue' }), 365, null)
    expect(ids(out)).toEqual(['B'])
  })

  it("'soon7' covers [today, today+7], excludes past-due and >7", () => {
    const out = applyFilters(all, baseFilters({ dueFilter: 'soon7' }), 365, null)
    expect(ids(out)).toEqual(['C', 'D'])
  })

  it("'soon30' covers [today, today+30], excludes past-due and >30", () => {
    const out = applyFilters(all, baseFilters({ dueFilter: 'soon30' }), 365, null)
    expect(ids(out)).toEqual(['C', 'D', 'E'])
  })

  it("'overdue' and 'soon7' partition (no overlap, dueToday belongs to soon7)", () => {
    const overdue = new Set(applyFilters(all, baseFilters({ dueFilter: 'overdue' }), 365, null).map((i) => i.identifier))
    const soon7 = new Set(applyFilters(all, baseFilters({ dueFilter: 'soon7' }), 365, null).map((i) => i.identifier))
    for (const id of overdue) expect(soon7.has(id)).toBe(false)
    expect(soon7.has('C')).toBe(true)
  })
})
