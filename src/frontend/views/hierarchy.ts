// Sub-issue (parent/children) resolution. Linear exposes hierarchy as its own
// `parent` / `children` fields — NOT as entries in `relations` — so it never
// reaches the graph through the blocks/related path and needs its own module.
//
// Counts here are cache-wide (over the issues handed in), mirroring
// connectivity.ts: the badge is a global summary, while edges convey local
// visibility. IssueNode surfaces both numbers when they disagree.

import type { NormalizedIssue } from '@shared/types.js'

/** Linear's issue query pages children at `first: 20` (see
 *  sources/linear/queries.ts). A child list of exactly this length may have
 *  been silently cut short, so progress must be rendered as "20+". */
const CHILDREN_PAGE_SIZE = 20

/** A hierarchy link. `issue` is null when the referenced issue isn't in the
 *  cache — pruned by the active+recent sync scope, filtered out, or beyond
 *  the children page cap. The identifier is always known. */
export interface HierarchyRef {
  identifier: string
  issue: NormalizedIssue | null
}

export interface HierarchyInfo {
  parent: HierarchyRef | null
  children: HierarchyRef[]
  /** Children in a terminal state (`completed` or `canceled`). */
  done: number
  /** `children.length` — includes children missing from the cache. */
  total: number
  /** Children missing from the cache. When > 0, `done` understates progress:
   *  we can't know the state of an issue we don't have. Understating is the
   *  safe direction, but the UI should disclose it. */
  unresolved: number
  /** True when the child list may have been truncated by the API page cap. */
  truncated: boolean
}

function isDone(issue: NormalizedIssue): boolean {
  return issue.state.type === 'completed' || issue.state.type === 'canceled'
}

/** Resolve one issue's hierarchy against the cache. Used by DetailPanel, which
 *  needs titles and states, not just identifiers. */
export function resolveHierarchy(
  issue: NormalizedIssue,
  byId: Map<string, NormalizedIssue>,
): HierarchyInfo {
  const parent: HierarchyRef | null = issue.parent
    ? { identifier: issue.parent, issue: byId.get(issue.parent) ?? null }
    : null

  const children: HierarchyRef[] = issue.children.map((identifier) => ({
    identifier,
    issue: byId.get(identifier) ?? null,
  }))

  let done = 0
  let unresolved = 0
  for (const c of children) {
    if (!c.issue) unresolved += 1
    else if (isDone(c.issue)) done += 1
  }

  return {
    parent,
    children,
    done,
    total: children.length,
    unresolved,
    truncated: children.length >= CHILDREN_PAGE_SIZE,
  }
}

/** Progress summary for the IssueNode badge. */
export interface HierarchyCounts {
  done: number
  total: number
  truncated: boolean
}

/** Cache-wide sub-issue counts, keyed by identifier. Mirrors
 *  {@link computeConnectivity}'s signature so views wire it in the same way.
 *
 *  Issues with no children are omitted rather than mapped to zeros — the badge
 *  should be absent, not render "0/0", and an absent key makes that the
 *  default at the call site. */
export function computeHierarchyCounts(
  issues: NormalizedIssue[],
): Map<string, HierarchyCounts> {
  const byId = new Map<string, NormalizedIssue>()
  for (const i of issues) byId.set(i.identifier, i)

  const result = new Map<string, HierarchyCounts>()
  for (const i of issues) {
    if (i.children.length === 0) continue
    const { done, total, truncated } = resolveHierarchy(i, byId)
    result.set(i.identifier, { done, total, truncated })
  }
  return result
}

/** How many of an issue's children are actually rendered in the current view.
 *  Chain isolation and filters can hide most of them, so IssueNode discloses
 *  this alongside the cache-wide total — same treatment connectivity gets. */
export function countVisibleChildren(
  issue: NormalizedIssue,
  visibleIds: Set<string>,
): number {
  let n = 0
  for (const c of issue.children) if (visibleIds.has(c)) n += 1
  return n
}
