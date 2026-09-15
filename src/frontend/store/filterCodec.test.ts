import { describe, expect, it } from 'vitest'
import { defaultFilters, type Filters } from './viewStore'
import {
  filterSignatureParts,
  hasFilterParams,
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
        designdocFilter: 'missing',
        dueFilter: 'overdue',
        recencyWindow: '7d',
        recencyMode: 'created',
        negated: ['state', 'prefix:horizon'],
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
    ['recencyWindow', { recencyWindow: '30d' }, 'recent'],
    ['a typed recency span', { recencyWindow: '6h' }, 'recent'],
    ['recencyMode', { recencyMode: 'created' }, 'recentby'],
    ['negated', { negated: ['assignee'] }, 'neg'],
    // Written when OFF, because it defaults to on — see the note in
    // serializeFilters. The test names the departure, not the value.
    ['recencyIgnoreLinked turned off', { recencyIgnoreLinked: false }, 'recentlinks'],
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

  const sigCases: Array<[string, Partial<Filters>]> = [
    ['milestoneIds', { milestoneIds: ['p::m'] }],
    ['projectIds', { projectIds: ['p-1'] }],
    ['stateNames', { stateNames: ['Review Spec'] }],
    ['recencyWindow', { recencyWindow: 'today' }],
    ['recencyMode', { recencyMode: 'created' }],
    ['negated', { negated: ['state'] }],
  ]
  it.each(sigCases)('changing %s changes the signature', (_name, overrides) => {
    expect(filterSignatureParts(state(overrides))).not.toEqual(filterSignatureParts(state()))
  })

  it('changing search changes the signature', () => {
    expect(filterSignatureParts(state({}, 'x'))).not.toEqual(filterSignatureParts(state()))
  })
})

describe('negated facets in the URL', () => {
  it('round-trips a facet id containing a colon', () => {
    // prefix:/group: ids carry ':' — URLSearchParams encodes it as %3A, so it
    // survives, but the codec must not split on it.
    const s = state({ negated: ['prefix:horizon', 'group:Risk'] })
    expect(roundTrip(s).filters.negated).toEqual(['prefix:horizon', 'group:Risk'])
  })

  it('omits the param entirely when nothing is negated', () => {
    expect(serializeFilters(state()).has('neg')).toBe(false)
  })

  // Absent means "no negation", not "keep whatever was there" — the same rule
  // every other dimension follows, and what makes Back able to clear it.
  it('resets to [] when the param is absent', () => {
    expect(parseFilters(new URLSearchParams('mine=1')).filters.negated).toEqual([])
  })
})

describe('recency windows in the URL', () => {
  // Pattern-validated rather than whitelisted, so a span the UI never offers
  // still survives a shared link.
  it.each(['1h', '6h', '24h', '3d', '90d', 'today'])('round-trips %s', (w) => {
    const s = state({ recencyWindow: w as Filters['recencyWindow'] })
    expect(roundTrip(s).filters.recencyWindow).toBe(w)
  })

  it.each(['7w', '1.5h', '-2d', '0d', 'nonsense'])('falls back to any for %s', (raw) => {
    expect(parseFilters(new URLSearchParams(`recent=${raw}`)).filters.recencyWindow).toBe('any')
  })
})

describe('recencyIgnoreLinked defaults the other way round', () => {
  it('stays out of the URL while it holds its default', () => {
    // Its default is `true`, which CONSTRAINS. Writing it at the default
    // would stamp `recentlinks` into every link ever shared — the mistake
    // `state=` made, and the reason this param spells the opt-out.
    const params = serializeFilters(state({ recencyIgnoreLinked: true }))
    expect(params.has('recentlinks')).toBe(false)
  })

  it('reads a link written before the param existed as opted in', () => {
    expect(parseFilters(new URLSearchParams('recent=7d')).filters.recencyIgnoreLinked).toBe(true)
  })

  it('is a significant change, so Back steps over it', () => {
    const on = filterSignatureParts(state({ recencyIgnoreLinked: true }))
    const off = filterSignatureParts(state({ recencyIgnoreLinked: false }))
    expect(on).not.toEqual(off)
  })
})

// The gate urlSync's preserveFiltersOnFocus reads. It decides whether a
// `?focus=` URL is a bare deep link (Raycast / protocol handler — keep the
// user's filters) or a link the app itself produced (URL wins, so a shared
// link renders the same for sender and recipient).
describe('hasFilterParams', () => {
  it('says no for a bare Raycast-style deep link', () => {
    expect(hasFilterParams(new URLSearchParams('w=eng&focus=ENG-1&detail=1'))).toBe(false)
  })

  it('says no for the non-filter params that share the query string', () => {
    const nonFilter = 'w=eng&view=milestone&chain=ENG-1&cdu=2&cdd=1&related=1&hier=1'
      + '&theme=dark&density=compact&mixby=label&expand=a,b&notes=1&note=3&detail=1'
    expect(hasFilterParams(new URLSearchParams(nonFilter))).toBe(false)
  })

  // The load-bearing half: `state=` is written at the default too, so an
  // otherwise-unfiltered URL from the app still trips this — which is what
  // keeps shared links authoritative.
  it('says yes for a default URL, on the strength of state= alone', () => {
    expect(hasFilterParams(serializeFilters(state()))).toBe(true)
  })

  // The documented blind spot. csv([]) omits the param, so "every state
  // unchecked and nothing else set" serializes to nothing and reads as bare.
  // The consequence is non-destructive — a follower keeps their own filters
  // rather than having them cleared — so this pins the behavior rather than
  // asserting it is desirable.
  it('cannot see an emptied state list', () => {
    expect(hasFilterParams(serializeFilters(state({ stateTypes: [] })))).toBe(false)
    // Any other dimension is enough to make it visible again.
    expect(hasFilterParams(serializeFilters(state({ stateTypes: [], assignees: ['me'] })))).toBe(true)
  })

  // 'active=0' is deliberately not in this list: it was the removed activeOnly
  // boolean's param, nothing parses it now, so a URL carrying only that carries
  // no filter. Pinned as its own case below.
  it.each([
    'mine=1', 'stale=1', 'state=started', 'sname=started::Todo',
    'bucket=a', 'type=b', 'priority=1', 'assignee=me', 'proj=p', 'ms=p::m',
    'label=x', 'designdoc=has', 'due=overdue', 'recent=7d', 'recentby=created',
    'recentlinks=1', 'neg=assignee', 'q=hello',
    'pfx_horizon=now', 'grp_area=core',
  ])('detects %s', (qs) => {
    expect(hasFilterParams(new URLSearchParams(`focus=ENG-1&${qs}`))).toBe(true)
  })

  // Guards against a new dimension being added to serializeFilters without
  // being registered here — the failure mode would be silent: a shared link
  // carrying only that dimension would be treated as bare and discarded.
  it('covers every param serializeFilters can write', () => {
    const everything = serializeFilters(state({
      myIssuesOnly: true, staleOnly: true,
      stateTypes: ['started'], stateNames: ['started::Todo'],
      primaryValues: ['a'], typeValues: ['b'], priorities: [1], assignees: ['me'],
      projectIds: ['p'], milestoneIds: ['p::m'],
      prefixSelections: { horizon: ['now'] }, groupSelections: { area: ['core'] },
      orphanValues: ['x'], designdocFilter: 'has', dueFilter: 'overdue',
      recencyWindow: '7d', recencyMode: 'created', recencyIgnoreLinked: false,
      negated: ['assignee'],
    }, 'hello'))
    for (const key of everything.keys()) {
      const one = new URLSearchParams()
      one.set(key, everything.get(key) as string)
      expect(hasFilterParams(one), `unregistered filter param: ${key}`).toBe(true)
    }
  })
})

// `active` was the URL half of the removed `activeOnly` boolean. Links, saved
// views and tab snapshots written before the removal still carry it, so the
// parser has to meet them without complaint — and must never write it again.
describe('the retired `active` param', () => {
  it('is never serialized', () => {
    expect(serializeFilters(state({ stateTypes: ['completed'] })).has('active')).toBe(false)
  })

  // The symptom this whole change exists to remove: a URL naming an archival
  // state used to parse into a filter set that matched nothing at all.
  it('parses an archival state URL into exactly that state', () => {
    expect(parseFilters(new URLSearchParams('state=completed')).filters.stateTypes).toEqual([
      'completed',
    ])
  })

  it('ignores an old link that still carries it, rather than failing', () => {
    const f = parseFilters(new URLSearchParams('active=0&state=completed')).filters
    expect(f.stateTypes).toEqual(['completed'])
    expect('activeOnly' in f).toBe(false)
  })

  // The deep-link path asks "does this URL say anything about filters?" to
  // decide whether to restore the tab's own. A dead param must not answer yes,
  // or an old bookmark would suppress the restore and silently reset them.
  it('does not count as a filter param on its own', () => {
    expect(hasFilterParams(new URLSearchParams('active=0'))).toBe(false)
    expect(hasFilterParams(new URLSearchParams('active=0&state=completed'))).toBe(true)
  })
})
