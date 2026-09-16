import { describe, expect, it } from 'vitest'
import type { NormalizedIssue } from '@shared/types.js'
import { diffIssues } from './issueDiff'
import { gateChanges, parseScope } from './notificationScope'

function makeIssue(overrides: Partial<NormalizedIssue> = {}): NormalizedIssue {
  return {
    id: overrides.identifier ?? 'x',
    identifier: 'ENG-1',
    title: 'Title',
    url: 'about:blank',
    priority: 2,
    state: { name: 'Todo', type: 'unstarted' },
    assignee: null,
    labels: [],
    parent: null,
    children: [],
    relations: [],
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    completedAt: null,
    ...overrides,
  }
}

const ctx = { staleDays: 14, myUserName: null }

function ids(changes: ReturnType<typeof gateChanges>): string[] {
  return changes.map((c) => c.identifier).sort()
}

describe('parseScope', () => {
  it('resolves an empty or blank query to null, not to default filters', () => {
    // Load-bearing: defaultFilters.stateTypes is four of six types, so a
    // "default" scope would silently swallow every move into Completed.
    expect(parseScope('')).toBeNull()
    expect(parseScope('   ')).toBeNull()
  })

  it('resolves a real query to filters', () => {
    const scope = parseScope('proj=p1')
    expect(scope).not.toBeNull()
    expect(scope?.filters.projectIds).toEqual(['p1'])
  })
})

describe('gateChanges — no scope', () => {
  it('passes everything through when scope is null', () => {
    const before = makeIssue({ identifier: 'ENG-1', project: { id: 'p1', name: 'A' } })
    const after = makeIssue({
      identifier: 'ENG-1',
      project: { id: 'p1', name: 'A' },
      state: { name: 'Done', type: 'completed' },
    })
    const other = makeIssue({ identifier: 'ENG-2', project: { id: 'p2', name: 'B' } })
    const changes = diffIssues([before, other], [after, other])
    expect(ids(gateChanges(changes, null, [before, other], [after, other], ctx))).toEqual(['ENG-1'])
  })
})

describe('gateChanges — project scope', () => {
  const inScope = { id: 'p1', name: 'A' }
  const outScope = { id: 'p2', name: 'B' }

  it('keeps a change inside the scope and drops one outside it', () => {
    const a1 = makeIssue({ identifier: 'ENG-1', project: inScope })
    const a2 = makeIssue({ identifier: 'ENG-1', project: inScope, priority: 1 })
    const b1 = makeIssue({ identifier: 'ENG-2', project: outScope })
    const b2 = makeIssue({ identifier: 'ENG-2', project: outScope, priority: 1 })

    const prev = [a1, b1]
    const next = [a2, b2]
    const changes = diffIssues(prev, next)
    expect(ids(changes)).toEqual(['ENG-1', 'ENG-2'])

    const scope = parseScope('proj=p1')
    expect(ids(gateChanges(changes, scope, prev, next, ctx))).toEqual(['ENG-1'])
  })

  it('keeps an issue that moved INTO the scope', () => {
    const before = makeIssue({ identifier: 'ENG-1', project: outScope, priority: 2 })
    const after = makeIssue({ identifier: 'ENG-1', project: inScope, priority: 1 })
    const changes = diffIssues([before], [after])
    const scope = parseScope('proj=p1')
    expect(ids(gateChanges(changes, scope, [before], [after], ctx))).toEqual(['ENG-1'])
  })

  it('keeps an issue that moved OUT of the scope', () => {
    // The "before or after" rule — testing only the new state would drop this.
    const before = makeIssue({ identifier: 'ENG-1', project: inScope, priority: 2 })
    const after = makeIssue({ identifier: 'ENG-1', project: outScope, priority: 1 })
    const changes = diffIssues([before], [after])
    const scope = parseScope('proj=p1')
    expect(ids(gateChanges(changes, scope, [before], [after], ctx))).toEqual(['ENG-1'])
  })
})

describe('gateChanges — the state-default trap', () => {
  it('still reports an issue the agent marked Completed under a default state scope', () => {
    // This is the regression the whole "before OR after" rule exists for.
    // `state=` at its default excludes completed, so an issue moving to Done
    // leaves the scope — and testing only the new state would report nothing,
    // losing the single most notable event in an agent-review notification.
    const before = makeIssue({
      identifier: 'ENG-1',
      project: { id: 'p1', name: 'A' },
      state: { name: 'Todo', type: 'unstarted' },
    })
    const after = makeIssue({
      identifier: 'ENG-1',
      project: { id: 'p1', name: 'A' },
      state: { name: 'Done', type: 'completed' },
      completedAt: '2026-09-10T00:00:00.000Z',
    })

    const scope = parseScope('proj=p1')
    // Sanity: the new state really is outside the scope's state list.
    expect(scope?.filters.stateTypes).not.toContain('completed')

    const changes = diffIssues([before], [after])
    expect(ids(gateChanges(changes, scope, [before], [after], ctx))).toEqual(['ENG-1'])
  })
})

describe('gateChanges — creation', () => {
  it('keeps a newly created issue inside the scope', () => {
    const existing = makeIssue({ identifier: 'ENG-1', project: { id: 'p1', name: 'A' } })
    const fresh = makeIssue({ identifier: 'ENG-2', project: { id: 'p1', name: 'A' } })
    const changes = diffIssues([existing], [existing, fresh])
    const scope = parseScope('proj=p1')
    expect(ids(gateChanges(changes, scope, [existing], [existing, fresh], ctx))).toEqual(['ENG-2'])
  })

  it('drops a newly created issue outside the scope', () => {
    const existing = makeIssue({ identifier: 'ENG-1', project: { id: 'p1', name: 'A' } })
    const fresh = makeIssue({ identifier: 'ENG-2', project: { id: 'p2', name: 'B' } })
    const changes = diffIssues([existing], [existing, fresh])
    const scope = parseScope('proj=p1')
    expect(gateChanges(changes, scope, [existing], [existing, fresh], ctx)).toHaveLength(0)
  })
})

describe('gateChanges — short circuits', () => {
  it('returns empty without filtering when there are no changes', () => {
    expect(gateChanges([], parseScope('proj=p1'), [], [], ctx)).toEqual([])
  })
})
