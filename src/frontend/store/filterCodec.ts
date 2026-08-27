// Pure Filters ↔ URLSearchParams codec, extracted from urlSync.ts.
//
// Why this module exists: `buildUrl` / `parseUrl` / `significantSignature` in
// urlSync.ts all read `window` and are module-private, so none of them can be
// exercised under vitest (`environment: 'node'` for every suite). Every filter
// dimension therefore had to be verified by hand — and five of them had
// silently drifted out of sync — projectIds, milestoneIds, stateNames and
// search were never serialized at all. The round-trip test beside this file
// is what makes that class of bug impossible to reintroduce.
//
// The invariant this module owns: **every `Filters` key appears in all three
// of `serializeFilters`, `parseFilters`, and `filterSignatureParts`** — or is
// deliberately excluded with a comment saying why.
//
// `search` lives on the view store's top level rather than inside `Filters`,
// but it is URL state of exactly the same kind, so it travels with the filters
// through `CodecState` instead of being handled separately by the caller.

import type { IssueStateType } from '@shared/types.js'
import { RECENCY_MODES, parseRecencyWindow, type RecencyMode } from '../lib/recency'
import { defaultFilters, type Filters } from './viewStore'

/** Filter state plus the free-text search, which is a sibling of `Filters` in
 *  the store but the same kind of URL state. */
export interface CodecState {
  filters: Filters
  search: string
}

const STATE_TYPES: IssueStateType[] = [
  'backlog',
  'unstarted',
  'started',
  'completed',
  'canceled',
  'triage',
]

function csv(arr: string[] | number[]): string | null {
  if (!arr || arr.length === 0) return null
  return arr.join(',')
}

/** Split a CSV param into a list, treating an absent or empty param as []. */
function list(raw: string | null): string[] {
  if (!raw) return []
  return raw.split(',').filter(Boolean)
}

/**
 * Serialize filters + search into their URL params. Returns a fresh
 * URLSearchParams; the caller merges it into the full URL so non-filter params
 * (w, view, focus, …) keep their position in the query string.
 *
 * Params are omitted at their default value so shared URLs stay short.
 */
export function serializeFilters(state: CodecState): URLSearchParams {
  const f = state.filters
  const params = new URLSearchParams()

  if (!f.activeOnly) params.set('active', '0')
  if (f.myIssuesOnly) params.set('mine', '1')
  if (f.staleOnly) params.set('stale', '1')

  const states = csv(f.stateTypes)
  if (states) params.set('state', states)
  const stateNames = csv(f.stateNames)
  if (stateNames) params.set('sname', stateNames)

  const primaries = csv(f.primaryValues)
  if (primaries) params.set('bucket', primaries)
  const types = csv(f.typeValues)
  if (types) params.set('type', types)
  const prios = csv(f.priorities)
  if (prios) params.set('priority', prios)
  const asg = csv(f.assignees)
  if (asg) params.set('assignee', asg)

  const projects = csv(f.projectIds)
  if (projects) params.set('proj', projects)
  // Composite '<projectId>::<milestoneId>' keys. ':' round-trips through
  // URLSearchParams as %3A, so no special encoding is needed.
  const milestones = csv(f.milestoneIds)
  if (milestones) params.set('ms', milestones)

  for (const [token, ids] of Object.entries(f.prefixSelections)) {
    if (ids.length) params.set(`pfx_${token}`, ids.join(','))
  }
  for (const [group, ids] of Object.entries(f.groupSelections)) {
    if (ids.length) params.set(`grp_${group}`, ids.join(','))
  }
  if (f.orphanValues.length) params.set('label', f.orphanValues.join(','))

  if (f.designdocFilter !== 'all') params.set('designdoc', f.designdocFilter)
  if (f.dueFilter !== 'any') params.set('due', f.dueFilter)

  if (f.recencyWindow !== 'any') params.set('recent', f.recencyWindow)
  if (f.recencyMode !== 'updated') params.set('recentby', f.recencyMode)

  // Inverted facets, as one param rather than a flag per dimension — see
  // Filters.negated. Facet ids may contain ':' (prefix:horizon), which
  // round-trips through URLSearchParams as %3A.
  const neg = csv(f.negated)
  if (neg) params.set('neg', neg)

  if (state.search) params.set('q', state.search)

  return params
}

/**
 * Rebuild filters + search from URL params.
 *
 * Every field is assigned unconditionally — an absent param resets its field to
 * the default rather than inheriting the current value. That is what makes
 * popstate correct: without it, Back/Forward could only ever ADD state, never
 * clear it.
 */
export function parseFilters(params: URLSearchParams): CodecState {
  const prefixSelections: Record<string, string[]> = {}
  const groupSelections: Record<string, string[]> = {}
  for (const [k, v] of params.entries()) {
    if (k.startsWith('pfx_')) {
      prefixSelections[k.slice(4)] = v.split(',').filter(Boolean)
    } else if (k.startsWith('grp_')) {
      groupSelections[k.slice(4)] = v.split(',').filter(Boolean)
    }
  }

  const filters: Filters = {
    activeOnly: params.get('active') !== '0',
    myIssuesOnly: params.get('mine') === '1',
    staleOnly: params.get('stale') === '1',
    stateTypes: ((): IssueStateType[] => {
      const s = params.get('state')
      if (!s) return defaultFilters.stateTypes
      return s
        .split(',')
        .filter((x): x is IssueStateType => STATE_TYPES.includes(x as IssueStateType))
    })(),
    stateNames: list(params.get('sname')),
    primaryValues: list(params.get('bucket')),
    typeValues: list(params.get('type')),
    priorities: (params.get('priority')?.split(',').map(Number).filter((n) => !isNaN(n)) ?? []),
    assignees: list(params.get('assignee')),
    projectIds: list(params.get('proj')),
    milestoneIds: list(params.get('ms')),
    prefixSelections,
    groupSelections,
    orphanValues: list(params.get('label')),
    designdocFilter: ((): 'all' | 'has' | 'missing' => {
      const dd = params.get('designdoc')
      return dd === 'has' || dd === 'missing' ? dd : 'all'
    })(),
    dueFilter: ((): 'any' | 'has' | 'overdue' | 'soon7' | 'soon30' => {
      const d = params.get('due')
      return d === 'has' || d === 'overdue' || d === 'soon7' || d === 'soon30' ? d : 'any'
    })(),
    // Pattern-validated rather than whitelisted, so `recent=6h` works without
    // the codec knowing which spans the UI happens to offer.
    recencyWindow: parseRecencyWindow(params.get('recent')) ?? 'any',
    recencyMode: ((): RecencyMode => {
      const m = params.get('recentby')
      return RECENCY_MODES.includes(m as RecencyMode) ? (m as RecencyMode) : 'updated'
    })(),
    negated: list(params.get('neg')),
  }

  return { filters, search: params.get('q') ?? '' }
}

/**
 * The filter half of urlSync's `significantSignature()`, as ordered parts.
 *
 * Lists are sorted before joining so that merely reordering a selection is not
 * treated as a navigation step. Kept in the same order as the original inline
 * signature so history behavior is unchanged by the extraction.
 */
export function filterSignatureParts(state: CodecState): string[] {
  const f = state.filters
  return [
    state.search,
    f.activeOnly ? '1' : '0',
    f.myIssuesOnly ? '1' : '0',
    f.staleOnly ? '1' : '0',
    f.stateTypes.slice().sort().join(','),
    f.stateNames.slice().sort().join(','),
    f.primaryValues.slice().sort().join(','),
    f.typeValues.slice().sort().join(','),
    f.priorities.slice().sort().join(','),
    f.assignees.slice().sort().join(','),
    f.projectIds.slice().sort().join(','),
    f.milestoneIds.slice().sort().join(','),
    f.designdocFilter,
    f.dueFilter,
    f.recencyWindow,
    // Included even though flipping the mode while the window is 'any' has no
    // visible effect — keeping the signature a faithful mirror of the URL is
    // worth more than suppressing one no-op history entry.
    f.recencyMode,
    (f.negated ?? []).slice().sort().join(','),
    Object.entries(f.prefixSelections)
      .map(([k, v]) => `${k}:${v.slice().sort().join(',')}`)
      .sort()
      .join('|'),
    Object.entries(f.groupSelections)
      .map(([k, v]) => `${k}:${v.slice().sort().join(',')}`)
      .sort()
      .join('|'),
    f.orphanValues.slice().sort().join(','),
  ]
}
