import { describe, expect, it } from 'vitest'
import { defaultFilters, type Filters } from './viewStore'
import {
  filterSignatureParts,
  parseFilters,
  serializeFilters,
  type CodecState,
} from './filterCodec'

function state(overrides: Partial<Filters> = {}, search = ''): CodecState {
  return { filters: { ...defaultFilters, ...overrides }, search }
}

function roundTrip(s: CodecState): CodecState {
  return parseFilters(serializeFilters(s))
}

describe('filterCodec round-trip', () => {
  it('empty params produce the default filters', () => {
    expect(parseFilters(new URLSearchParams())).toEqual(state())
  })

  // `state=` is the one param written even at the default, because
  // defaultFilters.stateTypes is a non-empty list and csv() only omits empty
  // ones. Pre-existing buildUrl behavior, preserved deliberately.
  it('writes nothing but the default state list when no filter is set', () => {
    expect([...serializeFilters(state()).keys()]).toEqual(['state'])
  })

  // The regression guard. Every dimension gets a non-default value at once, so
  // a field that is missing from either half of the codec fails here rather
  // than being discovered by a user with a broken shared link.
  it('round-trips every dimension simultaneously', () => {
    const s = state(
      {
        activeOnly: false,
        myIssuesOnly: true,
        staleOnly: true,
        stateTypes: ['started', 'completed'],
        stateNames: ['Review Spec', 'In Progress'],
        primaryValues: ['lab-1', 'lab-2'],
        typeValues: ['type-1'],
        priorities: [1, 3],
        assignees: ['Shawn Lin', '(unassigned)'],
        projectIds: ['proj-1', '__noproject'],
        milestoneIds: ['proj-1::ms-1', 'proj-1::__nomilestone'],
        prefixSelections: { horizon: ['h-1', 'h-2'], affects: ['a-1'] },
        groupSelections: { Risk: ['r-1'] },
        orphanValues: ['orph-1'],
        tagIds: ['tag-1', 'tag-2'],
        designdocFilter: 'missing',
        dueFilter: 'overdue',
        recencyWindow: '7d',
        recencyMode: 'created',
      },
      'auth bug',
    )
    expect(roundTrip(s)).toEqual(s)
  })

  // These four were silently dropped before the codec was extracted:
  // never written by buildUrl, hardcoded to [] by parseUrl.
  const droppedCases: Array<[string, Partial<Filters>, string]> = [
    ['projectIds', { projectIds: ['proj-1'] }, 'proj'],
    ['milestoneIds', { milestoneIds: ['proj-1::ms-1'] }, 'ms'],
    ['stateNames', { stateNames: ['Review Spec'] }, 'sname'],
    ['tagIds', { tagIds: ['tag-1'] }, 'tag'],
    ['recencyWindow', { recencyWindow: '30d' }, 'recent'],
    ['recencyMode', { recencyMode: 'created' }, 'recentby'],
  ]
  it.each(droppedCases)('%s survives the round-trip and writes ?%s', (_name, overrides, param) => {
    const s = state(overrides)
    expect(serializeFilters(s).has(param)).toBe(true)
    expect(roundTrip(s)).toEqual(s)
  })

  it('search round-trips as ?q and clears when the param is absent', () => {
    expect(serializeFilters(state({}, 'hello')).get('q')).toBe('hello')
    expect(roundTrip(state({}, 'hello')).search).toBe('hello')
    // Absent ?q must reset search to '' rather than leaving it stuck —
    // otherwise Back cannot clear a search.
    expect(parseFilters(new URLSearchParams('mine=1')).search).toBe('')
  })

  it('preserves values that need URL encoding', () => {
    const s = state({
      stateNames: ['Review Spec', '待審核'],
      milestoneIds: ['a-b::c-d'],
      prefixSelections: { horizon: ['h 1'] },
    })
    expect(roundTrip(s)).toEqual(s)
  })

  it('falls back to defaults for unrecognized enum values', () => {
    const p = new URLSearchParams(
      'due=nonsense&designdoc=nonsense&state=bogus&recent=nonsense&recentby=nonsense',
    )
    const { filters } = parseFilters(p)
    expect(filters.dueFilter).toBe('any')
    expect(filters.designdocFilter).toBe('all')
    expect(filters.recencyWindow).toBe('any')
    expect(filters.recencyMode).toBe('updated')
    // Unknown state types are filtered out, leaving an empty list.
    expect(filters.stateTypes).toEqual([])
  })

  // Known pre-existing limitation, documented rather than silently accepted:
  // an explicitly-emptied stateTypes selection is indistinguishable from an
  // absent param, so it comes back as the default set. Encoding it would need
  // a sentinel value; out of scope for the codec extraction.
  it('cannot represent an explicitly empty stateTypes selection', () => {
    const s = state({ stateTypes: [] })
    expect(serializeFilters(s).has('state')).toBe(false)
    expect(roundTrip(s).filters.stateTypes).toEqual(defaultFilters.stateTypes)
  })
})

describe('filterSignatureParts', () => {
  it('is stable across selection reordering', () => {
    const a = state({ assignees: ['a', 'b'], projectIds: ['p1', 'p2'] })
    const b = state({ assignees: ['b', 'a'], projectIds: ['p2', 'p1'] })
    expect(filterSignatureParts(a)).toEqual(filterSignatureParts(b))
  })

  // tagIds was in the URL but missing from the signature, so tag-only changes
  // replaced the history entry instead of pushing a new step.
  const sigCases: Array<[string, Partial<Filters>]> = [
    ['milestoneIds', { milestoneIds: ['p::m'] }],
    ['tagIds', { tagIds: ['t-1'] }],
    ['projectIds', { projectIds: ['p-1'] }],
    ['stateNames', { stateNames: ['Review Spec'] }],
    ['recencyWindow', { recencyWindow: 'today' }],
    ['recencyMode', { recencyMode: 'created' }],
  ]
  it.each(sigCases)('changing %s changes the signature', (_name, overrides) => {
    expect(filterSignatureParts(state(overrides))).not.toEqual(filterSignatureParts(state()))
  })

  it('changing search changes the signature', () => {
    expect(filterSignatureParts(state({}, 'x'))).not.toEqual(filterSignatureParts(state()))
  })
})
