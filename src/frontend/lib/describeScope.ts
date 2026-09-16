// Spell out what a stored notification scope actually constrains.
//
// The tempting shortcut was `chipsFromFilters` — the facet bar's own chip
// derivation. It is pure over its `filters` argument, but its second argument
// is a `FacetDef[]` built by `buildFacets`, which OMITS a facet whose dimension
// is empty in the *live* graph. Drawing a stored scope against live facets can
// therefore drop a dimension the scope constrains, and the reader is told they
// hear about more than they do. This module takes the opposite tack: describe
// the `Filters` itself, and where an id has no name to hand, print the id.
// Never drop.
//
// Names are resolved from whatever the graph happens to know. That is a
// display nicety, not a correctness requirement — the gate runs on ids.

import type { NormalizedIssue, NormalizedLabel } from '@shared/types.js'
import type { DictKey } from '../i18n'
import type { Locale } from '../i18n/store'
import { priorityLabelFor } from './colors'
import type { Filters } from '../store/viewStore'
import { NO_MILESTONE_TOKEN, STATE_NAME_SEP } from '../views/filters'

/** One dimension of the scope, fully resolved and ready to render. */
export interface ScopeLine {
  /** The dimension's name, translated. */
  label: string
  /** Values, translated. Empty for a boolean dimension that is simply on. */
  values: string[]
  /** True when the facet is inverted — "is not any of". */
  negated: boolean
}

/** Translator, taken as an argument so this module stays pure and testable —
 *  the same shape `facetModel.chipsFromFilters` uses. Typing it against
 *  `DictKey` is what turns a mistyped key into a compile error. */
export type Translate = (key: DictKey, params?: Record<string, string | number>) => string

export interface NameLookup {
  label: (id: string) => string
  project: (id: string) => string
}

/** Build id -> name maps from the cached graph. Missing ids fall back to the
 *  id itself, which is ugly on purpose: a scope naming something this
 *  workspace has never seen is worth noticing, not hiding. */
export function buildNameLookup(
  issues: readonly NormalizedIssue[],
  labels: readonly NormalizedLabel[],
): NameLookup {
  const labelNames = new Map<string, string>()
  for (const l of labels) labelNames.set(l.id, l.name)
  const projectNames = new Map<string, string>()
  for (const i of issues) {
    if (i.project) projectNames.set(i.project.id, i.project.name)
    for (const l of i.labels) if (!labelNames.has(l.id)) labelNames.set(l.id, l.name)
  }
  return {
    label: (id) => labelNames.get(id) ?? id,
    project: (id) => projectNames.get(id) ?? id,
  }
}

/** Every label-shaped dimension flattened into one list. The scope panel does
 *  not need to reproduce the schema's primary/type/prefix/group taxonomy — the
 *  reader wants to know which labels, not which bucket the schema put them in. */
function allLabelIds(f: Filters): string[] {
  return [
    ...f.primaryValues,
    ...f.typeValues,
    ...f.orphanValues,
    ...Object.values(f.prefixSelections).flat(),
    ...Object.values(f.groupSelections).flat(),
  ]
}

/**
 * Describe a scope, one line per constrained dimension.
 *
 * Note what is NOT here: a dimension at its default is skipped, but
 * `stateTypes` is checked against "all six" rather than against the default
 * four, because the question is whether the field *constrains* — not whether
 * it differs from a default that already excludes a third of the state space.
 */
export function describeScope(
  f: Filters,
  names: NameLookup,
  t: Translate,
  locale: Locale,
): ScopeLine[] {
  const lines: ScopeLine[] = []
  const neg = (id: string): boolean => f.negated.includes(id)

  if (f.stateNames.length > 0) {
    // Composite '<type>::<name>' keys — the name half is what to show.
    lines.push({
      label: t('filterPanel.state'),
      values: f.stateNames.map((k) => k.split(STATE_NAME_SEP)[1] ?? k),
      negated: neg('state'),
    })
  } else if (f.stateTypes.length > 0 && f.stateTypes.length < 6) {
    lines.push({
      label: t('filterPanel.state'),
      values: f.stateTypes.map((ty) => t(`states.${ty}` as DictKey)),
      negated: neg('state'),
    })
  }

  if (f.priorities.length > 0) {
    lines.push({
      label: t('filterPanel.priority'),
      values: f.priorities.map((p) => priorityLabelFor(p, locale)),
      negated: neg('priority'),
    })
  }

  if (f.assignees.length > 0) {
    lines.push({
      label: t('filterPanel.assignee'),
      values: f.assignees,
      negated: neg('assignee'),
    })
  }

  if (f.projectIds.length > 0) {
    lines.push({
      label: t('filterPanel.project'),
      values: f.projectIds.map(names.project),
      negated: neg('project'),
    })
  }

  if (f.milestoneIds.length > 0) {
    lines.push({
      label: t('filterPanel.projectMilestone'),
      values: f.milestoneIds.map((k) => {
        const [, milestone] = k.split(STATE_NAME_SEP)
        return milestone === NO_MILESTONE_TOKEN ? t('filterPanel.noMilestone') : (milestone ?? k)
      }),
      negated: false,
    })
  }

  const labelIds = allLabelIds(f)
  if (labelIds.length > 0) {
    lines.push({
      label: t('filterPanel.otherLabels'),
      values: labelIds.map(names.label),
      negated: false,
    })
  }

  if (f.dueFilter !== 'any') {
    const DUE: Record<Exclude<Filters['dueFilter'], 'any'>, DictKey> = {
      has: 'filterPanel.dueDateHas',
      overdue: 'filterPanel.dueDateOverdue',
      soon7: 'filterPanel.dueDateSoon7',
      soon30: 'filterPanel.dueDateSoon30',
    }
    lines.push({ label: t('filterPanel.dueDate'), values: [t(DUE[f.dueFilter])], negated: false })
  }
  if (f.recencyWindow !== 'any') {
    lines.push({
      label: t('filterPanel.recency'),
      values: [f.recencyWindow],
      negated: neg('recency'),
    })
  }
  if (f.designdocFilter !== 'all') {
    lines.push({
      label: t('filterPanel.designDoc'),
      values: [
        t(f.designdocFilter === 'has' ? 'filterPanel.designDocHas' : 'filterPanel.designDocMissing'),
      ],
      negated: false,
    })
  }
  if (f.myIssuesOnly) {
    lines.push({ label: t('filterPanel.myIssues'), values: [], negated: false })
  }
  if (f.staleOnly) {
    lines.push({ label: t('filterPanel.staleOnly'), values: [], negated: false })
  }

  return lines
}
