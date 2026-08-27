import { describe, expect, it } from 'vitest'
import type { IssueStateType } from '@shared/types.js'
import { defaultFilters, type Filters } from '../../store/viewStore'
import {
  ASSIGNEE_LIMIT,
  NO_PROJECT_TOKEN,
  UNASSIGNED_TOKEN,
  buildFacets,
  chipsFromFilters,
  clearFacetPatch,
  isNegated,
  toggleNegated,
  locateOption,
  orderByOptions,
  partitionPinned,
  searchFacetValues,
  selectedValues,
  toggleValue,
  type BuildFacetsInput,
  type FacetDef,
} from './facetModel'

// Near-identity translator: returns the key path (so assertions read as the
// key that would be looked up, not a locale string that could drift) plus any
// interpolated params, so count-bearing strings stay checkable.
const t = ((k: string, p?: Record<string, string | number>) =>
  p ? `${k}:${Object.values(p).join(',')}` : k) as BuildFacetsInput['t']

const EMPTY_STATE_NAMES = {
  backlog: [], unstarted: [], started: [], completed: [], canceled: [], triage: [],
} as Record<IssueStateType, never[]>

function input(over: Partial<BuildFacetsInput> = {}): BuildFacetsInput {
  return {
    filters: defaultFilters,
    t,
    schema: { primaryGroup: null, typeGroup: null, prefixes: [] },
    primaryGroupSingular: null,
    counts: {
      byState: {},
      byPrio: {},
      byAssignee: new Map(),
      byLabel: new Map(),
    },
    stateNamesByType: EMPTY_STATE_NAMES,
    primaryLabels: [],
    typeLabels: [],
    otherLabelSections: [],
    prefixSections: [],
    assignees: [],
    projectsWithMilestones: [],
    stateColor: () => null,
    stateLabel: (s) => s,
    showDesigndocFilter: false,
    showDueFilter: false,
    ...over,
  }
}

const ids = (f: FacetDef[]) => f.map((x) => x.id)
const byId = (f: FacetDef[], id: string) => {
  const hit = f.find((x) => x.id === id)
  if (!hit) throw new Error(`no facet ${id}`)
  return hit
}
const filters = (over: Partial<Filters> = {}): Filters => ({ ...defaultFilters, ...over })

describe('buildFacets — conditional facets cost zero space', () => {
  it('omits every conditional facet when there is nothing to show', () => {
    expect(ids(buildFacets(input()))).toEqual([
      'quick:active',
      'quick:mine',
      'quick:stale',
      'state',
      'priority',
      'assignee',
      'time',
    ])
  })

  it('adds primary/type only when the schema surfaced labels', () => {
    const f = buildFacets(
      input({
        schema: { primaryGroup: 'Horizon', typeGroup: 'Kind', prefixes: [] },
        primaryLabels: [{ id: 'l1', name: 'active' }],
        typeLabels: [{ id: 'l2', name: 'Bug' }],
      }),
    )
    expect(ids(f)).toContain('primary')
    expect(ids(f)).toContain('type')
  })

  it('adds designdoc and due only when gated on', () => {
    const f = buildFacets(input({ showDesigndocFilter: true, showDueFilter: true }))
    expect(ids(f)).toContain('designdoc')
    expect(ids(f)).toContain('due')
  })

  it('always offers the time facet — every issue has createdAt/updatedAt', () => {
    expect(ids(buildFacets(input()))).toContain('time')
  })
})

describe('buildFacets — details that would silently regress', () => {
  it('caps the assignee list and leaves (unassigned) as a canonical token', () => {
    const many: [string, number][] = Array.from({ length: 40 }, (_, i) => [`user-${i}`, 1])
    many.unshift([UNASSIGNED_TOKEN, 9])
    const facet = byId(buildFacets(input({ assignees: many })), 'assignee')
    expect(facet.options).toHaveLength(ASSIGNEE_LIMIT)
    // The stored value stays canonical; only the display label is translated.
    expect(facet.options[0]?.value).toBe(UNASSIGNED_TOKEN)
    expect(facet.options[0]?.label).toBe('common.unassigned')
  })

  it('titles prefix facets with the literal token, not an i18n key', () => {
    const f = buildFacets(
      input({ prefixSections: [{ token: 'horizon', labels: [{ id: 'a', name: 'active' }] }] }),
    )
    expect(byId(f, 'prefix:horizon').title).toBe('horizon:')
  })

  it('marks exclusive label groups as single-select and others as multi', () => {
    const f = buildFacets(
      input({
        otherLabelSections: [
          { kind: 'group', key: 'Risk', exclusive: true, labels: [{ id: 'r1', name: 'high' }] },
          { kind: 'group', key: 'Area', exclusive: false, labels: [{ id: 'a1', name: 'api' }] },
          { kind: 'orphan', key: 'orphan', labels: [{ id: 'o1', name: 'misc' }] },
        ],
      }),
    )
    expect(byId(f, 'group:Risk').selection).toBe('single')
    expect(byId(f, 'group:Area').selection).toBe('multi')
    expect(byId(f, 'orphan:orphan').kind).toBe('orphan')
  })

  it('nests state names under their canonical type', () => {
    const f = buildFacets(
      input({
        stateNamesByType: {
          ...EMPTY_STATE_NAMES,
          started: [{ name: 'In Progress', count: 3, position: 1 }],
        } as never,
      }),
    )
    const started = byId(f, 'state').options.find((o) => o.value === 'started')
    // Composite key: the child carries its own type so applyFilters can tell
    // which branch a name refines without a lookup table.
    expect(started?.children?.[0]).toMatchObject({ value: 'started::In Progress', count: 3 })
  })

  it('nests milestones under projects and keeps the no-project token', () => {
    const f = buildFacets(
      input({
        projectsWithMilestones: [
          {
            projId: 'p1',
            name: 'Core',
            color: '#f00',
            count: 5,
            children: [{ key: 'p1::m1', milestoneId: 'm1', name: 'M1', sortOrder: 1, count: 2 }],
          },
          { projId: NO_PROJECT_TOKEN, name: '(No project)', color: null, count: 1, children: [] },
        ],
      }),
    )
    const opts = byId(f, 'project').options
    expect(opts[0]?.children?.[0]?.value).toBe('p1::m1')
    expect(opts[1]?.label).toBe('common.noProject')
  })
})

describe('selectedValues — shadowing rules match applyFilters', () => {
  // Both levels are checked at once: a type selects its branch, a name refines
  // within it. Returning only the names made the tree look mutually exclusive,
  // blanking every parent checkbox the moment a child was picked.
  it('reports state types and names together', () => {
    const f = byId(buildFacets(input()), 'state')
    expect(selectedValues(filters({ stateTypes: ['started'] }), f)).toEqual(['started'])
    expect(
      selectedValues(
        filters({ stateTypes: ['started'], stateNames: ['unstarted::Review Spec'] }),
        f,
      ),
    ).toEqual(['started', 'unstarted::Review Spec'])
  })

  it('milestoneIds shadows projectIds when non-empty', () => {
    const f = byId(
      buildFacets(
        input({
          projectsWithMilestones: [
            { projId: 'p1', name: 'Core', color: null, count: 1, children: [] },
          ],
        }),
      ),
      'project',
    )
    expect(selectedValues(filters({ projectIds: ['p1'] }), f)).toEqual(['p1'])
    expect(selectedValues(filters({ projectIds: ['p1'], milestoneIds: ['p1::m1'] }), f)).toEqual([
      'p1::m1',
    ])
  })
})

describe('chipsFromFilters', () => {
  const facets = buildFacets(input({ showDueFilter: true }))

  const chipFor = (f: Filters, id: string) =>
    chipsFromFilters(f, facets, t).find((c) => c.facetId === id)

  // Chips key off "is this excluding anything", not "is this non-default".
  // Two defaults here are not neutral: activeOnly starts TRUE and stateTypes
  // starts as four of six types, so a default panel is hiding a third of the
  // state space. Showing nothing claimed otherwise.
  it('shows the constraints that are live at the default filter state', () => {
    expect(chipsFromFilters(defaultFilters, facets, t).map((c) => c.facetId).sort()).toEqual([
      'quick:active',
      'state',
    ])
  })

  it('drops the activeOnly chip once it stops excluding anything', () => {
    expect(chipFor(filters({ activeOnly: false }), 'quick:active')).toBeUndefined()
    const on = chipFor(filters({ activeOnly: true }), 'quick:active')
    // A boolean has no operator or value — the title carries the whole meaning.
    expect(on?.operator).toBeNull()
  })

  it('drops the state chip when every type is selected', () => {
    const all: Filters['stateTypes'] = [
      'started', 'unstarted', 'backlog', 'triage', 'completed', 'canceled',
    ]
    expect(chipFor(filters({ stateTypes: all }), 'state')).toBeUndefined()
  })

  // A facet that genuinely does nothing still costs no space.
  it('shows no chip for a facet with an empty selection', () => {
    expect(chipFor(defaultFilters, 'priority')).toBeUndefined()
    expect(chipFor(defaultFilters, 'due')).toBeUndefined()
  })

  it('summarizes one value by its label and many by a count', () => {
    const one = chipFor(filters({ dueFilter: 'overdue' }), 'due')
    expect(one?.summary).toBe('filterPanel.dueDateOverdue')
    expect(one?.operator).toBe('is')
    // Shows what is applied, not just how much — a bare count made you open
    // the menu to learn what the chip was already there to tell you.
    const many = chipFor(filters({ priorities: [1, 2, 3] }), 'priority')
    expect(many?.summary).toBe('filterPanel.chipPlusMore:filterPanel.priorityUrgent,2')
    expect(many?.selectedCount).toBe(3)
    // Multi-select facets match ANY of their values; saying so removes the
    // ambiguity in a chip that just reads "Priority 3".
    expect(many?.operator).toBe('isAnyOf')
  })

  it('emits one chip per active facet', () => {
    const chips = chipsFromFilters(
      filters({ priorities: [1], dueFilter: 'overdue', myIssuesOnly: true }),
      facets,
      t,
    )
    // quick:active and state are present too — both constrain at their
    // defaults, which is exactly what the default-state test above pins down.
    expect(chips.map((c) => c.facetId).sort()).toEqual([
      'due', 'priority', 'quick:active', 'quick:mine', 'state',
    ])
  })
})

describe('clearFacetPatch', () => {
  const facets = buildFacets(
    input({
      showDueFilter: true,
      prefixSections: [{ token: 'horizon', labels: [{ id: 'h1', name: 'active' }] }],
      projectsWithMilestones: [
        { projId: 'p1', name: 'Core', color: null, count: 1, children: [] },
      ],
    }),
  )

  // Both of these clear TWO fields, because one shadows the other. Clearing
  // only the shadowing field would leave a filter applied that no chip shows.
  it('clears both stateNames and stateTypes', () => {
    const patch = clearFacetPatch(byId(facets, 'state'), filters(), defaultFilters)
    expect(patch).toEqual({ stateTypes: defaultFilters.stateTypes, stateNames: [] })
  })

  it('clears both projectIds and milestoneIds', () => {
    const patch = clearFacetPatch(byId(facets, 'project'), filters(), defaultFilters)
    expect(patch).toEqual({ projectIds: [], milestoneIds: [] })
  })

  it('restores activeOnly to its true default rather than false', () => {
    expect(clearFacetPatch(byId(facets, 'quick:active'), filters(), defaultFilters)).toEqual({
      activeOnly: true,
    })
  })

  it('empties only the cleared prefix group, preserving its siblings', () => {
    const f = filters({ prefixSelections: { horizon: ['h1'], affects: ['a1'] } })
    expect(clearFacetPatch(byId(facets, 'prefix:horizon'), f, defaultFilters)).toEqual({
      prefixSelections: { horizon: [], affects: ['a1'] },
    })
  })

  it('resets both recency fields', () => {
    expect(clearFacetPatch(byId(facets, 'time'), filters(), defaultFilters)).toEqual({
      recencyWindow: 'any',
      recencyMode: 'updated',
    })
  })
})

describe('partitionPinned', () => {
  const facets = buildFacets(input({ showDueFilter: true }))
  const due = byId(facets, 'due')

  it('floats pinned options above the rest, preserving relative order', () => {
    const { pinned, rest } = partitionPinned(due, [{ facetId: 'due', value: 'overdue' }])
    expect(pinned.map((o) => o.value)).toEqual(['overdue'])
    expect(rest.map((o) => o.value)).toEqual(['any', 'has', 'soon7', 'soon30'])
  })

  it('leaves the list untouched when nothing is pinned for this facet', () => {
    // A pin belonging to another facet must not reorder this one.
    const { pinned, rest } = partitionPinned(due, [{ facetId: 'priority', value: '1' }])
    expect(pinned).toEqual([])
    expect(rest).toBe(due.options)
  })

  // Dropped at render, never pruned from storage: a value can be absent merely
  // because a sync is in flight.
  it('ignores a pin whose value no longer exists', () => {
    const { pinned, rest } = partitionPinned(due, [{ facetId: 'due', value: 'gone' }])
    expect(pinned).toEqual([])
    expect(rest).toHaveLength(due.options.length)
  })

  // Hoisting a child away from the parent that gives it meaning would be worse
  // than leaving it in place, so only top-level options float.
  it('does not hoist a pinned child out of its parent', () => {
    const withProjects = buildFacets(
      input({
        projectsWithMilestones: [
          {
            projId: 'p1', name: 'Core', color: null, count: 1,
            children: [{ key: 'p1::m1', milestoneId: 'm1', name: 'M1', sortOrder: 1, count: 2 }],
          },
        ],
      }),
    )
    const project = byId(withProjects, 'project')
    const { pinned } = partitionPinned(project, [{ facetId: 'project', value: 'p1::m1' }])
    expect(pinned).toEqual([])
  })
})

describe('searchFacetValues', () => {
  const facets = buildFacets(
    input({
      schema: { primaryGroup: 'Horizon', typeGroup: 'Kind', prefixes: [] },
      typeLabels: [
        { id: 't1', name: 'Bug' },
        { id: 't2', name: 'Chore' },
      ],
      projectsWithMilestones: [
        {
          projId: 'p1', name: 'Core', color: null, count: 1,
          children: [{ key: 'p1::m1', milestoneId: 'm1', name: 'Beta', sortOrder: 1, count: 2 }],
        },
      ],
    }),
  )
  // Substring stand-in for the real fuzzy scorer — the ranking function is
  // injected precisely so this suite doesn't depend on its tuning.
  const score = (q: string, text: string) =>
    text.toLowerCase().includes(q.toLowerCase()) ? text.length : null

  it('finds a value without knowing which dimension it lives under', () => {
    const hits = searchFacetValues(facets, 'bug', score, 10)
    expect(hits.map((h) => h.option.label)).toContain('Bug')
  })

  it('reaches nested children and reports their parent', () => {
    const hits = searchFacetValues(facets, 'Beta', score, 10)
    expect(hits[0]).toMatchObject({ isChild: true, parentValue: 'p1' })
  })

  it('returns nothing for an empty query', () => {
    expect(searchFacetValues(facets, '   ', score, 10)).toEqual([])
  })

  // Unbounded results defeat the purpose: a two-letter query matches most of a
  // large workspace, and a list you must scroll is no faster than the nested
  // menu it replaced.
  it('caps the result count', () => {
    const many = buildFacets(
      input({
        assignees: Array.from({ length: 40 }, (_, i) => [`user-${i}`, 1] as [string, number]),
      }),
    )
    expect(searchFacetValues(many, 'user', score, 12)).toHaveLength(12)
  })
})

describe('locateOption', () => {
  const facets = buildFacets(
    input({
      projectsWithMilestones: [
        {
          projId: 'p1', name: 'Core', color: null, count: 1,
          children: [{ key: 'p1::m1', milestoneId: 'm1', name: 'M1', sortOrder: 1, count: 2 }],
        },
      ],
    }),
  )
  const project = byId(facets, 'project')

  // The parent's value is what tells a caller which toggle action applies —
  // a milestone and a project are different actions on the same facet.
  it('reports a top-level option as not-a-child', () => {
    expect(locateOption(project, 'p1')).toMatchObject({ isChild: false })
    expect(locateOption(project, 'p1')?.parentValue).toBeUndefined()
  })

  it('reports a nested option with its parent value', () => {
    expect(locateOption(project, 'p1::m1')).toMatchObject({ isChild: true, parentValue: 'p1' })
  })

  it('returns null for a value that is not in the facet', () => {
    expect(locateOption(project, 'nope')).toBeNull()
  })
})

describe('toggleValue', () => {
  const facets = buildFacets(input())
  const active = byId(facets, 'quick:active')

  // activeOnly defaults to TRUE, so "away from default" and "switched on" are
  // opposite for this one facet. Reading the checkbox off selectedValues
  // ticked "Active only" at the exact moment it had been switched off.
  it('reports the real boolean, not the away-from-default signal', () => {
    expect(toggleValue(filters({ activeOnly: true }), active)).toBe(true)
    expect(toggleValue(filters({ activeOnly: false }), active)).toBe(false)
    expect(selectedValues(filters({ activeOnly: false }), active)).toHaveLength(1)
  })

  it('reads through for the facets whose default is false', () => {
    expect(toggleValue(filters({ myIssuesOnly: true }), byId(facets, 'quick:mine'))).toBe(true)
    expect(toggleValue(filters({ staleOnly: true }), byId(facets, 'quick:stale'))).toBe(true)
    expect(toggleValue(defaultFilters, byId(facets, 'quick:stale'))).toBe(false)
  })
})

describe('negation', () => {
  const facets = buildFacets(input({ showDueFilter: true }))
  const state = byId(facets, 'state')
  const due = byId(facets, 'due')

  it('reports a multi facet as negated when its id is listed', () => {
    expect(isNegated(filters({ negated: ['state'] }), state)).toBe(true)
    expect(isNegated(defaultFilters, state)).toBe(false)
  })

  // Negating a boolean is a double negative; a single-select enum's negation
  // is already expressible by picking the other values.
  it('refuses to negate a single-select facet even if listed', () => {
    expect(isNegated(filters({ negated: ['due'] }), due)).toBe(false)
  })

  it('toggles an id on and off', () => {
    expect(toggleNegated(defaultFilters, state)).toEqual(['state'])
    expect(toggleNegated(filters({ negated: ['state'] }), state)).toEqual([])
  })

  it('leaves other negated facets alone when toggling one', () => {
    const f = filters({ negated: ['assignee', 'state'] })
    expect(toggleNegated(f, state)).toEqual(['assignee'])
  })

  it('renders the inverted operator on the chip', () => {
    const f = filters({ stateTypes: ['started'], negated: ['state'] })
    // Found by id, not [0]: quick:active constrains at its default, so it is
    // legitimately first in the list.
    const chip = chipsFromFilters(f, facets, t).find((c) => c.facetId === 'state')
    expect(chip?.operator).toBe('isNotAnyOf')
  })

  // An "is not" left parked on a facet with nothing selected is invisible, and
  // would silently flip meaning the next time a value was picked.
  it('drops the negation when the facet is cleared', () => {
    const f = filters({ stateTypes: ['started'], negated: ['state', 'assignee'] })
    expect(clearFacetPatch(state, f, defaultFilters).negated).toEqual(['assignee'])
  })

  it('leaves the negated list untouched when clearing a facet that has none', () => {
    const f = filters({ negated: ['assignee'] })
    expect(clearFacetPatch(state, f, defaultFilters).negated).toBeUndefined()
  })
})

describe('orderByOptions', () => {
  const facets = buildFacets(input({ showDueFilter: true }))
  const due = byId(facets, 'due')

  // Filters store selections in toggle order, which is an artefact of how they
  // were clicked: unchecking and rechecking one moves it to the end. The chip
  // would then silently change which value it named.
  it('sorts by list position, not by when each was picked', () => {
    expect(orderByOptions(due, ['soon30', 'has', 'any'])).toEqual(['any', 'has', 'soon30'])
  })

  it('ranks a child by its position under its parent', () => {
    const withState = buildFacets(
      input({
        stateNamesByType: {
          ...EMPTY_STATE_NAMES,
          started: [{ name: 'In Progress', count: 1, position: 1 }],
        } as never,
      }),
    )
    const state = byId(withState, 'state')
    // 'started' is the first option; its child follows immediately, ahead of
    // the next top-level type.
    expect(orderByOptions(state, ['unstarted', 'started::In Progress', 'started'])).toEqual([
      'started',
      'started::In Progress',
      'unstarted',
    ])
  })

  // A stale id or a bare legacy state name must survive rather than vanish
  // from the chip's count.
  it('keeps unknown values, in their original order, at the end', () => {
    expect(orderByOptions(due, ['ghost', 'has', 'other'])).toEqual(['has', 'ghost', 'other'])
  })
})
