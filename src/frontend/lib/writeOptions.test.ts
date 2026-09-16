import { describe, expect, it } from 'vitest'
import type { NormalizedIssue, WorkflowState } from '@shared/types.js'
import {
  addableLabels,
  assigneeOptionsFrom,
  labelOptionsFrom,
  matchCurrentState,
  statusOptionsFor,
} from './writeOptions'

function st(over: Partial<WorkflowState> & { name: string }): WorkflowState {
  return { id: `id-${over.name}`, type: 'unstarted', ...over } as WorkflowState
}

function issue(identifier: string, assignee: NormalizedIssue['assignee']): NormalizedIssue {
  return { id: `u-${identifier}`, identifier, assignee } as NormalizedIssue
}

describe('statusOptionsFor', () => {
  const states = [
    st({ name: 'Done', type: 'completed', position: 3, teamKey: 'ENG' }),
    st({ name: 'Todo', position: 1, teamKey: 'ENG' }),
    st({ name: 'Doing', type: 'started', position: 2, teamKey: 'ENG' }),
    st({ name: 'Ops Backlog', type: 'backlog', position: 1, teamKey: 'OPS' }),
  ]

  // The multi-team trap: a state id from another team is not a legal target, so
  // offering one produces a dropdown that looks right and 502s on submit.
  it('keeps only the issue team’s states', () => {
    expect(statusOptionsFor(states, 'ENG').map((s) => s.name)).toEqual(['Todo', 'Doing', 'Done'])
  })

  it('orders by Linear’s position so the dropdown reads in workflow order', () => {
    expect(statusOptionsFor(states, 'ENG').map((s) => s.position)).toEqual([1, 2, 3])
  })

  it('falls back to name for equal positions, so the order is at least stable', () => {
    const tied = [st({ name: 'B', position: 1 }), st({ name: 'A', position: 1 })]
    expect(statusOptionsFor(tied, null).map((s) => s.name)).toEqual(['A', 'B'])
  })

  it('sorts states with no position last rather than first', () => {
    const mixed = [st({ name: 'NoPos' }), st({ name: 'First', position: 1 })]
    expect(statusOptionsFor(mixed, null).map((s) => s.name)).toEqual(['First', 'NoPos'])
  })

  // A single-team workspace does not populate teamKey. Filtering on it there
  // would empty the dropdown entirely.
  it('returns everything when no state carries a teamKey', () => {
    const noTeam = [st({ name: 'Todo' }), st({ name: 'Done', type: 'completed' })]
    expect(statusOptionsFor(noTeam, 'ENG')).toHaveLength(2)
  })

  it('returns everything when the issue has no team', () => {
    expect(statusOptionsFor(states, null)).toHaveLength(4)
  })

  it('does not mutate the input', () => {
    const before = states.map((s) => s.name)
    statusOptionsFor(states, 'ENG')
    expect(states.map((s) => s.name)).toEqual(before)
  })
})

describe('assigneeOptionsFrom', () => {
  it('collects each assignee once, sorted by display name', () => {
    const out = assigneeOptionsFrom([
      issue('A-1', { id: 'u2', displayName: 'Bob' }),
      issue('A-2', { id: 'u1', displayName: 'Alice' }),
      issue('A-3', { id: 'u2', displayName: 'Bob' }),
    ])
    expect(out.map((a) => a.displayName)).toEqual(['Alice', 'Bob'])
  })

  it('skips unassigned issues', () => {
    expect(assigneeOptionsFrom([issue('A-1', null)])).toEqual([])
  })

  // `id` is optional on NormalizedAssignee. An option without one cannot
  // produce an assigneeId, so it would fail only at submit time.
  it('drops an assignee with no id rather than offering an unusable option', () => {
    const out = assigneeOptionsFrom([
      issue('A-1', { displayName: 'Ghost' } as NormalizedIssue['assignee']),
      issue('A-2', { id: 'u1', displayName: 'Alice' }),
    ])
    expect(out.map((a) => a.displayName)).toEqual(['Alice'])
  })

  it('handles an empty cache', () => {
    expect(assigneeOptionsFrom([])).toEqual([])
  })
})

describe('matchCurrentState', () => {
  const options = [
    st({ name: 'Done', type: 'completed' }),
    st({ name: 'Todo', type: 'unstarted' }),
  ]

  it('matches on name and type together', () => {
    expect(matchCurrentState(options, { name: 'Done', type: 'completed' })?.id).toBe('id-Done')
  })

  // Two states can share a name across types; preferring the exact pair first
  // keeps the dropdown from selecting the wrong one.
  it('prefers the exact name+type pair over a name-only match', () => {
    const dupes = [st({ name: 'Review', type: 'started' }), st({ name: 'Review', type: 'unstarted' })]
    expect(matchCurrentState(dupes, { name: 'Review', type: 'unstarted' })?.type).toBe('unstarted')
  })

  it('falls back to a name match when the type has drifted', () => {
    expect(matchCurrentState(options, { name: 'Todo', type: 'backlog' })?.id).toBe('id-Todo')
  })

  // A state renamed upstream since the last sync cannot be matched. Returning
  // null shows no selection, which is honest; guessing would show the wrong one.
  it('returns null rather than guessing when nothing matches', () => {
    expect(matchCurrentState(options, { name: 'Renamed', type: 'started' })).toBeNull()
  })
})

function lbl(id: string, name: string, group?: string) {
  return { id, name, color: '#fff', group: group ? { id: `g-${group}`, name: group } : null }
}
function withLabels(identifier: string, labels: ReturnType<typeof lbl>[]): NormalizedIssue {
  return { id: `u-${identifier}`, identifier, labels } as unknown as NormalizedIssue
}

describe('labelOptionsFrom', () => {
  it('collects each label once across the cache', () => {
    const out = labelOptionsFrom([
      withLabels('A-1', [lbl('l1', 'bug')]),
      withLabels('A-2', [lbl('l1', 'bug'), lbl('l2', 'chore')]),
    ])
    expect(out.map((l) => l.id)).toEqual(['l1', 'l2'])
  })

  // Mirrors how the panel already displays labels, so the dropdown order is
  // not a second, contradictory organisation of the same set.
  it('sorts grouped labels by group first, then name', () => {
    const out = labelOptionsFrom([
      withLabels('A-1', [lbl('l3', 'zeta'), lbl('l1', 'beta', 'Type'), lbl('l2', 'alpha', 'Type')]),
    ])
    expect(out.map((l) => l.name)).toEqual(['zeta', 'alpha', 'beta'])
  })

  it('tolerates issues with no labels at all', () => {
    expect(labelOptionsFrom([withLabels('A-1', [])])).toEqual([])
    expect(labelOptionsFrom([{ identifier: 'A-2' } as NormalizedIssue])).toEqual([])
  })
})

describe('addableLabels', () => {
  const options = [lbl('l1', 'bug'), lbl('l2', 'chore'), lbl('l3', 'docs')]

  // Offering an already-applied label would send a delta that changes nothing
  // and still costs a write plus a sync.
  it('hides labels the issue already has', () => {
    expect(addableLabels(options, [lbl('l2', 'chore')]).map((l) => l.id)).toEqual(['l1', 'l3'])
  })

  it('offers everything when the issue has none', () => {
    expect(addableLabels(options, [])).toHaveLength(3)
    expect(addableLabels(options, undefined)).toHaveLength(3)
  })

  it('offers nothing when the issue already has them all', () => {
    expect(addableLabels(options, options)).toEqual([])
  })
})
