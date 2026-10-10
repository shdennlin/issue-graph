import { describe, expect, it } from 'vitest'
import type { NormalizedIssue, NormalizedLabel } from '@shared/types.js'
import { defaultFilters, type Filters } from '../store/viewStore'
import { buildNameLookup, describeScope } from './describeScope'

// Echoes the key back, so an assertion names the key rather than a translation
// that could change without the behaviour changing.
const t = ((k: string) => k) as Parameters<typeof describeScope>[2]
const locale = 'en' as const

function f(over: Partial<Filters> = {}): Filters {
  return { ...defaultFilters, ...over }
}

function label(id: string, name: string): NormalizedLabel {
  return { id, name, color: '#000000', group: null }
}

const noNames = buildNameLookup([], [])

function dims(lines: ReturnType<typeof describeScope>): string[] {
  return lines.map((l) => l.label)
}

describe('describeScope — what counts as constraining', () => {
  it('says nothing about a scope at its defaults except the state list', () => {
    // stateTypes defaults to four of six, which DOES constrain — the panel has
    // to say so, or it claims to report on a third of the state space it drops.
    expect(dims(describeScope(f(), noNames, t, locale))).toEqual(['filterPanel.state'])
  })

  it('stays silent about state when all six types are selected', () => {
    const all = f({
      stateTypes: ['backlog', 'unstarted', 'started', 'completed', 'canceled', 'triage'],
    })
    expect(dims(describeScope(all, noNames, t, locale))).toEqual([])
  })

  it('prefers explicit state names over the type list', () => {
    const scope = f({ stateNames: ['unstarted::Review Spec'] })
    const [line] = describeScope(scope, noNames, t, locale)
    expect(line?.values).toEqual(['Review Spec'])
  })
})

describe('describeScope — names', () => {
  const issues: NormalizedIssue[] = [
    {
      id: 'i1',
      identifier: 'ENG-1',
      title: 'T',
      url: 'about:blank',
      priority: 2,
      state: { name: 'Todo', type: 'unstarted' },
      assignee: null,
      labels: [label('l1', 'bug')],
      project: { id: 'p1', name: 'Core API' },
      parent: null,
      children: [],
      relations: [],
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
      completedAt: null,
    },
  ]
  const names = buildNameLookup(issues, [label('l1', 'bug')])

  it('resolves project and label ids to names', () => {
    const scope = f({ projectIds: ['p1'], orphanValues: ['l1'] })
    const lines = describeScope(scope, names, t, locale)
    expect(lines.find((l) => l.label === 'filterPanel.project')?.values).toEqual(['Core API'])
    expect(lines.find((l) => l.label === 'filterPanel.otherLabels')?.values).toEqual(['bug'])
  })

  it('prints the raw id when the graph has never seen it — never drops it', () => {
    // The whole reason this module exists rather than reusing chipsFromFilters:
    // under-reporting a notification scope tells you that you hear about more
    // than you do.
    const scope = f({ projectIds: ['p-unknown'] })
    const line = describeScope(scope, names, t, locale)[1]
    expect(line?.values).toEqual(['p-unknown'])
  })
})

describe('describeScope — every label dimension is reported', () => {
  it('gives each negatable label dimension its own line, and shares one for the rest', () => {
    // primary / type / orphan are independently negatable, so they cannot share
    // a line — one `negated` flag between them would misstate at least one.
    // Prefix and group selections are not negatable and still share.
    const scope = f({
      primaryValues: ['a'],
      typeValues: ['b'],
      orphanValues: ['c'],
      prefixSelections: { area: ['d'] },
      groupSelections: { team: ['e'] },
    })
    const lines = describeScope(scope, noNames, t, locale).filter(
      (l) => l.label === 'filterPanel.otherLabels',
    )
    expect(lines.map((l) => l.values)).toEqual([['a'], ['b'], ['c'], ['d', 'e']])
  })
})

describe('describeScope — negation and booleans', () => {
  it('marks an inverted facet', () => {
    const scope = f({ priorities: [1], negated: ['priority'] })
    const line = describeScope(scope, noNames, t, locale).find(
      (l) => l.label === 'filterPanel.priority',
    )
    expect(line?.negated).toBe(true)
  })

  it('reports a boolean dimension with no values', () => {
    const scope = f({ myIssuesOnly: true, staleOnly: true })
    const lines = describeScope(scope, noNames, t, locale)
    expect(lines.find((l) => l.label === 'filterPanel.myIssues')?.values).toEqual([])
    expect(lines.find((l) => l.label === 'filterPanel.staleOnly')?.values).toEqual([])
  })

  it('covers due, recency and design-doc dimensions', () => {
    const scope = f({ dueFilter: 'overdue', recencyWindow: '24h', designdocFilter: 'missing' })
    const d = dims(describeScope(scope, noNames, t, locale))
    expect(d).toContain('filterPanel.dueDate')
    expect(d).toContain('filterPanel.recency')
    expect(d).toContain('filterPanel.designDoc')
  })
})

describe('describeScope — regressions', () => {
  it('marks a negated label dimension instead of stating its inverse', () => {
    // `bucket=Bug&neg=primary` means "everything that is NOT Bug". Flattening
    // the three label dimensions into one line forced a single negated flag,
    // and rendered the exclusion as an allow-list.
    const scope = f({ primaryValues: ['Bug'], negated: ['primary'] })
    const line = describeScope(scope, noNames, t, locale).find(
      (l) => l.label === 'filterPanel.otherLabels',
    )
    expect(line?.negated).toBe(true)
  })

  it('keeps independently negated label dimensions on separate lines', () => {
    const scope = f({ primaryValues: ['Bug'], typeValues: ['Chore'], negated: ['primary'] })
    const lines = describeScope(scope, noNames, t, locale).filter(
      (l) => l.label === 'filterPanel.otherLabels',
    )
    expect(lines.map((l) => [l.values, l.negated])).toEqual([
      [['Bug'], true],
      [['Chore'], false],
    ])
  })

  it('never reports recency as negated — it is not a negatable facet', () => {
    const scope = f({ recencyWindow: '24h', negated: ['recency', 'time'] })
    const line = describeScope(scope, noNames, t, locale).find(
      (l) => l.label === 'filterPanel.recency',
    )
    expect(line?.negated).toBe(false)
  })
})
