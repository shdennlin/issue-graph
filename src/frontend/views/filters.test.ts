import { describe, expect, it } from 'vitest'
import type { NormalizedIssue } from '@shared/types.js'
import type { Filters } from '../store/viewStore'
import { applyFilters, applyFiltersExcluding } from './filters'

function baseFilters(overrides: Partial<Filters> = {}): Filters {
  return {
    stateTypes: [],
    stateNames: [],
    recencyWindow: 'any',
    recencyMode: 'updated',
    negated: [],
    activeOnly: false,
    myIssuesOnly: false,
    staleOnly: false,
    primaryValues: [],
    typeValues: [],
    priorities: [],
    assignees: [],
    prefixSelections: {},
    groupSelections: {},
    orphanValues: [],
    tagIds: [],
    designdocFilter: 'all',
    dueFilter: 'any',
    projectIds: [],
    milestoneIds: [],
    ...overrides,
  }
}

function makeIssue(overrides: Partial<NormalizedIssue> = {}): NormalizedIssue {
  return {
    id: overrides.identifier ?? 'x',
    identifier: overrides.identifier ?? 'X-1',
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

// applyFilters reads "today" from system clock. The cases below use date
// offsets relative to *real* today so they stay correct regardless of when
// the test runs. The bug surface this protects against is "filter logic
// silently uses UTC and gets the wrong day in non-UTC timezones" — and
// that's a property of the helper, tested separately in dueDate.test.ts.
function offsetFromToday(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const da = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${da}`
}

describe('applyFilters · dueFilter', () => {
  const noDue = makeIssue({ identifier: 'A', dueDate: null })
  const pastDue = makeIssue({ identifier: 'B', dueDate: offsetFromToday(-3) })
  const dueToday = makeIssue({ identifier: 'C', dueDate: offsetFromToday(0) })
  const dueIn5 = makeIssue({ identifier: 'D', dueDate: offsetFromToday(5) })
  const dueIn20 = makeIssue({ identifier: 'E', dueDate: offsetFromToday(20) })
  const dueIn90 = makeIssue({ identifier: 'F', dueDate: offsetFromToday(90) })
  const completedPastDue = makeIssue({
    identifier: 'G',
    dueDate: offsetFromToday(-3),
    state: { name: 'Done', type: 'completed' },
  })
  const all = [noDue, pastDue, dueToday, dueIn5, dueIn20, dueIn90, completedPastDue]

  function ids(result: NormalizedIssue[]): string[] {
    return result.map((i) => i.identifier).sort()
  }

  it("'any' is a no-op", () => {
    const out = applyFilters(all, baseFilters({ dueFilter: 'any' }), 365, null)
    expect(out.length).toBe(all.length)
  })

  it("'has' keeps any issue with a dueDate, regardless of state", () => {
    const out = applyFilters(all, baseFilters({ dueFilter: 'has' }), 365, null)
    expect(ids(out)).toEqual(['B', 'C', 'D', 'E', 'F', 'G'])
  })

  it("'overdue' = past due AND actionable (excludes completed/canceled)", () => {
    const out = applyFilters(all, baseFilters({ dueFilter: 'overdue' }), 365, null)
    expect(ids(out)).toEqual(['B'])
  })

  it("'soon7' covers [today, today+7], excludes past-due and >7", () => {
    const out = applyFilters(all, baseFilters({ dueFilter: 'soon7' }), 365, null)
    expect(ids(out)).toEqual(['C', 'D'])
  })

  it("'soon30' covers [today, today+30], excludes past-due and >30", () => {
    const out = applyFilters(all, baseFilters({ dueFilter: 'soon30' }), 365, null)
    expect(ids(out)).toEqual(['C', 'D', 'E'])
  })

  it("'overdue' and 'soon7' partition (no overlap, dueToday belongs to soon7)", () => {
    const overdue = new Set(applyFilters(all, baseFilters({ dueFilter: 'overdue' }), 365, null).map((i) => i.identifier))
    const soon7 = new Set(applyFilters(all, baseFilters({ dueFilter: 'soon7' }), 365, null).map((i) => i.identifier))
    for (const id of overdue) expect(soon7.has(id)).toBe(false)
    expect(soon7.has('C')).toBe(true)
  })
})

describe('applyFilters · label group selections', () => {
  const label = (id: string, name: string, group?: string) => ({
    id,
    name,
    color: '#000',
    group: group ? { id: `g-${group}`, name: group } : null,
  })
  const ios = label('1', 'iOS', 'Platform')
  const android = label('2', 'Android', 'Platform')
  const triage = label('3', 'needs-triage')
  const flaky = label('4', 'flaky')

  const all = [
    makeIssue({ identifier: 'A', labels: [ios, triage] }),
    makeIssue({ identifier: 'B', labels: [android] }),
    makeIssue({ identifier: 'C', labels: [ios, flaky] }),
    makeIssue({ identifier: 'D', labels: [] }),
  ]
  const ids = (out: NormalizedIssue[]) => out.map((i) => i.identifier)

  it('keeps issues carrying any selected label within a group (OR)', () => {
    const out = applyFilters(all, baseFilters({ groupSelections: { Platform: ['1', '2'] } }), 365, null)
    expect(ids(out)).toEqual(['A', 'B', 'C'])
  })

  it('requires a match in every group that has a selection (AND)', () => {
    const out = applyFilters(
      all,
      baseFilters({ groupSelections: { Platform: ['1'], Severity: ['99'] } }),
      365,
      null,
    )
    expect(ids(out)).toEqual([])
  })

  it('ignores a group whose selection is empty', () => {
    const out = applyFilters(all, baseFilters({ groupSelections: { Platform: [] } }), 365, null)
    expect(ids(out)).toEqual(['A', 'B', 'C', 'D'])
  })

  it('filters by orphan label ids', () => {
    const out = applyFilters(all, baseFilters({ orphanValues: ['3', '4'] }), 365, null)
    expect(ids(out)).toEqual(['A', 'C'])
  })

  it('ANDs orphan selection with group selection', () => {
    const out = applyFilters(
      all,
      baseFilters({ groupSelections: { Platform: ['1'] }, orphanValues: ['4'] }),
      365,
      null,
    )
    expect(ids(out)).toEqual(['C'])
  })

  it('tolerates snapshots persisted before these filters existed', () => {
    const legacy = baseFilters()
    delete (legacy as Partial<Filters>).groupSelections
    delete (legacy as Partial<Filters>).orphanValues
    expect(ids(applyFilters(all, legacy, 365, null))).toEqual(['A', 'B', 'C', 'D'])
  })
})

// The filter panel counts every label from ONE leave-one-out pass, so that
// pass has to drop all five label dimensions at once. Dropping only 'primary'
// (as it used to) makes an exclusive group unusable: picking "iOS" drives the
// count next to "Android" to 0, hiding the option the user wants to switch to.
describe("applyFiltersExcluding · 'label'", () => {
  const label = (id: string, name: string, group?: string) => ({
    id,
    name,
    color: '#000',
    group: group ? { id: `g-${group}`, name: group } : null,
  })
  const ios = label('1', 'iOS', 'Platform')
  const android = label('2', 'Android', 'Platform')
  const bug = label('3', 'Bug', 'Type')
  const triage = label('4', 'needs-triage')

  const all = [
    makeIssue({ identifier: 'A', labels: [ios, bug] }),
    makeIssue({ identifier: 'B', labels: [android, triage] }),
  ]
  const ids = (out: NormalizedIssue[]) => out.map((i) => i.identifier)

  it('clears group, orphan, primary, type and prefix selections together', () => {
    const f = baseFilters({
      groupSelections: { Platform: ['1'] },
      orphanValues: ['4'],
      primaryValues: ['1'],
      typeValues: ['3'],
      prefixSelections: { env: ['99'] },
    })
    expect(ids(applyFilters(all, f, 365, null))).toEqual([])
    expect(ids(applyFiltersExcluding(all, f, 365, null, undefined, 'label'))).toEqual(['A', 'B'])
  })

  it('leaves non-label dimensions applied', () => {
    const f = baseFilters({ groupSelections: { Platform: ['1'] }, assignees: ['nobody'] })
    expect(ids(applyFiltersExcluding(all, f, 365, null, undefined, 'label'))).toEqual([])
  })
})

describe('recency filter', () => {
  // applyFilters reads the clock internally, so these use offsets from real
  // "now". Boundary precision is covered exhaustively in recency.test.ts
  // against a fixed clock; here we only prove the wiring.
  const isoDaysAgo = (days: number) => new Date(Date.now() - days * 86400_000).toISOString()

  const fresh = makeIssue({
    identifier: 'FRESH',
    createdAt: isoDaysAgo(200),
    updatedAt: isoDaysAgo(1),
  })
  const old = makeIssue({
    identifier: 'OLD',
    createdAt: isoDaysAgo(200),
    updatedAt: isoDaysAgo(200),
  })
  const bornToday = makeIssue({
    identifier: 'NEW',
    createdAt: isoDaysAgo(0),
    updatedAt: isoDaysAgo(0),
  })
  const all = [fresh, old, bornToday]
  const ids = (out: NormalizedIssue[]) => out.map((i) => i.identifier)

  it('is off at the default window', () => {
    expect(ids(applyFilters(all, baseFilters(), 365, null))).toEqual(['FRESH', 'OLD', 'NEW'])
  })

  it('keeps only recently updated issues in updated mode', () => {
    const f = baseFilters({ recencyWindow: '7d', recencyMode: 'updated' })
    expect(ids(applyFilters(all, f, 365, null))).toEqual(['FRESH', 'NEW'])
  })

  it('keeps only recently created issues in created mode', () => {
    // FRESH was created long ago but touched yesterday — the distinction the
    // two modes exist for.
    const f = baseFilters({ recencyWindow: '7d', recencyMode: 'created' })
    expect(ids(applyFilters(all, f, 365, null))).toEqual(['NEW'])
  })

  it('excludes the window but keeps other dimensions when excluding "time"', () => {
    const f = baseFilters({ recencyWindow: '7d', priorities: [9] })
    expect(ids(applyFiltersExcluding(all, f, 365, null, undefined, 'time'))).toEqual([])
    const g = baseFilters({ recencyWindow: '7d' })
    expect(ids(applyFiltersExcluding(all, g, 365, null, undefined, 'time'))).toEqual([
      'FRESH',
      'OLD',
      'NEW',
    ])
  })
})

describe('negated facets', () => {
  const a = makeIssue({
    identifier: 'A',
    state: { name: 'In Progress', type: 'started' },
    priority: 1,
    assignee: { displayName: 'shawn' },
    labels: [{ id: 'l1', name: 'Bug', color: '#f00', group: null }],
    project: { id: 'p1', name: 'Core' },
  })
  const b = makeIssue({
    identifier: 'B',
    state: { name: 'Todo', type: 'unstarted' },
    priority: 2,
    assignee: null,
    labels: [{ id: 'l2', name: 'Chore', color: '#0f0', group: null }],
    project: { id: 'p2', name: 'Side' },
  })
  const all = [a, b]
  const ids = (out: NormalizedIssue[]) => out.map((i) => i.identifier)

  it('inverts a state selection', () => {
    const f = baseFilters({ stateTypes: ['started'] })
    expect(ids(applyFilters(all, f, 365, null))).toEqual(['A'])
    expect(ids(applyFilters(all, { ...f, negated: ['state'] }, 365, null))).toEqual(['B'])
  })

  it.each([
    ['priority', { priorities: [1] }, 'priority'],
    ['assignee', { assignees: ['shawn'] }, 'assignee'],
    ['primary label', { primaryValues: ['l1'] }, 'primary'],
    ['orphan label', { orphanValues: ['l1'] }, 'orphan'],
    ['project', { projectIds: ['p1'] }, 'project'],
  ] as [string, Partial<Filters>, string][])('inverts %s', (_name, sel, facetId) => {
    const f = baseFilters(sel)
    expect(ids(applyFilters(all, f, 365, null))).toEqual(['A'])
    expect(ids(applyFilters(all, { ...f, negated: [facetId] }, 365, null))).toEqual(['B'])
  })

  it('inverts a dynamic prefix group by its composed id', () => {
    const f = baseFilters({ prefixSelections: { horizon: ['l1'] } })
    expect(ids(applyFilters(all, f, 365, null))).toEqual(['A'])
    expect(
      ids(applyFilters(all, { ...f, negated: ['prefix:horizon'] }, 365, null)),
    ).toEqual(['B'])
  })

  it('negates only the named facet, leaving the others positive', () => {
    const f = baseFilters({ priorities: [1], assignees: ['shawn'], negated: ['priority'] })
    // priority NOT 1 excludes A; assignee IS shawn excludes B. Nothing left.
    expect(ids(applyFilters(all, f, 365, null))).toEqual([])
  })

  // "Not in the empty set" matches everything, which is the same as no filter —
  // so a negation with nothing selected must not hide anything.
  it('is inert when the dimension has no selection', () => {
    const f = baseFilters({ negated: ['priority', 'assignee', 'state'] })
    expect(ids(applyFilters(all, f, 365, null))).toEqual(['A', 'B'])
  })

  // "Not in these milestones" is true of an issue that is in no milestone at
  // all, so a project-less issue passes under negation rather than being
  // dropped by the milestone guard.
  it('keeps project-less issues when a milestone selection is negated', () => {
    const loose = makeIssue({ identifier: 'C' })
    const f = baseFilters({ milestoneIds: ['p1::m1'], negated: ['project'] })
    expect(ids(applyFilters([a, loose], f, 365, null))).toEqual(['A', 'C'])
  })

  it('tolerates a tab snapshot written before the field existed', () => {
    const legacy = { ...baseFilters({ priorities: [1] }) } as Filters
    delete (legacy as Partial<Filters>).negated
    expect(ids(applyFilters(all, legacy, 365, null))).toEqual(['A'])
  })
})
