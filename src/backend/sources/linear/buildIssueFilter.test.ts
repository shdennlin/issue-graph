import { describe, expect, it } from 'vitest'
import { buildIssueFilter } from './index.js'

describe('buildIssueFilter', () => {
  it('returns undefined for scope=all with no team / no cursor', () => {
    expect(buildIssueFilter('all')).toBeUndefined()
  })

  it('passes teamId through on scope=all', () => {
    const f = buildIssueFilter('all', 'team-1')
    expect(f).toEqual({ team: { id: { eq: 'team-1' } } })
  })

  it('uses a single state filter (no OR) on plain scope=active', () => {
    const f = buildIssueFilter('active') as Record<string, unknown>
    expect(f.or).toBeUndefined()
    expect(f.state).toEqual({ type: { in: ['backlog', 'unstarted', 'started', 'triage'] } })
  })

  it('uses OR clauses on scope=active+recent so completed-within-30d issues are included', () => {
    const f = buildIssueFilter('active+recent') as Record<string, unknown>
    const clauses = f.or as Array<Record<string, unknown>>
    expect(clauses.length).toBe(2)
    expect(clauses[0]).toHaveProperty('state')
    expect(clauses[1]).toHaveProperty('and')
  })

  it('adds top-level updatedAt:gt when a cursor is provided (incremental sync)', () => {
    const f = buildIssueFilter('active+recent', undefined, 0, '2026-05-20T09:32:00.000Z') as Record<
      string,
      unknown
    >
    expect(f.updatedAt).toEqual({ gt: '2026-05-20T09:32:00.000Z' })
    // The cursor ANDs at the top level with the existing scope OR — both
    // must coexist for incremental sync to honor the scope.
    expect(f.or).toBeDefined()
  })

  it('lets the cursor compose with scope=all (the lone constraint when no team)', () => {
    const f = buildIssueFilter('all', undefined, 0, '2026-05-20T00:00:00.000Z')
    expect(f).toEqual({ updatedAt: { gt: '2026-05-20T00:00:00.000Z' } })
  })

  it('preserves the extendedDays canceled+completed clauses alongside the cursor', () => {
    const f = buildIssueFilter('active+recent', 'team-1', 90, '2026-05-01T00:00:00.000Z') as Record<
      string,
      unknown
    >
    const clauses = f.or as Array<Record<string, unknown>>
    // base active + recent-completed + canceled-extended + completed-extended.
    expect(clauses.length).toBe(4)
    expect(f.updatedAt).toEqual({ gt: '2026-05-01T00:00:00.000Z' })
    expect(f.team).toEqual({ id: { eq: 'team-1' } })
  })

  it('omits updatedAt when the cursor is undefined (full-fetch path)', () => {
    const f = buildIssueFilter('active+recent', 'team-1', 0, undefined) as Record<string, unknown>
    expect(f.updatedAt).toBeUndefined()
  })
})
