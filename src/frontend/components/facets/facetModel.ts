// Pure derivation for the filter chip bar: which facets exist right now, what
// options each offers, and which chips the current Filters should render as.
//
// Deliberately DERIVATION ONLY — no toggling. The mutation semantics already
// live in viewStore's dimension-specific actions and carry behavior that is
// not expressible as a function of `Filters` alone:
//   - `toggleStateType` auto-clears `activeOnly` when a completed/canceled
//     state is switched ON (viewStore.ts), otherwise the click silently does
//     nothing.
//   - checking a completed/canceled state calls `graphStore.extendScope(365)`,
//     because that data may sit outside the sync window.
// Re-implementing those here as pure reducers would duplicate semantics that
// viewStore.test.ts already covers, and would drop the second one entirely.
// The React shell calls the store actions; this module only says what to draw.
//
// vitest runs `environment: 'node'` for every suite with no happy-dom, so React
// components in this feature cannot be tested at all. Everything that can carry
// a test therefore lives here — keep logic out of the JSX.

import type { IssueStateType } from '@shared/types.js'
import type { Filters } from '../../store/viewStore'
import type { DictKey } from '../../i18n'
import type { ProjectRow, StateNameRow } from './useFilterCounts'

/** How a facet's values combine. Drives both the popover widget and whether
 *  picking a second value adds to or replaces the first. */
export type FacetSelection =
  /** A boolean quick-filter. One chip, no value list. */
  | 'toggle'
  /** Any number of values; picking more widens the match. */
  | 'multi'
  /** At most one value, and re-picking the selected one clears it. */
  | 'single'

export type FacetKind =
  | 'quick'
  | 'state'
  | 'primary'
  | 'type'
  | 'priority'
  | 'assignee'
  | 'project'
  | 'prefix'
  | 'group'
  | 'orphan'
  | 'designdoc'
  | 'due'
  | 'time'
  | 'tag'

export interface FacetOption {
  value: string
  label: string
  count?: number
  /** Hex tint for the option's swatch (project color, state color). */
  tint?: string | null
  /** Second-level rows: state names under a state type, milestones under a
   *  project. Empty for flat facets. */
  children?: FacetOption[]
}

export interface FacetDef {
  /** Stable id: 'state', 'prefix:horizon', 'group:Risk'. Used as the React key,
   *  the chip's facetId, and the popover's identity. */
  id: string
  kind: FacetKind
  selection: FacetSelection
  /** Translated title. Prefix facets have no i18n key — their title is the
   *  literal token (e.g. 'horizon:'), which is why this is a string and not a
   *  DictKey. */
  title: string
  options: FacetOption[]
}

export interface ChipDescriptor {
  facetId: string
  /** Facet title, e.g. 'Assignee'. */
  title: string
  /** Value summary: the single selected label, or a count for multi-selects. */
  summary: string
  /** How many values are selected. 0 for a toggle chip that is simply on. */
  selectedCount: number
  tint?: string | null
}

export type Translate = (key: DictKey, params?: Record<string, string | number>) => string

const PRIORITIES = [1, 2, 3, 4, 0]
const PRIORITY_KEYS: Record<number, DictKey> = {
  0: 'filterPanel.priorityNoPriority',
  1: 'filterPanel.priorityUrgent',
  2: 'filterPanel.priorityHigh',
  3: 'filterPanel.priorityMedium',
  4: 'filterPanel.priorityLow',
}
const ALL_STATES: IssueStateType[] = [
  'started',
  'unstarted',
  'backlog',
  'triage',
  'completed',
  'canceled',
]

/** Canonical token for the unassigned bucket. Stored in Filters and the URL, so
 *  it must never be localized — only its display label is translated. */
export const UNASSIGNED_TOKEN = '(unassigned)'
/** Canonical token for issues with no Linear project. Mirrors the Project
 *  view's grouping key. */
export const NO_PROJECT_TOKEN = '__noproject'

/** Assignee rows are capped so a large workspace cannot produce an unbounded
 *  option list. Carried over from FilterPanel, which sliced to 30. */
export const ASSIGNEE_LIMIT = 30

export interface BuildFacetsInput {
  filters: Filters
  t: Translate
  schema: { primaryGroup?: string | null; typeGroup?: string | null; prefixes?: { token: string }[] }
  primaryGroupSingular: string | null
  counts: {
    byState: Record<string, number>
    byPrio: Record<number, number>
    byAssignee: Map<string, number>
    byLabel: Map<string, number>
  }
  stateNamesByType: Record<IssueStateType, StateNameRow[]>
  primaryLabels: { id: string; name: string }[]
  typeLabels: { id: string; name: string }[]
  otherLabelSections: { kind: string; key: string; exclusive?: boolean; labels: { id: string; name: string }[] }[]
  prefixSections: { token: string; labels: { id: string; name: string }[] }[]
  assignees: [string, number][]
  projectsWithMilestones: ProjectRow[]
  stateColor: (type: IssueStateType) => string | null
  stateLabel: (type: IssueStateType) => string
  showDesigndocFilter: boolean
  showDueFilter: boolean
}

/**
 * Build the facet list for the current data. Conditional facets (primary, type,
 * project, designdoc, due) are omitted entirely when they have nothing to show —
 * that omission is the whole point of the bar, since an absent facet costs no
 * space at all.
 */
export function buildFacets(input: BuildFacetsInput): FacetDef[] {
  const { filters, t, counts } = input
  const facets: FacetDef[] = []

  // --- Quick toggles -------------------------------------------------------
  // Three independent booleans rather than one facet, so each gets its own
  // chip and can be dismissed on its own.
  facets.push({
    id: 'quick:active',
    kind: 'quick',
    selection: 'toggle',
    title: t('filterPanel.activeOnly'),
    options: [],
  })
  facets.push({
    id: 'quick:mine',
    kind: 'quick',
    selection: 'toggle',
    title: t('filterPanel.myIssues'),
    options: [],
  })
  facets.push({
    id: 'quick:stale',
    kind: 'quick',
    selection: 'toggle',
    title: t('filterPanel.staleOnly'),
    options: [],
  })

  // --- State (two-level: canonical type → Linear state name) ---------------
  facets.push({
    id: 'state',
    kind: 'state',
    selection: 'multi',
    title: t('filterPanel.state'),
    options: ALL_STATES.map((type) => ({
      value: type,
      label: input.stateLabel(type),
      count: counts.byState[type] ?? 0,
      tint: input.stateColor(type),
      children: (input.stateNamesByType[type] ?? []).map((s: StateNameRow) => ({
        value: s.name,
        label: s.name,
        count: s.count,
      })),
    })),
  })

  // --- Primary / type label groups (conditional on the schema) -------------
  if (input.primaryLabels.length > 0) {
    facets.push({
      id: 'primary',
      kind: 'primary',
      selection: 'multi',
      title: input.primaryGroupSingular
        ? `${input.primaryGroupSingular}s`
        : input.schema.primaryGroup ?? t('filterPanel.group'),
      options: input.primaryLabels.map((l) => ({
        value: l.id,
        label: l.name,
        count: counts.byLabel.get(l.id) ?? 0,
      })),
    })
  }
  if (input.typeLabels.length > 0) {
    facets.push({
      id: 'type',
      kind: 'type',
      selection: 'multi',
      title: input.schema.typeGroup ?? t('filterPanel.type'),
      options: input.typeLabels.map((l) => ({
        value: l.id,
        label: l.name,
        count: counts.byLabel.get(l.id) ?? 0,
      })),
    })
  }

  // --- Priority ------------------------------------------------------------
  facets.push({
    id: 'priority',
    kind: 'priority',
    selection: 'multi',
    title: t('filterPanel.priority'),
    options: PRIORITIES.map((p) => ({
      value: String(p),
      label: t(PRIORITY_KEYS[p] as DictKey),
      count: counts.byPrio[p] ?? 0,
    })),
  })

  // --- Assignee ------------------------------------------------------------
  facets.push({
    id: 'assignee',
    kind: 'assignee',
    selection: 'multi',
    title: t('filterPanel.assignee'),
    // Capped exactly as the sidebar did. Uncapping here would be a silent
    // behavior change on large workspaces.
    options: input.assignees.slice(0, ASSIGNEE_LIMIT).map(([name, count]) => ({
      value: name,
      label: name === UNASSIGNED_TOKEN ? t('common.unassigned') : name,
      count,
    })),
  })

  // --- Project → milestone (conditional) -----------------------------------
  if (input.projectsWithMilestones.length > 0) {
    facets.push({
      id: 'project',
      kind: 'project',
      selection: 'multi',
      title: t('filterPanel.projectMilestone'),
      options: input.projectsWithMilestones.map((p) => ({
        value: p.projId,
        label: p.projId === NO_PROJECT_TOKEN ? t('common.noProject') : p.name,
        count: p.count,
        tint: p.color,
        children: p.children.map((m) => ({
          value: m.key,
          label: m.milestoneId === null ? t('filterPanel.noMilestone') : m.name,
          count: m.count,
        })),
      })),
    })
  }

  // --- Prefix label groups (one facet per detected prefix token) -----------
  for (const g of input.prefixSections) {
    facets.push({
      id: `prefix:${g.token}`,
      kind: 'prefix',
      selection: 'multi',
      // Literal, not translated: the token comes from the workspace's own
      // label names, so there is no key to look up.
      title: `${g.token}:`,
      options: g.labels.map((l) => ({
        value: l.id,
        label: l.name,
        count: counts.byLabel.get(l.id) ?? 0,
      })),
    })
  }

  // --- Remaining label groups + orphans ------------------------------------
  for (const sec of input.otherLabelSections) {
    facets.push({
      id: `${sec.kind}:${sec.key}`,
      kind: sec.kind === 'orphan' ? 'orphan' : 'group',
      // An exclusive group behaves like a radio: picking a second value
      // replaces the first, and re-picking the selected one clears it.
      selection: sec.exclusive ? 'single' : 'multi',
      title: sec.kind === 'orphan' ? t('filterPanel.otherLabels') : sec.key,
      options: sec.labels.map((l) => ({
        value: l.id,
        label: l.name,
        count: counts.byLabel.get(l.id) ?? 0,
      })),
    })
  }

  // --- Radio facets --------------------------------------------------------
  if (input.showDesigndocFilter) {
    facets.push({
      id: 'designdoc',
      kind: 'designdoc',
      selection: 'single',
      title: t('filterPanel.designDoc'),
      options: [
        { value: 'all', label: t('filterPanel.designDocAll') },
        { value: 'has', label: t('filterPanel.designDocHas') },
        { value: 'missing', label: t('filterPanel.designDocMissing') },
      ],
    })
  }
  if (input.showDueFilter) {
    facets.push({
      id: 'due',
      kind: 'due',
      selection: 'single',
      title: t('filterPanel.dueDate'),
      options: [
        { value: 'any', label: t('filterPanel.dueDateAny') },
        { value: 'has', label: t('filterPanel.dueDateHas') },
        { value: 'overdue', label: t('filterPanel.dueDateOverdue') },
        { value: 'soon7', label: t('filterPanel.dueDateSoon7') },
        { value: 'soon30', label: t('filterPanel.dueDateSoon30') },
      ],
    })
  }
  // Unconditional: every issue has createdAt/updatedAt, so unlike due/designdoc
  // there is no empty-data case that would leave this as dead UI.
  facets.push({
    id: 'time',
    kind: 'time',
    selection: 'single',
    title: t('filterPanel.recency'),
    options: [
      { value: 'any', label: t('filterPanel.recencyAny') },
      { value: 'today', label: t('filterPanel.recencyToday') },
      { value: '7d', label: t('filterPanel.recency7d') },
      { value: '30d', label: t('filterPanel.recency30d') },
    ],
  })

  void filters
  return facets
}

/** The values currently selected for a facet, as raw Filters tokens. */
export function selectedValues(filters: Filters, facet: FacetDef): string[] {
  switch (facet.kind) {
    case 'quick':
      if (facet.id === 'quick:active') return filters.activeOnly ? [] : ['off']
      if (facet.id === 'quick:mine') return filters.myIssuesOnly ? ['on'] : []
      return filters.staleOnly ? ['on'] : []
    case 'state':
      // stateNames takes precedence over stateTypes when non-empty — the same
      // rule applyFilters uses, so the chip reflects what is actually applied.
      return filters.stateNames.length > 0 ? filters.stateNames : filters.stateTypes
    case 'primary':
      return filters.primaryValues
    case 'type':
      return filters.typeValues
    case 'priority':
      return filters.priorities.map(String)
    case 'assignee':
      return filters.assignees
    case 'project':
      return filters.milestoneIds.length > 0 ? filters.milestoneIds : filters.projectIds
    case 'prefix':
      return filters.prefixSelections[facet.id.slice('prefix:'.length)] ?? []
    case 'group':
      return filters.groupSelections[facet.id.slice('group:'.length)] ?? []
    case 'orphan':
      return filters.orphanValues
    case 'tag':
      return filters.tagIds
    case 'designdoc':
      return filters.designdocFilter === 'all' ? [] : [filters.designdocFilter]
    case 'due':
      return filters.dueFilter === 'any' ? [] : [filters.dueFilter]
    case 'time':
      return filters.recencyWindow === 'any' ? [] : [filters.recencyWindow]
  }
}

/** Look up an option's display label anywhere in a facet, including children. */
function labelFor(facet: FacetDef, value: string): string {
  for (const o of facet.options) {
    if (o.value === value) return o.label
    for (const c of o.children ?? []) if (c.value === value) return c.label
  }
  return value
}

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const set = new Set(b)
  return a.every((x) => set.has(x))
}

/**
 * Whether a facet is at its resting value and should therefore render no chip.
 *
 * NOT the same as "no values selected": `stateTypes` defaults to the four
 * active states, so an empty check would pin a State chip to the bar forever.
 * (The identical assumption is why `state=` is the one URL param written even
 * at the default — see filterCodec.)
 */
export function isFacetAtDefault(filters: Filters, facet: FacetDef, defaults: Filters): boolean {
  if (facet.kind === 'state') {
    return filters.stateNames.length === 0 && sameSet(filters.stateTypes, defaults.stateTypes)
  }
  return selectedValues(filters, facet).length === 0
}

/**
 * Chips for the current filter state — one per facet that is away from its
 * default. A facet at its default renders nothing, which is what makes an
 * unused dimension cost zero space.
 */
export function chipsFromFilters(
  filters: Filters,
  facets: FacetDef[],
  t: Translate,
  defaults: Filters,
): ChipDescriptor[] {
  const chips: ChipDescriptor[] = []
  for (const facet of facets) {
    if (isFacetAtDefault(filters, facet, defaults)) continue
    const selected = selectedValues(filters, facet)

    if (facet.selection === 'toggle') {
      chips.push({
        facetId: facet.id,
        // `activeOnly` defaults to TRUE, so its noteworthy state is being OFF.
        // The chip therefore reads "Including done" rather than "Active only".
        title: facet.id === 'quick:active' ? t('filterPanel.includingDone') : facet.title,
        summary: '',
        selectedCount: 0,
      })
      continue
    }

    const first = selected[0]
    chips.push({
      facetId: facet.id,
      title: facet.title,
      summary:
        selected.length === 1 && first !== undefined
          ? labelFor(facet, first)
          : String(selected.length),
      selectedCount: selected.length,
      tint:
        selected.length === 1 && first !== undefined
          ? facet.options.find((o) => o.value === first)?.tint ?? null
          : null,
    })
  }
  return chips
}

/**
 * The Filters patch that clears a facet. Returned as a partial rather than
 * applied, so the caller decides how to commit it.
 *
 * Two facets clear two fields: `state` because stateNames shadows stateTypes,
 * and `project` because milestoneIds shadows projectIds — clearing only the
 * shadowing field would leave a stale filter silently applied.
 */
export function clearFacetPatch(
  facet: FacetDef,
  filters: Filters,
  defaults: Filters,
): Partial<Filters> {
  switch (facet.kind) {
    case 'quick':
      if (facet.id === 'quick:active') return { activeOnly: true }
      if (facet.id === 'quick:mine') return { myIssuesOnly: false }
      return { staleOnly: false }
    case 'state':
      return { stateTypes: defaults.stateTypes, stateNames: [] }
    case 'primary':
      return { primaryValues: [] }
    case 'type':
      return { typeValues: [] }
    case 'priority':
      return { priorities: [] }
    case 'assignee':
      return { assignees: [] }
    case 'project':
      return { projectIds: [], milestoneIds: [] }
    // Set the key to [] rather than deleting it, matching what the sidebar
    // did — the two are equivalent to applyFilters, and keeping the key makes
    // the cleared group still serialize as absent.
    case 'prefix': {
      const token = facet.id.slice('prefix:'.length)
      return { prefixSelections: { ...filters.prefixSelections, [token]: [] } }
    }
    case 'group': {
      const key = facet.id.slice('group:'.length)
      return { groupSelections: { ...filters.groupSelections, [key]: [] } }
    }
    case 'orphan':
      return { orphanValues: [] }
    case 'tag':
      return { tagIds: [] }
    case 'designdoc':
      return { designdocFilter: 'all' }
    case 'due':
      return { dueFilter: 'any' }
    case 'time':
      return { recencyWindow: 'any', recencyMode: 'updated' }
  }
}
