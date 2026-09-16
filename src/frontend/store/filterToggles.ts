// Pure filter-toggle semantics: `(Filters, what the user clicked) → Filters`.
//
// These lived as eleven `set()` bodies inside viewStore, which was fine while
// the graph was the only thing filters described. It stopped being fine once
// the notification scope became editable: that editor builds a filter the user
// is NOT currently looking at, so it has no store to mutate, and the choice was
// either to re-implement the toggles against a draft object — with the state
// cascade below as the first thing to be got wrong — or to lift them out here.
//
// viewStore now delegates to these, so the two pipelines cannot drift: there is
// one definition of what unchecking a state type does, and both callers run it.
//
// PURE by contract. The one piece of toggle behavior that is NOT a function of
// `Filters` — ticking a completed/canceled state calling `graphStore.extendScope(365)`,
// because that data may sit outside the sync window — deliberately stays in
// FacetBar. It is a *view* concern: it fetches more rows so the graph does not
// look empty. A notification scope draws nothing, so pulling a year of history
// on its behalf would be a side effect with no observer.

import type { IssueStateType } from '@shared/types.js'
import type { FacetDef } from '../components/facets/facetModel'
import type { Filters } from './viewStore'

/** Add `v` if absent, remove it if present. The shared primitive behind every
 *  multi-select dimension — exported because viewStore's `toggleSelection`
 *  (which toggles issue ids, not filters) still wants it. */
export function toggle<T>(arr: T[], v: T): T[] {
  return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]
}

export function toggleStateType(filters: Filters, type: IssueStateType): Filters {
  const stateTypes = toggle(filters.stateTypes, type)
  // This used to also switch off an `activeOnly` boolean when the user turned
  // ON completed or canceled, because otherwise the click silently did nothing.
  // That boolean is gone: it was a second filter over the state dimension whose
  // only possible effect was to contradict this one, so turning a type on now
  // simply turns it on.
  //
  // Names refine within their own type, so unchecking a type must take its
  // children with it — leaving them behind would keep matching issues of a type
  // the user just switched off. Other types' names are untouched; that
  // independence is the whole point of the tree.
  const removingType = !stateTypes.includes(type) && filters.stateTypes.includes(type)
  const stateNames = removingType
    ? filters.stateNames.filter((k) => !k.startsWith(`${type}::`))
    : filters.stateNames
  return { ...filters, stateTypes, stateNames }
}

export function toggleStateName(filters: Filters, name: string): Filters {
  return { ...filters, stateNames: toggle(filters.stateNames, name) }
}

export function togglePrimary(filters: Filters, id: string): Filters {
  return { ...filters, primaryValues: toggle(filters.primaryValues, id) }
}

export function toggleType(filters: Filters, id: string): Filters {
  return { ...filters, typeValues: toggle(filters.typeValues, id) }
}

export function togglePriority(filters: Filters, p: number): Filters {
  return { ...filters, priorities: toggle(filters.priorities, p) }
}

export function toggleAssignee(filters: Filters, name: string): Filters {
  return { ...filters, assignees: toggle(filters.assignees, name) }
}

export function togglePrefix(filters: Filters, token: string, id: string): Filters {
  const cur = filters.prefixSelections[token] ?? []
  return {
    ...filters,
    prefixSelections: { ...filters.prefixSelections, [token]: toggle(cur, id) },
  }
}

export function toggleGroupLabel(filters: Filters, group: string, id: string): Filters {
  const cur = filters.groupSelections[group] ?? []
  return {
    ...filters,
    groupSelections: { ...filters.groupSelections, [group]: toggle(cur, id) },
  }
}

export function toggleOrphan(filters: Filters, id: string): Filters {
  return { ...filters, orphanValues: toggle(filters.orphanValues, id) }
}

export function toggleProject(filters: Filters, id: string): Filters {
  return { ...filters, projectIds: toggle(filters.projectIds, id) }
}

export function toggleMilestone(filters: Filters, compositeKey: string): Filters {
  return { ...filters, milestoneIds: toggle(filters.milestoneIds, compositeKey) }
}

/**
 * Apply one click in a facet option list to a filter set.
 *
 * `isChild` is the second level of the two-level facets and means different
 * things per dimension — a state NAME under a state type, a MILESTONE under a
 * project — which is why it is a positional flag rather than a kind of its own:
 * the facet already says which dimension we are in.
 *
 * Prefix and group facets carry their key in the facet id (`prefix:horizon`,
 * `group:Risk`) because those namespaces are the workspace's own label names,
 * not an enum this code could know ahead of time.
 *
 * Note the asymmetry in the last three cases: `designdoc`, `due` and `time`
 * ASSIGN rather than toggle, so re-picking the selected option leaves it
 * selected. Their option lists each include an explicit "any"/"all" row, which
 * is the way out — a click-to-clear on top of that would give one dimension two
 * different ways to mean the same thing.
 */
export function applyFacetPick(
  filters: Filters,
  facet: FacetDef,
  value: string,
  isChild: boolean,
): Filters {
  switch (facet.kind) {
    case 'quick':
      return facet.id === 'quick:mine'
        ? { ...filters, myIssuesOnly: !filters.myIssuesOnly }
        : { ...filters, staleOnly: !filters.staleOnly }
    case 'state':
      return isChild
        ? toggleStateName(filters, value)
        : toggleStateType(filters, value as IssueStateType)
    case 'primary':
      return togglePrimary(filters, value)
    case 'type':
      return toggleType(filters, value)
    case 'priority':
      // `Number`, not a truthiness check: 0 is "No priority", a value the user
      // picks, and it round-trips through the option list as the string '0'.
      return togglePriority(filters, Number(value))
    case 'assignee':
      return toggleAssignee(filters, value)
    case 'project':
      return isChild ? toggleMilestone(filters, value) : toggleProject(filters, value)
    case 'prefix':
      return togglePrefix(filters, facet.id.slice('prefix:'.length), value)
    case 'group':
      return toggleGroupLabel(filters, facet.id.slice('group:'.length), value)
    case 'orphan':
      return toggleOrphan(filters, value)
    case 'designdoc':
      return { ...filters, designdocFilter: value as Filters['designdocFilter'] }
    case 'due':
      return { ...filters, dueFilter: value as Filters['dueFilter'] }
    case 'time':
      return { ...filters, recencyWindow: value as Filters['recencyWindow'] }
  }
}
