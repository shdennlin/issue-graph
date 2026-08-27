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
import { RECENCY_PRESETS, type RecencyWindow } from '../../lib/recency'
import { stateNameKey } from '../../views/filters'
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

/**
 * Which section of the picker a facet belongs to.
 *
 * Label-derived facets were the reason this exists: `primary` and `type` are
 * built from label groups and appeared near the top, while `prefix:*` and the
 * remaining label groups appeared much further down, so one kind of thing was
 * scattered across the list with unrelated dimensions in between.
 */
export type FacetGroup = 'quick' | 'attribute' | 'label' | 'time'

export interface FacetDef {
  /** Stable id: 'state', 'prefix:horizon', 'group:Risk'. Used as the React key,
   *  the chip's facetId, and the popover's identity. */
  id: string
  kind: FacetKind
  group: FacetGroup
  selection: FacetSelection
  /** Translated title. Prefix facets have no i18n key — their title is the
   *  literal token (e.g. 'horizon:'), which is why this is a string and not a
   *  DictKey. */
  title: string
  options: FacetOption[]
}

export interface ChipDescriptor {
  facetId: string
  /** Reads as "Status | is any of | 3 selected". Multi-select facets match any
   *  of their values, single-select match exactly one — saying so removes a
   *  real ambiguity about what a multi-value chip means. `isNotAnyOf` is the
   *  negated form and, unlike the others, is a control the user can flip. */
  operator: 'is' | 'isAnyOf' | 'isNotAnyOf' | null
  /** Facet title, e.g. 'Assignee'. */
  title: string
  /** Value summary: the single selected label, or a count for multi-selects. */
  summary: string
  /** How many values are selected. 0 for a toggle chip that is simply on. */
  selectedCount: number
  tint?: string | null
  /** Pinned chips only: whether the pinned value is currently applied. */
  active?: boolean
}

export type Translate = (key: DictKey, params?: Record<string, string | number>) => string

/** A filter value the user keeps visible in the bar for one-click toggling.
 *  Stored per workspace in localStorage — see lib/pinnedFilters.ts. */
export interface PinnedFilter {
  facetId: string
  value: string
}

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
    group: 'quick',
    selection: 'toggle',
    title: t('filterPanel.activeOnly'),
    options: [],
  })
  facets.push({
    id: 'quick:mine',
    kind: 'quick',
    group: 'quick',
    selection: 'toggle',
    title: t('filterPanel.myIssues'),
    options: [],
  })
  facets.push({
    id: 'quick:stale',
    kind: 'quick',
    group: 'quick',
    selection: 'toggle',
    title: t('filterPanel.staleOnly'),
    options: [],
  })

  // --- State (two-level: canonical type → Linear state name) ---------------
  facets.push({
    id: 'state',
    kind: 'state',
    group: 'attribute',
    selection: 'multi',
    title: t('filterPanel.state'),
    options: ALL_STATES.map((type) => ({
      value: type,
      label: input.stateLabel(type),
      count: counts.byState[type] ?? 0,
      tint: input.stateColor(type),
      // Composite `<type>::<name>` so applyFilters can tell which type a name
      // refines without a lookup table — same convention as milestone keys.
      children: (input.stateNamesByType[type] ?? []).map((s: StateNameRow) => ({
        value: stateNameKey(type, s.name),
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
      group: 'label',
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
      group: 'label',
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
    group: 'attribute',
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
    group: 'attribute',
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
      group: 'attribute',
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
      group: 'label',
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
      group: 'label',
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
      group: 'attribute',
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
      group: 'time',
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
    group: 'time',
    selection: 'single',
    title: t('filterPanel.recency'),
    // Presets, plus the current value when it was typed rather than picked —
    // without that the chip would have no label to show and the option list
    // no row to tick.
    options: recencyOptions(filters.recencyWindow, t),
  })

  void filters
  return facets
}

/**
 * The actual boolean behind a `toggle` facet.
 *
 * Distinct from `selectedValues`, which reports "is this facet away from its
 * default" so a chip appears at the right times. For `quick:active` those two
 * are OPPOSITE — activeOnly defaults to true, so it is away from its default
 * when false — and reading the checkbox off selectedValues showed
 * "Active only" ticked at the exact moment it had been switched off.
 */
export function toggleValue(filters: Filters, facet: FacetDef): boolean {
  if (facet.id === 'quick:active') return filters.activeOnly
  if (facet.id === 'quick:mine') return filters.myIssuesOnly
  return filters.staleOnly
}

/**
 * Whether a facet's selection is inverted.
 *
 * Only multi-select facets can be: negating a boolean is a double negative, and
 * a single-select enum's negation is expressible by picking the other values.
 */
export function isNegated(filters: Filters, facet: FacetDef): boolean {
  return facet.selection === 'multi' && (filters.negated ?? []).includes(facet.id)
}

/** Toggle a facet's negation, returning the new list. */
export function toggleNegated(filters: Filters, facet: FacetDef): string[] {
  const cur = filters.negated ?? []
  return cur.includes(facet.id)
    ? cur.filter((id) => id !== facet.id)
    : [...cur, facet.id]
}

/** Human label for a window, including spans that were typed in. */
export function recencyWindowLabel(w: RecencyWindow, t: Translate): string {
  if (w === 'any') return t('filterPanel.recencyAny')
  if (w === 'today') return t('filterPanel.recencyToday')
  const amount = w.slice(0, -1)
  return w.endsWith('h')
    ? t('filterPanel.recencyHours', { count: amount })
    : t('filterPanel.recencyDays', { count: amount })
}

function recencyOptions(current: RecencyWindow, t: Translate): FacetOption[] {
  const values: RecencyWindow[] = RECENCY_PRESETS.includes(current)
    ? RECENCY_PRESETS
    : [...RECENCY_PRESETS, current]
  return values.map((v) => ({ value: v, label: recencyWindowLabel(v, t) }))
}

/** The values currently selected for a facet, as raw Filters tokens. */
export function selectedValues(filters: Filters, facet: FacetDef): string[] {
  switch (facet.kind) {
    case 'quick':
      if (facet.id === 'quick:active') return filters.activeOnly ? [] : ['off']
      if (facet.id === 'quick:mine') return filters.myIssuesOnly ? ['on'] : []
      return filters.staleOnly ? ['on'] : []
    case 'state':
      // Both levels are genuinely checked: a type selects its whole branch, a
      // name refines within it. Returning only one made the tree look mutually
      // exclusive — picking a name blanked every parent checkbox.
      return [...filters.stateTypes, ...filters.stateNames]
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
    case 'designdoc':
      return filters.designdocFilter === 'all' ? [] : [filters.designdocFilter]
    case 'due':
      return filters.dueFilter === 'any' ? [] : [filters.dueFilter]
    case 'time':
      return filters.recencyWindow === 'any' ? [] : [filters.recencyWindow]
  }
}

/**
 * Sort selected values into the order their options appear in the facet.
 *
 * `Filters` keeps selections in toggle order — an implementation detail of
 * how they were clicked — which is not something a reader can see or predict.
 * Values with no matching option (a stale id, a bare legacy state name) keep
 * their relative order at the end rather than being dropped.
 */
export function orderByOptions(facet: FacetDef, values: string[]): string[] {
  const rank = new Map<string, number>()
  let n = 0
  for (const o of facet.options) {
    rank.set(o.value, n++)
    for (const c of o.children ?? []) rank.set(c.value, n++)
  }
  const known = values.filter((v) => rank.has(v))
  const unknown = values.filter((v) => !rank.has(v))
  known.sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0))
  return [...known, ...unknown]
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
 * Whether a facet is currently excluding anything.
 *
 * NOT "is it at its default". Two defaults in this app are not neutral:
 * `activeOnly` starts TRUE (hiding everything completed or canceled) and
 * `stateTypes` starts as four of the six types. Keying the chips off
 * "non-default" therefore showed an empty panel while two real constraints
 * were in force — the UI claimed nothing was filtered when a third of the
 * state space was hidden.
 *
 * A facet that genuinely does nothing (dueFilter 'any', an empty assignee
 * list) still renders no chip, so unused dimensions keep costing no space.
 */
export function facetConstrains(filters: Filters, facet: FacetDef): boolean {
  switch (facet.kind) {
    case 'quick':
      // activeOnly constrains when ON; the other two are plain opt-ins.
      return toggleValue(filters, facet)
    case 'state':
      return (
        filters.stateNames.length > 0 ||
        (filters.stateTypes.length > 0 && filters.stateTypes.length < ALL_STATES.length)
      )
    default:
      return selectedValues(filters, facet).length > 0
  }
}

/**
 * Whether a facet is at its resting value. Used for the "already in use"
 * marker in the picker; chips key off facetConstrains instead.
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
): ChipDescriptor[] {
  const chips: ChipDescriptor[] = []
  for (const facet of facets) {
    if (!facetConstrains(filters, facet)) continue
    const selected = selectedValues(filters, facet)

    if (facet.selection === 'toggle') {
      chips.push({
        facetId: facet.id,
        // Reads as the constraint it applies. It used to say "Including done"
        // because the chip only appeared when activeOnly was OFF; chips now
        // appear when a facet EXCLUDES something, so this one shows while
        // activeOnly is ON and the old label said the opposite of the truth.
        title: facet.title,
        // A boolean has no operator or value — the title says everything.
        operator: null,
        summary: '',
        selectedCount: 0,
      })
      continue
    }

    // Ordered by where the values sit in the list, not by when they were
    // clicked. Filters store selections in toggle order, so the "first" value
    // was whichever the user happened to pick first — unchecking and
    // rechecking one moved it to the end and silently changed what the chip
    // said. Display order is what the reader can actually verify.
    const ordered = orderByOptions(facet, selected)
    const first = ordered[0]
    chips.push({
      facetId: facet.id,
      title: facet.title,
      // One value reads as itself; several show the first plus a remainder.
      // A bare count ("5 selected") forced you to open the menu to learn what
      // was applied, which is the one thing the chip exists to tell you.
      summary:
        first === undefined
          ? ''
          : ordered.length === 1
            ? labelFor(facet, first)
            : t('filterPanel.chipPlusMore', {
                first: labelFor(facet, first),
                rest: ordered.length - 1,
              }),
      operator:
        facet.selection === 'multi'
          ? isNegated(filters, facet)
            ? 'isNotAnyOf'
            : 'isAnyOf'
          : 'is',
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
export function clearFacetPatch(facet: FacetDef, filters: Filters): Partial<Filters> {
  // Clearing a facet drops its negation as well. Leaving it behind would park
  // an invisible "is not" on a facet with nothing selected, which then flips
  // meaning the next time a value is picked.
  const dropNegation: Partial<Filters> = (filters.negated ?? []).includes(facet.id)
    ? { negated: (filters.negated ?? []).filter((id) => id !== facet.id) }
    : {}
  return { ...dropNegation, ...clearFacetValues(facet, filters) }
}

function clearFacetValues(facet: FacetDef, filters: Filters): Partial<Filters> {
  switch (facet.kind) {
    // Clearing a chip means "remove this constraint", which is not the same as
    // "restore the default" for the two facets whose defaults are not neutral.
    // Returning activeOnly to true, or stateTypes to the four active types,
    // left the chip exactly where it was — the X appeared to do nothing.
    case 'quick':
      if (facet.id === 'quick:active') return { activeOnly: false }
      if (facet.id === 'quick:mine') return { myIssuesOnly: false }
      return { staleOnly: false }
    case 'state':
      // Empty means "no type filter", so nothing is excluded.
      return { stateTypes: [], stateNames: [] }
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
    case 'designdoc':
      return { designdocFilter: 'all' }
    case 'due':
      return { dueFilter: 'any' }
    case 'time':
      return { recencyWindow: 'any', recencyMode: 'updated' }
  }
}

/**
 * Locate an option by value, searching nested children too.
 *
 * Returns the parent's value alongside it because the toggle actions for the
 * two-level facets need it: a state NAME toggles differently from a state
 * TYPE, and picking an archival state has to widen the sync window based on
 * the parent type. Callers acting on a bare value cannot know which level it
 * came from without this.
 */
export function locateOption(
  facet: FacetDef,
  value: string,
): { option: FacetOption; isChild: boolean; parentValue?: string } | null {
  for (const o of facet.options) {
    if (o.value === value) return { option: o, isChild: false }
    for (const c of o.children ?? []) {
      if (c.value === value) return { option: c, isChild: true, parentValue: o.value }
    }
  }
  return null
}


/**
 * Split a facet's options into pinned-first and the rest.
 *
 * Pinning is a display preference, not state: it changes where a value sits in
 * the list, nothing else. That is deliberate — an earlier version gave each pin
 * its own chip in the bar, which meant one facet had two representations of the
 * same fact and every question that followed ("show both? which wins? what
 * happens when one changes?") produced another edge case.
 *
 * Only top-level options float. A pinned child (a state name, a milestone) stays
 * under its parent, because hoisting it away from the parent that gives it
 * meaning would be worse than leaving it in place.
 *
 * A pin whose value has vanished is simply absent from both lists — dropped at
 * render, never pruned from storage, since a label can be missing merely
 * because a sync is in flight.
 */
export function partitionPinned(
  facet: FacetDef,
  pins: PinnedFilter[],
): { pinned: FacetOption[]; rest: FacetOption[] } {
  const pinnedValues = new Set(
    pins.filter((p) => p.facetId === facet.id).map((p) => p.value),
  )
  if (pinnedValues.size === 0) return { pinned: [], rest: facet.options }
  const pinned: FacetOption[] = []
  const rest: FacetOption[] = []
  for (const o of facet.options) {
    if (pinnedValues.has(o.value)) pinned.push(o)
    else rest.push(o)
  }
  return { pinned, rest }
}

/** One value found by searching across every facet at once. */
export interface FacetSearchHit {
  facet: FacetDef
  option: FacetOption
  isChild: boolean
  parentValue?: string
}

/**
 * Fuzzy-search every facet's values in one pass, so typing "bug" in the add-
 * filter box finds `Type › Bug` without knowing which dimension it lives under.
 *
 * Without this the search box only matched dimension NAMES, which is the one
 * thing you already know — you open the menu because you remember the value,
 * not the taxonomy it was filed under.
 *
 * Capped, because an unbounded list defeats the point: a two-letter query
 * matches most of a large workspace, and a menu you have to scroll through is
 * no faster than the nested one it replaced. Results are ranked by score so the
 * cap keeps the best ones.
 */
export function searchFacetValues(
  facets: FacetDef[],
  query: string,
  score: (query: string, text: string) => number | null,
  limit: number,
): FacetSearchHit[] {
  const q = query.trim()
  if (q.length === 0) return []
  const scored: { hit: FacetSearchHit; score: number }[] = []

  const consider = (
    facet: FacetDef,
    option: FacetOption,
    isChild: boolean,
    parentValue?: string,
  ) => {
    // Match against "Dimension Value" so a query can name either half —
    // "type bug" and "bug" both find it.
    const direct = score(q, option.label)
    const qualified = score(q, `${facet.title} ${option.label}`)
    const best =
      direct === null ? qualified : qualified === null ? direct : Math.max(direct, qualified)
    if (best === null) return
    scored.push({ hit: { facet, option, isChild, parentValue }, score: best })
  }

  for (const facet of facets) {
    // Toggle facets have no values; their title is matched by the caller's
    // dimension-level filter instead.
    if (facet.selection === 'toggle') continue
    for (const o of facet.options) {
      consider(facet, o, false)
      for (const c of o.children ?? []) consider(facet, c, true, o.value)
    }
  }

  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, limit).map((s) => s.hit)
}

/** Section order in the picker, coarse to specific. */
const GROUP_ORDER: FacetGroup[] = ['quick', 'attribute', 'label', 'time']

const GROUP_TITLE_KEYS: Record<FacetGroup, DictKey> = {
  quick: 'filterPanel.groupQuick',
  attribute: 'filterPanel.groupAttribute',
  label: 'filterPanel.groupLabel',
  time: 'filterPanel.groupTime',
}

export interface FacetSection {
  group: FacetGroup
  title: string
  facets: FacetDef[]
}

/**
 * Bucket facets into the picker's sections, preserving each facet's order
 * within its own section and dropping sections with nothing in them.
 *
 * Grouping is what makes the label facets findable: `primary` and `type` are
 * label groups that were built early and so listed near the top, while
 * `prefix:*` and the other label groups were built later and listed much
 * further down — one kind of thing split across the list by an ordering that
 * reflected construction order rather than meaning.
 */
export function groupFacets(facets: FacetDef[], t: Translate): FacetSection[] {
  const byGroup = new Map<FacetGroup, FacetDef[]>()
  for (const f of facets) {
    const list = byGroup.get(f.group) ?? []
    list.push(f)
    byGroup.set(f.group, list)
  }
  return GROUP_ORDER.flatMap((group) => {
    const inGroup = byGroup.get(group)
    if (!inGroup || inGroup.length === 0) return []
    return [{ group, title: t(GROUP_TITLE_KEYS[group]), facets: inGroup }]
  })
}
