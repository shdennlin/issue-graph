import { describe, expect, it } from 'vitest'
import type { NormalizedIssue } from '@shared/types.js'
import { addDaysToDateKey, isDueWithin, isOverdueIssue, todayDateKey } from './dueDate'

function makeIssue(overrides: Partial<NormalizedIssue> = {}): NormalizedIssue {
  return {
    id: 'x',
    identifier: 'X-1',
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

describe('todayDateKey', () => {
  it('formats local date as YYYY-MM-DD with zero padding', () => {
    // Pick a known local date — months/days < 10 are the bug surface (the
    // pad-with-zero step). Using local-noon to dodge any DST nuance.
    const d = new Date(2026, 2, 5, 12, 0, 0) // March 5, 2026 local
    expect(todayDateKey(d)).toBe('2026-03-05')
  })
})

describe('addDaysToDateKey', () => {
  it('handles month rollover', () => {
    expect(addDaysToDateKey('2026-01-30', 5)).toBe('2026-02-04')
  })
  it('handles year rollover', () => {
    expect(addDaysToDateKey('2026-12-30', 3)).toBe('2027-01-02')
  })
  it('handles negative offsets', () => {
    expect(addDaysToDateKey('2026-03-01', -1)).toBe('2026-02-28')
  })
})

describe('isOverdueIssue', () => {
  const today = '2026-05-21'

  it('returns true when dueDate is strictly before today and issue is actionable', () => {
    expect(isOverdueIssue(makeIssue({ dueDate: '2026-05-20' }), today)).toBe(true)
  })

  it('returns false when dueDate equals today (today is "due", not "overdue")', () => {
    expect(isOverdueIssue(makeIssue({ dueDate: '2026-05-21' }), today)).toBe(false)
  })

  it('returns false when dueDate is in the future', () => {
    expect(isOverdueIssue(makeIssue({ dueDate: '2026-06-01' }), today)).toBe(false)
  })

  it('returns false for completed issues even when past due', () => {
    expect(
      isOverdueIssue(
        makeIssue({ dueDate: '2026-05-01', state: { name: 'Done', type: 'completed' } }),
        today,
      ),
    ).toBe(false)
  })

  it('returns false for canceled issues even when past due', () => {
    expect(
      isOverdueIssue(
        makeIssue({ dueDate: '2026-05-01', state: { name: 'Canceled', type: 'canceled' } }),
        today,
      ),
    ).toBe(false)
  })

  it('returns false when dueDate is absent', () => {
    expect(isOverdueIssue(makeIssue({ dueDate: null }), today)).toBe(false)
    expect(isOverdueIssue(makeIssue({ /* dueDate omitted */ }), today)).toBe(false)
  })
})

describe('isDueWithin', () => {
  const today = '2026-05-21'

  it('includes today (boundary)', () => {
    expect(isDueWithin(makeIssue({ dueDate: '2026-05-21' }), 7, today)).toBe(true)
  })

  it('includes today + N (boundary)', () => {
    expect(isDueWithin(makeIssue({ dueDate: '2026-05-28' }), 7, today)).toBe(true)
  })

  it('excludes today + N + 1', () => {
    expect(isDueWithin(makeIssue({ dueDate: '2026-05-29' }), 7, today)).toBe(false)
  })

  it('excludes past-due (overdue is a separate predicate)', () => {
    expect(isDueWithin(makeIssue({ dueDate: '2026-05-20' }), 7, today)).toBe(false)
  })

  it('excludes completed issues even within window', () => {
    expect(
      isDueWithin(
        makeIssue({ dueDate: '2026-05-22', state: { name: 'Done', type: 'completed' } }),
        7,
        today,
      ),
    ).toBe(false)
  })

  it('returns false when dueDate is absent', () => {
    expect(isDueWithin(makeIssue({ dueDate: null }), 7, today)).toBe(false)
  })
})
