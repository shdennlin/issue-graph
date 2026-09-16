// Option lists for the write-back dropdowns.
//
// Kept out of the panel because the panel is untestable here (vitest runs
// `environment: 'node'`), and both of these have a rule that is easy to get
// wrong and invisible when you do.

import type {
  NormalizedAssignee,
  NormalizedIssue,
  NormalizedLabel,
  WorkflowState,
} from '@shared/types.js'

/**
 * The states this issue can actually be moved to.
 *
 * Workflow states belong to a team, and `fetchWorkflowStates` returns every
 * team's. Offering all of them in a multi-team workspace produces a dropdown
 * that looks right and fails on submit, because a state id from another team is
 * not a legal target. When the issue has no team, or no state carries a
 * teamKey (a single-team workspace, where the field is not populated), the full
 * list is the correct answer rather than an empty one.
 *
 * Ordered by Linear's own `position` so the dropdown reads in workflow order
 * (Backlog → Todo → In Progress → Done) rather than alphabetically; ties fall
 * back to name so the order is at least stable.
 */
export function statusOptionsFor(
  states: WorkflowState[],
  teamKey: string | null | undefined,
): WorkflowState[] {
  const scoped =
    teamKey && states.some((s) => s.teamKey)
      ? states.filter((s) => !s.teamKey || s.teamKey === teamKey)
      : states
  return scoped.slice().sort((a, b) => {
    const pa = a.position ?? Number.MAX_SAFE_INTEGER
    const pb = b.position ?? Number.MAX_SAFE_INTEGER
    if (pa !== pb) return pa - pb
    return a.name.localeCompare(b.name)
  })
}

/**
 * People this issue can be assigned to, derived from the cached issues.
 *
 * There is no user-roster endpoint, so the reachable set is "anyone already
 * assigned to something in this workspace's cache". That is a real limit — a
 * brand-new teammate cannot be picked until they own an issue — and it is the
 * reason this is a separate derivation rather than a reuse of the facet
 * pipeline: the facets key by display name (a locale-stable URL token) and
 * truncate to a display limit, neither of which survives being used to write.
 *
 * An assignee with no `id` is dropped rather than offered: `id` is optional on
 * NormalizedAssignee, and an option that cannot produce an assigneeId would
 * fail only at submit time.
 */
export function assigneeOptionsFrom(issues: NormalizedIssue[]): NormalizedAssignee[] {
  const byId = new Map<string, NormalizedAssignee>()
  for (const issue of issues) {
    const a = issue.assignee
    if (!a?.id) continue
    if (!byId.has(a.id)) byId.set(a.id, a)
  }
  return [...byId.values()].sort((x, y) => x.displayName.localeCompare(y.displayName))
}

/**
 * Find the WorkflowState matching an issue's current state.
 *
 * NormalizedIssue.state is `{ name, type }` with no id, so name is the only
 * join key available — which is also why this can miss: a state renamed in the
 * tracker since the last sync will not match, and the dropdown then shows no
 * selection rather than the wrong one.
 */
export function matchCurrentState(
  options: WorkflowState[],
  state: { name: string; type: string },
): WorkflowState | null {
  return (
    options.find((o) => o.name === state.name && o.type === state.type) ??
    options.find((o) => o.name === state.name) ??
    null
  )
}

/**
 * Labels that can be put on an issue, derived from the cached issues.
 *
 * Same reachability limit as the assignee list, for the same reason: there is
 * no label-roster endpoint (`GET /api/labels` returns the *detected schema*,
 * not an inventory), so a label nobody has used yet cannot be offered. Grouped
 * labels sort by group first so the dropdown mirrors how the panel already
 * displays them.
 */
export function labelOptionsFrom(issues: NormalizedIssue[]): NormalizedLabel[] {
  const byId = new Map<string, NormalizedLabel>()
  for (const issue of issues) {
    for (const l of issue.labels ?? []) {
      if (!l?.id) continue
      if (!byId.has(l.id)) byId.set(l.id, l)
    }
  }
  return [...byId.values()].sort((a, b) => {
    const ga = a.group?.name ?? ''
    const gb = b.group?.name ?? ''
    if (ga !== gb) return ga.localeCompare(gb)
    return a.name.localeCompare(b.name)
  })
}

/** The options that are not already on the issue — what an "add label" control
 *  should offer. Offering one already applied would send a delta that changes
 *  nothing and still costs a round trip. */
export function addableLabels(
  options: NormalizedLabel[],
  current: NormalizedLabel[] | undefined,
): NormalizedLabel[] {
  const have = new Set((current ?? []).map((l) => l.id))
  return options.filter((l) => !have.has(l.id))
}
