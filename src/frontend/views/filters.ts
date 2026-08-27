// Shared filter logic across views.

import type { NormalizedIssue } from '@shared/types.js'
import type { Filters } from '../store/viewStore'
import { isDueWithin, isOverdueIssue } from '../lib/dueDate'
import { passesRecency } from '../lib/recency'

// Filter-panel "leave-one-out" counting: when showing the count next to e.g.
// "(unassigned)", we want it to reflect "if you click this, how many issues
// will be visible?" — not "how many unassigned issues exist in cache total"
// (which would include canceled ones the active-only filter hides).
//
// Achieved by clearing only the named dimension's filter values, then re-
// running applyFilters. All other dimensions stay applied.
export type FilterDimension =
  | 'state'
  | 'priority'
  | 'assignee'
  | 'primary'
  | 'type'
  | 'prefix'
  | 'group'
  | 'orphan'
  // Every label dimension at once. The filter panel derives all label counts
  // from a single pass, and each label section needs to see the alternatives
  // it could switch to — an exclusive group whose siblings all count 0 is a
  // dead end.
  | 'label'
  | 'project'
  | 'due'
  | 'time'

export function applyFiltersExcluding(
  issues: NormalizedIssue[],
  filters: Filters,
  staleDays: number,
  myUserName: string | null,
  search: string | undefined,
  exclude: FilterDimension,
): NormalizedIssue[] {
  const f: Filters = { ...filters }
  switch (exclude) {
    case 'state':
      f.stateTypes = []
      f.stateNames = []
      // activeOnly is a state-dimension shortcut ("state ∈ active set").
      // Drop it too so counts for Canceled / Completed reflect reality
      // instead of always showing 0 because activeOnly hides them.
      f.activeOnly = false
      break
    case 'priority':
      f.priorities = []
      break
    case 'assignee':
      f.assignees = []
      // myIssuesOnly is part of the assignee dimension conceptually.
      f.myIssuesOnly = false
      break
    case 'primary':
      f.primaryValues = []
      break
    case 'type':
      f.typeValues = []
      break
    case 'prefix':
      f.prefixSelections = {}
      break
    case 'group':
      f.groupSelections = {}
      break
    case 'orphan':
      f.orphanValues = []
      break
    case 'label':
      f.primaryValues = []
      f.typeValues = []
      f.prefixSelections = {}
      f.groupSelections = {}
      f.orphanValues = []
      break
    case 'project':
      // Project and milestone are the same hierarchical dimension. Clearing
      // 'project' clears both so leave-one-out counts for any row in that
      // section share the same base (mirrors how 'state' clears stateTypes
      // + stateNames + activeOnly together).
      f.projectIds = []
      f.milestoneIds = []
      break
    case 'due':
      f.dueFilter = 'any'
      break
    case 'time':
      // Only the window is cleared. recencyMode is a mode selector, not a
      // filter value — zeroing it would change which timestamp the *other*
      // dimensions' counts are computed against.
      f.recencyWindow = 'any'
      break
  }
  return applyFilters(issues, f, staleDays, myUserName, search)
}

/** Separator for the composite `<type>::<name>` keys in Filters.stateNames.
 *  Same convention as milestoneFilterKey — the key carries its own parent so
 *  applyFilters needs no lookup table. */
export const STATE_NAME_SEP = '::'

/** Build the composite key stored in Filters.stateNames. */
export function stateNameKey(type: string, name: string): string {
  return `${type}${STATE_NAME_SEP}${name}`
}

/** Composite key for issues that have a project but no milestone within it.
 *  Stored inside Filters.milestoneIds as '<projectId>::__nomilestone'. */
export const NO_MILESTONE_TOKEN = '__nomilestone'

/** Build the composite key used in Filters.milestoneIds for an issue. */
export function milestoneFilterKey(projectId: string, milestoneId: string | null): string {
  return `${projectId}::${milestoneId ?? NO_MILESTONE_TOKEN}`
}

/**
 * Facet ids that `Filters.negated` may contain. Prefix and label-group facets
 * are dynamic (`prefix:<token>`, `group:<key>`) so they are not listed.
 *
 * These strings are the same ids facetModel builds, deliberately: they already
 * travel in the URL, so one vocabulary serves the UI, the engine and the link.
 */
export const NEGATABLE_FACETS = [
  'state',
  'primary',
  'type',
  'priority',
  'assignee',
  'project',
  'orphan',
] as const

/** Whether a facet's selection is inverted. `?? []` guards tab snapshots
 *  written before the field existed — same reason as groupSelections below. */
function negated(filters: Filters, facetId: string): boolean {
  return (filters.negated ?? []).includes(facetId)
}

/**
 * Apply a membership test, inverting it when the facet is negated.
 *
 * `hit` is "this issue matches the selection". Un-negated, a miss excludes the
 * issue; negated, a hit does. Written as one helper so the two readings can
 * never drift apart across the eleven places this is applied.
 */
function passes(hit: boolean, isNegated: boolean): boolean {
  return hit !== isNegated
}

export function applyFilters(
  issues: NormalizedIssue[],
  filters: Filters,
  staleDays: number,
  myUserName: string | null,
  search?: string,
): NormalizedIssue[] {
  const now = Date.now()
  const cutoff = now - staleDays * 24 * 3600 * 1000
  const q = (search ?? '').trim().toLowerCase()
  return issues.filter((i) => {
    if (q.length > 0) {
      // Match against identifier, title, or assignee. Case-insensitive substring.
      const hay = `${i.identifier} ${i.title} ${i.assignee?.displayName ?? ''}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    // State filter precedence:
    //   stateNames (explicit Linear state.name pick) > stateTypes + activeOnly
    // When user explicitly picks named states, the activeOnly shortcut is
    // overridden — it's a quick filter, not a hard gate. Without this, a
    // user picking "Duplicate" (canonical=canceled) with activeOnly still
    // on would silently see nothing.
    // State is a two-level tree: canonical type, then the workspace's own state
    // names within it. Names REFINE their own type rather than replacing the
    // whole selection — picking "Todo" narrows Unstarted to Todo and leaves
    // Started and Backlog untouched. (It used to shadow every type at once,
    // which read as the tree being mutually exclusive.)
    //
    // The composite `<type>::<name>` key is what makes this possible without a
    // name -> type lookup here: the key carries its own type, exactly as
    // milestoneIds carries its project.
    const stateNegated = negated(filters, 'state')
    const typePrefix = `${i.state.type}${STATE_NAME_SEP}`
    const refinedWithinType = filters.stateNames.some((k) => k.startsWith(typePrefix))
    if (refinedWithinType) {
      // Naming a state implies its type is wanted, so activeOnly and the type
      // list are both bypassed here — otherwise picking "Duplicate"
      // (canonically canceled) with activeOnly on would silently match nothing.
      if (!passes(filters.stateNames.includes(`${typePrefix}${i.state.name}`), stateNegated)) {
        return false
      }
    } else if (filters.stateNames.some((k) => !k.includes(STATE_NAME_SEP))) {
      // Back-compat: a bare name, from a tab snapshot or link written before
      // the keys became composite. Matched by name alone, ignoring type.
      if (!passes(filters.stateNames.includes(i.state.name), stateNegated)) return false
    } else {
      if (filters.activeOnly && (i.state.type === 'completed' || i.state.type === 'canceled')) return false
      if (
        filters.stateTypes.length > 0 &&
        !passes(filters.stateTypes.includes(i.state.type), stateNegated)
      ) {
        return false
      }
    }
    if (
      filters.priorities.length > 0 &&
      !passes(filters.priorities.includes(i.priority), negated(filters, 'priority'))
    ) {
      return false
    }
    if (filters.assignees.length > 0) {
      const name = i.assignee?.displayName ?? '(unassigned)'
      if (!passes(filters.assignees.includes(name), negated(filters, 'assignee'))) return false
    }
    if (filters.myIssuesOnly && myUserName && i.assignee?.displayName !== myUserName) return false
    if (filters.staleOnly) {
      const u = new Date(i.updatedAt).getTime()
      if (u >= cutoff) return false
    }
    // Adjacent to staleOnly because they are complements: staleOnly keeps
    // issues updated *before* its cutoff, recency keeps those touched *after*
    // one. Enabling both is legal but almost always yields an empty set.
    if (!passesRecency(i, filters.recencyMode, filters.recencyWindow, now)) return false
    if (filters.primaryValues.length > 0) {
      const hit = i.labels.some((l) => filters.primaryValues.includes(l.id))
      if (!passes(hit, negated(filters, 'primary'))) return false
    }
    if (filters.typeValues.length > 0) {
      const hit = i.labels.some((l) => filters.typeValues.includes(l.id))
      if (!passes(hit, negated(filters, 'type'))) return false
    }
    for (const [token, ids] of Object.entries(filters.prefixSelections)) {
      if (ids.length === 0) continue
      const hit = i.labels.some((l) => ids.includes(l.id))
      if (!passes(hit, negated(filters, `prefix:${token}`))) return false
    }
    // `?? {}` / `?? []`: filters are restored verbatim from localStorage tab
    // snapshots, so a payload written before these fields existed reaches
    // here with them undefined. Cheaper than a migration and keeps the
    // filter pure — see tabStateStore's STORAGE_VERSION note.
    for (const [key, ids] of Object.entries(filters.groupSelections ?? {})) {
      if (ids.length === 0) continue
      const hit = i.labels.some((l) => ids.includes(l.id))
      if (!passes(hit, negated(filters, `group:${key}`))) return false
    }
    if ((filters.orphanValues ?? []).length > 0) {
      const hit = i.labels.some((l) => filters.orphanValues.includes(l.id))
      if (!passes(hit, negated(filters, 'orphan'))) return false
    }
    switch (filters.dueFilter) {
      case 'any':
        break
      case 'has':
        if (!i.dueDate) return false
        break
      case 'overdue':
        if (!isOverdueIssue(i)) return false
        break
      case 'soon7':
        if (!isDueWithin(i, 7)) return false
        break
      case 'soon30':
        if (!isDueWithin(i, 30)) return false
        break
    }
    // Project / milestone hierarchy. Child (milestoneIds) takes precedence
    // over parent (projectIds) — mirrors stateNames > stateTypes. When the
    // child is empty, parent applies; when child is set, parent is ignored.
    const projectNegated = negated(filters, 'project')
    if (filters.milestoneIds.length > 0) {
      const projId = i.project?.id
      // Issues without a project can never match any milestone selection
      // (milestones are project-scoped in Linear's data model). Under
      // negation that makes them non-matches, so they PASS — "not in these
      // milestones" is true of an issue that is in no milestone at all.
      if (!projId) return projectNegated
      const key = milestoneFilterKey(projId, i.projectMilestone?.id ?? null)
      if (!passes(filters.milestoneIds.includes(key), projectNegated)) return false
    } else if (filters.projectIds.length > 0) {
      // '__noproject' is the sentinel for "issues without a Linear project".
      // Mirrors the Project view's grouping key so the filter UI and view
      // stay aligned.
      const key = i.project?.id ?? '__noproject'
      if (!passes(filters.projectIds.includes(key), projectNegated)) return false
    }
    return true
  })
}
