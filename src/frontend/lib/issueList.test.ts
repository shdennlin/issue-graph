import { describe, expect, it } from 'vitest'
import type { NormalizedIssue } from '@shared/types.js'
import {
  assigneeColumnRedundant,
  assigneeInitials,
  buildIssueListRows,
  clampListHeight,
  clampRailWidth,
  LIST_HEIGHT_MIN,
  RAIL_WIDTH_DEFAULT,
  RAIL_WIDTH_MAX,
  RAIL_WIDTH_MIN,
  rowMeta,
} from './issueList'

function mk(identifier: string, over: Partial<NormalizedIssue> = {}): NormalizedIssue {
  return {
    id: identifier,
    identifier,
    title: identifier,
    url: '',
    priority: 0,
    state: { name: 'Todo', type: 'unstarted' },
    assignee: null,
    labels: [],
    parent: null,
    children: [],
    relations: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    completedAt: null,
    ...over,
  } as NormalizedIssue
}

const ids = (rows: NormalizedIssue[]) => rows.map((r) => r.identifier)

describe('buildIssueListRows', () => {
  it('lists only the ids the canvas drew, and drops ids that no longer exist', () => {
    const issues = [mk('ONE-1'), mk('ONE-2'), mk('ONE-3')]
    expect(ids(buildIssueListRows(issues, ['ONE-3', 'ONE-1', 'GONE-9'], 'id'))).toEqual(['ONE-1', 'ONE-3'])
  })

  it('sorts identifiers numerically, not lexically (ONE-9 before ONE-10)', () => {
    const issues = [mk('ONE-10'), mk('ONE-9'), mk('ONE-100')]
    expect(ids(buildIssueListRows(issues, ['ONE-10', 'ONE-9', 'ONE-100'], 'id'))).toEqual(['ONE-9', 'ONE-10', 'ONE-100'])
  })

  it('puts the most recently updated first', () => {
    const issues = [
      mk('A-1', { updatedAt: '2026-03-01T00:00:00.000Z' }),
      mk('A-2', { updatedAt: '2026-05-01T00:00:00.000Z' }),
    ]
    expect(ids(buildIssueListRows(issues, ['A-1', 'A-2'], 'updated'))).toEqual(['A-2', 'A-1'])
  })

  it('ranks "No priority" after Low, not before Urgent', () => {
    const issues = [mk('A-1', { priority: 0 }), mk('A-2', { priority: 4 }), mk('A-3', { priority: 1 })]
    expect(ids(buildIssueListRows(issues, ['A-1', 'A-2', 'A-3'], 'priority'))).toEqual(['A-3', 'A-2', 'A-1'])
  })

  it('orders states as a pipeline', () => {
    const issues = [
      mk('A-1', { state: { name: 'Done', type: 'completed' } }),
      mk('A-2', { state: { name: 'Backlog', type: 'backlog' } }),
      mk('A-3', { state: { name: 'In Progress', type: 'started' } }),
    ]
    expect(ids(buildIssueListRows(issues, ['A-1', 'A-2', 'A-3'], 'state'))).toEqual(['A-2', 'A-3', 'A-1'])
  })

  it('sorts unassigned last', () => {
    const issues = [mk('A-1'), mk('A-2', { assignee: { displayName: 'zed' } }), mk('A-3', { assignee: { displayName: 'amy' } })]
    expect(ids(buildIssueListRows(issues, ['A-1', 'A-2', 'A-3'], 'assignee'))).toEqual(['A-3', 'A-2', 'A-1'])
  })

  it('breaks ties by identifier so equal rows do not reshuffle', () => {
    const issues = [mk('A-3'), mk('A-1'), mk('A-2')]
    expect(ids(buildIssueListRows(issues, ['A-1', 'A-2', 'A-3'], 'priority'))).toEqual(['A-1', 'A-2', 'A-3'])
  })
})

describe('clampRailWidth', () => {
  it('keeps the width inside the limits', () => {
    expect(clampRailWidth(10)).toBe(RAIL_WIDTH_MIN)
    expect(clampRailWidth(9999)).toBe(RAIL_WIDTH_MAX)
    expect(clampRailWidth(333.4)).toBe(333)
  })

  it('falls back to the default for garbage rather than NaN-ing the layout', () => {
    expect(clampRailWidth(Number.NaN)).toBe(RAIL_WIDTH_DEFAULT)
  })
})

describe('clampListHeight', () => {
  it('never goes below the minimum', () => {
    expect(clampListHeight(5, 900)).toBe(LIST_HEIGHT_MIN)
  })

  it('is bounded by the viewport, so a value stored on a bigger screen cannot overflow', () => {
    expect(clampListHeight(5000, 900)).toBe(640)
    expect(clampListHeight(5000, 600)).toBe(340)
  })

  it('still honours the minimum in a tiny window', () => {
    expect(clampListHeight(500, 200)).toBe(LIST_HEIGHT_MIN)
  })
})

const NO_FILTER = { myIssuesOnly: false, assignees: [] as string[] }

describe('assigneeInitials', () => {
  it('takes first and last word for a multi-word name', () => {
    expect(assigneeInitials('Shawn Lin')).toBe('SL')
    expect(assigneeInitials('rex.chueh')).toBe('RC')
    expect(assigneeInitials('Mary Jane Watson')).toBe('MW')
  })

  it('takes the first two characters of a single token', () => {
    expect(assigneeInitials('shawndennislin')).toBe('SH')
    expect(assigneeInitials('a')).toBe('A')
  })

  it('does not split a CJK name through a character', () => {
    expect(assigneeInitials('林肇慶')).toBe('林肇')
    expect(assigneeInitials('𠮷野家')).toBe('𠮷野')
  })

  it('never returns an empty string', () => {
    expect(assigneeInitials('')).toBe('?')
    expect(assigneeInitials(' . - ')).toBe('?')
  })
})

describe('assigneeColumnRedundant', () => {
  it('is redundant for "My issues" and for exactly one assignee', () => {
    expect(assigneeColumnRedundant({ ...NO_FILTER, myIssuesOnly: true })).toBe(true)
    expect(assigneeColumnRedundant({ ...NO_FILTER, assignees: ['amy'] })).toBe(true)
  })

  it('is not redundant with no filter or several assignees', () => {
    expect(assigneeColumnRedundant(NO_FILTER)).toBe(false)
    expect(assigneeColumnRedundant({ ...NO_FILTER, assignees: ['amy', 'bob'] })).toBe(false)
  })

  it('is NOT redundant when the single assignee is excluded — everyone else remains', () => {
    expect(assigneeColumnRedundant({ ...NO_FILTER, assignees: ['amy'], negated: ['assignee'] })).toBe(false)
  })

  it('ignores negation on other facets', () => {
    expect(assigneeColumnRedundant({ ...NO_FILTER, assignees: ['amy'], negated: ['state'] })).toBe(true)
  })
})

describe('rowMeta', () => {
  const issue = mk('A-1', {
    priority: 2,
    state: { name: 'In Review', type: 'started' },
    assignee: { displayName: 'Shawn Lin' },
    updatedAt: '2026-05-01T00:00:00.000Z',
  })

  it('follows the sort key', () => {
    expect(rowMeta(issue, 'updated', NO_FILTER)).toEqual({ kind: 'age', ts: Date.parse('2026-05-01T00:00:00.000Z') })
    expect(rowMeta(issue, 'priority', NO_FILTER)).toEqual({ kind: 'priority', priority: 2 })
    expect(rowMeta(issue, 'state', NO_FILTER)).toEqual({ kind: 'state', name: 'In Review', type: 'started' })
    expect(rowMeta(issue, 'assignee', NO_FILTER)).toEqual({ kind: 'assignee', initials: 'SL', name: 'Shawn Lin' })
  })

  it('shows nothing for the id sort, whose value is already the first column', () => {
    expect(rowMeta(issue, 'id', NO_FILTER)).toBeNull()
  })

  it('marks an unassigned issue rather than leaving the cell blank', () => {
    expect(rowMeta(mk('A-2'), 'assignee', NO_FILTER)).toEqual({ kind: 'unassigned' })
  })

  it('hides the assignee column when the filter pins one person, but not other columns', () => {
    const one = { ...NO_FILTER, assignees: ['Shawn Lin'] }
    expect(rowMeta(issue, 'assignee', one)).toBeNull()
    expect(rowMeta(issue, 'priority', one)).not.toBeNull()
  })

  it('drops the age when updatedAt is unparseable instead of rendering NaN', () => {
    expect(rowMeta(mk('A-3', { updatedAt: 'garbage' }), 'updated', NO_FILTER)).toBeNull()
  })
})
