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
  selectedValues,
  type BuildFacetsInput,
  type FacetDef,
} from './facetModel'

// Identity translator: returns the key path, so assertions read as the key
// that would be looked up rather than a locale string that could drift.
const t = ((k: string) => k) as BuildFacetsInput['t']

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
    expect(started?.children?.[0]).toMatchObject({ value: 'In Progress', count: 3 })
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
  it('stateNames shadows stateTypes when non-empty', () => {
    const f = byId(buildFacets(input()), 'state')
    expect(selectedValues(filters({ stateTypes: ['started'] }), f)).toEqual(['started'])
    expect(
      selectedValues(filters({ stateTypes: ['started'], stateNames: ['Review Spec'] }), f),
    ).toEqual(['Review Spec'])
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

  it('renders no chips at the default filter state', () => {
    // The whole premise of the bar: an unused dimension takes zero space.
    expect(chipsFromFilters(defaultFilters, facets, t, defaultFilters)).toEqual([])
  })

  // activeOnly defaults to TRUE, so its chip must appear when it is FALSE.
  // Getting this backwards would show a chip permanently and hide the one
  // state the user actually needs to notice.
  it('shows the activeOnly chip only when it is switched OFF', () => {
    expect(chipsFromFilters(filters({ activeOnly: true }), facets, t, defaultFilters)).toEqual([])
    const chips = chipsFromFilters(filters({ activeOnly: false }), facets, t, defaultFilters)
    expect(chips).toHaveLength(1)
    expect(chips[0]?.title).toBe('filterPanel.includingDone')
  })

  it('summarizes one value by its label and many by a count', () => {
    const one = chipsFromFilters(filters({ dueFilter: 'overdue' }), facets, t, defaultFilters)
    expect(one[0]?.summary).toBe('filterPanel.dueDateOverdue')
    const many = chipsFromFilters(filters({ priorities: [1, 2, 3] }), facets, t, defaultFilters)
    expect(many[0]?.summary).toBe('3')
    expect(many[0]?.selectedCount).toBe(3)
  })

  it('emits one chip per active facet', () => {
    const chips = chipsFromFilters(
      filters({ priorities: [1], dueFilter: 'overdue', myIssuesOnly: true }),
      facets,
      t,
      defaultFilters,
    )
    expect(chips.map((c) => c.facetId).sort()).toEqual(['due', 'priority', 'quick:mine'])
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
