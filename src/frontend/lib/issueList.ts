// Rows for the issue-list sidebar: which issues are on screen, in what order.
//
// Pure on purpose — the sidebar is a `.tsx` component and vitest runs in node
// with no DOM, so the ordering and the "what counts as listed" decision live
// here where they can be tested.
//
// The list is NOT recomputed from `Filters`. GraphCanvas publishes the ids of
// the issue cards it actually drew (container views add non-issue nodes, chain
// isolation trims the set), and this module only resolves those ids to issues
// and sorts them. That is what keeps the list and the canvas from disagreeing:
// a second filtering pass here would be a second opinion about the same set.

import type { NormalizedIssue } from '@shared/types.js'

export type IssueSortKey = 'updated' | 'priority' | 'state' | 'assignee' | 'id'

export const ISSUE_SORT_KEYS: readonly IssueSortKey[] = ['updated', 'priority', 'state', 'assignee', 'id']

// Linear's priority numbers are 0 = none, 1 = urgent … 4 = low. Numerically
// ascending would put "No priority" ahead of Urgent, so 0 is ranked last.
function priorityRank(p: number): number {
  return p === 0 ? 5 : p
}

// Roughly "how close to done is the work", earliest first, so a list sorted by
// state reads as a pipeline rather than alphabetically.
const STATE_RANK: Record<string, number> = {
  triage: 0,
  backlog: 1,
  unstarted: 2,
  started: 3,
  completed: 4,
  canceled: 5,
}

function stateRank(type: string): number {
  return STATE_RANK[type] ?? 6
}

/** Split `ONE-443` into a prefix and a number so ids sort numerically. */
function idParts(identifier: string): [string, number] {
  const m = /^(.*?)-(\d+)$/.exec(identifier)
  if (!m) return [identifier, 0]
  return [m[1] ?? identifier, Number(m[2])]
}

function compare(key: IssueSortKey, a: NormalizedIssue, b: NormalizedIssue): number {
  switch (key) {
    case 'updated':
      // Newest first. ISO strings compare correctly as strings.
      return a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0
    case 'priority':
      return priorityRank(a.priority) - priorityRank(b.priority)
    case 'state':
      return stateRank(a.state.type) - stateRank(b.state.type)
    case 'assignee': {
      // Unassigned last — an empty name sorting first would bury the people.
      const an = a.assignee?.displayName
      const bn = b.assignee?.displayName
      if (an === undefined && bn === undefined) return 0
      if (an === undefined) return 1
      if (bn === undefined) return -1
      return an.localeCompare(bn)
    }
    case 'id': {
      const [ap, an] = idParts(a.identifier)
      const [bp, bn] = idParts(b.identifier)
      return ap === bp ? an - bn : ap.localeCompare(bp)
    }
  }
}

/**
 * Resolve the on-screen ids to issues and sort them. Ids that no longer exist
 * in `issues` (a sync landed between the canvas build and this render) are
 * dropped rather than shown as blanks. Ties fall back to identifier so the
 * order is stable across renders — a list that reshuffles equal rows on every
 * hover would be unreadable.
 */
export function buildIssueListRows(
  issues: readonly NormalizedIssue[],
  visibleIds: readonly string[],
  sort: IssueSortKey,
): NormalizedIssue[] {
  const wanted = new Set(visibleIds)
  const rows = issues.filter((i) => wanted.has(i.identifier))
  return rows.sort((a, b) => compare(sort, a, b) || compare('id', a, b))
}

// ── Panel size ──────────────────────────────────────────────────────────────
// The left rail (filter panel + list) and the list's own height are
// user-resizable. Clamped in one place so the drag handler, the store setter
// and the restore-from-localStorage path cannot disagree about the limits — a
// stored value from a larger monitor must not strand the panel off-screen.

export const RAIL_WIDTH_DEFAULT = 300
export const RAIL_WIDTH_MIN = 220
export const RAIL_WIDTH_MAX = 560
export const LIST_HEIGHT_MIN = 120
/** Room left for the filter panel above the list and the zoom controls below. */
const LIST_HEIGHT_RESERVED = 260

export function clampRailWidth(w: number): number {
  if (!Number.isFinite(w)) return RAIL_WIDTH_DEFAULT
  return Math.max(RAIL_WIDTH_MIN, Math.min(RAIL_WIDTH_MAX, Math.round(w)))
}

/** `viewportHeight` bounds the top end so a tall list cannot push past the window. */
export function clampListHeight(h: number, viewportHeight: number): number {
  const max = Math.max(LIST_HEIGHT_MIN, viewportHeight - LIST_HEIGHT_RESERVED)
  if (!Number.isFinite(h)) return LIST_HEIGHT_MIN
  return Math.max(LIST_HEIGHT_MIN, Math.min(max, Math.round(h)))
}

// ── The right-hand column ───────────────────────────────────────────────────
// The column follows the sort key: whatever you ordered by is what you are
// scanning for, so that is the value worth showing. It is a decision, not
// formatting, so it lives here where it can be tested.

export type RowMeta =
  | { kind: 'age'; ts: number }
  | { kind: 'priority'; priority: number }
  | { kind: 'state'; name: string; type: string }
  | { kind: 'assignee'; initials: string; name: string }
  | { kind: 'unassigned' }

/** The slice of Filters that decides whether an assignee column says anything. */
export interface AssigneeFilterShape {
  myIssuesOnly: boolean
  assignees: readonly string[]
  negated?: readonly string[]
}

/**
 * True when every listed row necessarily has the SAME assignee, which makes an
 * assignee column pure noise. That is "My issues" or exactly one assignee
 * selected. One assignee *excluded* is the opposite case — it leaves everybody
 * else — so a negated facet does not count.
 */
export function assigneeColumnRedundant(f: AssigneeFilterShape): boolean {
  if (f.myIssuesOnly) return true
  return f.assignees.length === 1 && !(f.negated ?? []).includes('assignee')
}

/**
 * Two letters standing for a person. Multi-word names take the first letter of
 * the first and last word ("Shawn Lin" → SL); a single token takes its first
 * two characters ("shawndennislin" → SH). Splits on code points so a CJK name
 * does not get cut through a surrogate pair.
 */
export function assigneeInitials(displayName: string): string {
  const tokens = displayName.split(/[\s._-]+/).filter(Boolean)
  if (tokens.length === 0) return '?'
  const chars = (t: string) => Array.from(t)
  if (tokens.length === 1) return chars(tokens[0]!).slice(0, 2).join('').toUpperCase()
  const first = chars(tokens[0]!)[0] ?? ''
  const last = chars(tokens[tokens.length - 1]!)[0] ?? ''
  return (first + last).toUpperCase()
}

/**
 * What the right-hand column shows for one row, or null for none.
 * - updated  → how long ago
 * - priority → the priority
 * - state    → the state's own name (workspace data, not a type)
 * - assignee → initials, or "unassigned"; null when the filter already pins
 *              the assignee to one person
 * - id       → nothing: the identifier is already the row's first column
 */
export function rowMeta(
  issue: NormalizedIssue,
  sort: IssueSortKey,
  filters: AssigneeFilterShape,
): RowMeta | null {
  switch (sort) {
    case 'updated': {
      const ts = new Date(issue.updatedAt).getTime()
      return Number.isFinite(ts) ? { kind: 'age', ts } : null
    }
    case 'priority':
      return { kind: 'priority', priority: issue.priority }
    case 'state':
      return { kind: 'state', name: issue.state.name, type: issue.state.type }
    case 'assignee':
      if (assigneeColumnRedundant(filters)) return null
      return issue.assignee
        ? { kind: 'assignee', initials: assigneeInitials(issue.assignee.displayName), name: issue.assignee.displayName }
        : { kind: 'unassigned' }
    case 'id':
      return null
  }
}
