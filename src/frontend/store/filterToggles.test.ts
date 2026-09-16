// Pure node — no DOM needed, because that is the point of this module: the
// toggle semantics used to be reachable only by driving a zustand store, and
// the notification-scope editor needed them against a plain draft object.

import { describe, expect, it } from 'vitest'
import type { FacetDef, FacetKind, FacetSelection } from '../components/facets/facetModel'
import { defaultFilters, type Filters } from './viewStore'
import { applyFacetPick, toggle, toggleStateType } from './filterToggles'

/** A facet stub. `applyFacetPick` only ever reads `kind` and `id`, so the
 *  option list is left empty rather than mocked — a fixture carrying data the
 *  code cannot see would imply a coupling that does not exist. */
function facet(kind: FacetKind, id: string = kind, selection: FacetSelection = 'multi'): FacetDef {
  return { id, kind, group: 'attribute', selection, title: id, options: [] }
}

/** Start from a genuinely empty filter set. `defaultFilters` constrains at its
 *  default (four of six state types), which is fine for the cascade tests below
 *  but would hide an off-by-one in the plain add/remove cases. */
const empty: Filters = { ...defaultFilters, stateTypes: [] }

describe('toggle', () => {
  it('adds a missing value and removes a present one', () => {
    expect(toggle(['a'], 'b')).toEqual(['a', 'b'])
    expect(toggle(['a', 'b'], 'a')).toEqual(['b'])
  })

  it('does not mutate its input', () => {
    const arr = ['a']
    toggle(arr, 'b')
    expect(arr).toEqual(['a'])
  })
})

describe('applyFacetPick — each kind toggles on and then off', () => {
  // value, then the Filters key to read the result back out of. Driving every
  // dimension through one table is what makes "a new FacetKind has no test" a
  // visible omission rather than a silent one.
  const cases: { kind: FacetKind; id?: string; value: string; read: (f: Filters) => unknown }[] = [
    { kind: 'state', value: 'completed', read: (f) => f.stateTypes },
    { kind: 'primary', value: 'lab1', read: (f) => f.primaryValues },
    { kind: 'type', value: 'lab2', read: (f) => f.typeValues },
    { kind: 'priority', value: '2', read: (f) => f.priorities },
    { kind: 'assignee', value: 'Ada', read: (f) => f.assignees },
    { kind: 'project', value: 'proj1', read: (f) => f.projectIds },
    { kind: 'orphan', value: 'lab3', read: (f) => f.orphanValues },
  ]

  for (const c of cases) {
    it(`${c.kind}: on then off`, () => {
      const on = applyFacetPick(empty, facet(c.kind, c.id), c.value, false)
      expect(c.read(on)).toHaveLength(1)
      const off = applyFacetPick(on, facet(c.kind, c.id), c.value, false)
      expect(c.read(off)).toHaveLength(0)
    })
  }

  it('quick:mine and quick:stale flip their own boolean only', () => {
    const mine = applyFacetPick(empty, facet('quick', 'quick:mine', 'toggle'), '', false)
    expect(mine.myIssuesOnly).toBe(true)
    expect(mine.staleOnly).toBe(false)
    expect(applyFacetPick(mine, facet('quick', 'quick:mine', 'toggle'), '', false).myIssuesOnly).toBe(false)

    const stale = applyFacetPick(empty, facet('quick', 'quick:stale', 'toggle'), '', false)
    expect(stale.staleOnly).toBe(true)
    expect(stale.myIssuesOnly).toBe(false)
  })

  // The three assigning facets. Re-picking does NOT clear — their option lists
  // carry an explicit neutral row instead, and that row is the way back out.
  it('designdoc / due / time assign rather than toggle', () => {
    const dd = applyFacetPick(empty, facet('designdoc', 'designdoc', 'single'), 'missing', false)
    expect(dd.designdocFilter).toBe('missing')
    expect(applyFacetPick(dd, facet('designdoc', 'designdoc', 'single'), 'missing', false).designdocFilter).toBe('missing')
    expect(applyFacetPick(dd, facet('designdoc', 'designdoc', 'single'), 'all', false).designdocFilter).toBe('all')

    expect(applyFacetPick(empty, facet('due', 'due', 'single'), 'overdue', false).dueFilter).toBe('overdue')
    expect(applyFacetPick(empty, facet('time', 'time', 'single'), '7d', false).recencyWindow).toBe('7d')
  })
})

describe('applyFacetPick — the state cascade', () => {
  it('unchecking a type drops that type’s names and no others', () => {
    const start: Filters = {
      ...empty,
      stateTypes: ['started', 'completed'],
      stateNames: ['started::In Progress', 'completed::Done', 'completed::Shipped'],
    }
    const next = applyFacetPick(start, facet('state'), 'completed', false)
    expect(next.stateTypes).toEqual(['started'])
    expect(next.stateNames).toEqual(['started::In Progress'])
  })

  it('checking a type on leaves every name alone', () => {
    const start: Filters = {
      ...empty,
      stateTypes: ['started'],
      stateNames: ['started::In Progress'],
    }
    const next = applyFacetPick(start, facet('state'), 'completed', false)
    expect(next.stateTypes).toEqual(['started', 'completed'])
    expect(next.stateNames).toEqual(['started::In Progress'])
  })

  it('a child pick toggles the name and leaves the type list untouched', () => {
    const start: Filters = { ...empty, stateTypes: ['started'] }
    const on = applyFacetPick(start, facet('state'), 'started::In Review', true)
    expect(on.stateNames).toEqual(['started::In Review'])
    expect(on.stateTypes).toEqual(['started'])
    expect(applyFacetPick(on, facet('state'), 'started::In Review', true).stateNames).toEqual([])
  })

  it('toggleStateType is a no-op on names when the type was not selected to begin with', () => {
    // Guards the `removingType` condition: toggling an absent type ADDS it, so
    // the name-dropping branch must not run. Reading `!next.includes(t)` alone
    // would have been true here too — and would have wiped the names.
    const start: Filters = { ...empty, stateTypes: [], stateNames: ['canceled::Duplicate'] }
    const next = toggleStateType(start, 'canceled')
    expect(next.stateTypes).toEqual(['canceled'])
    expect(next.stateNames).toEqual(['canceled::Duplicate'])
  })
})

describe('applyFacetPick — values that look falsy', () => {
  it('priority 0 is a real selection, not a clear', () => {
    // 'No priority' is a value the user picks. A `Number(value) || undefined`
    // or a truthiness guard anywhere on this path makes it unselectable.
    const on = applyFacetPick(empty, facet('priority'), '0', false)
    expect(on.priorities).toEqual([0])
    expect(applyFacetPick(on, facet('priority'), '0', false).priorities).toEqual([])
  })
})

describe('applyFacetPick — keyed dimensions', () => {
  it('prefix stores under the token from the facet id, not the id itself', () => {
    const next = applyFacetPick(empty, facet('prefix', 'prefix:horizon'), 'lab1', false)
    expect(next.prefixSelections).toEqual({ horizon: ['lab1'] })
    expect(next.groupSelections).toEqual({})
  })

  it('group stores under the group name and leaves other groups alone', () => {
    const start = applyFacetPick(empty, facet('group', 'group:Risk'), 'lab1', false)
    const next = applyFacetPick(start, facet('group', 'group:Area'), 'lab2', false)
    expect(next.groupSelections).toEqual({ Risk: ['lab1'], Area: ['lab2'] })
  })

  it('a token containing a colon survives — only the first segment is the prefix', () => {
    // Facet ids are '<kind>:<key>' and label tokens are the workspace's own
    // names, so a key with a colon in it must not be truncated.
    const next = applyFacetPick(empty, facet('prefix', 'prefix:a:b'), 'lab1', false)
    expect(next.prefixSelections).toEqual({ 'a:b': ['lab1'] })
  })
})

describe('applyFacetPick — project vs milestone', () => {
  it('a parent pick hits projectIds and a child pick hits milestoneIds', () => {
    const proj = applyFacetPick(empty, facet('project'), 'p1', false)
    expect(proj.projectIds).toEqual(['p1'])
    expect(proj.milestoneIds).toEqual([])

    const ms = applyFacetPick(proj, facet('project'), 'p1::m1', true)
    expect(ms.milestoneIds).toEqual(['p1::m1'])
    // The parent stays selected. milestoneIds takes precedence in applyFilters,
    // but clearing the project here would make un-picking the milestone land
    // somewhere the user never was.
    expect(ms.projectIds).toEqual(['p1'])
  })
})

describe('applyFacetPick — purity', () => {
  it('never mutates the filters it is given', () => {
    const start: Filters = {
      ...empty,
      stateTypes: ['started'],
      stateNames: ['started::In Progress'],
      prefixSelections: { horizon: ['lab1'] },
    }
    const snapshot = JSON.stringify(start)
    applyFacetPick(start, facet('state'), 'started', false)
    applyFacetPick(start, facet('prefix', 'prefix:horizon'), 'lab2', false)
    applyFacetPick(start, facet('quick', 'quick:mine', 'toggle'), '', false)
    expect(JSON.stringify(start)).toBe(snapshot)
  })
})
