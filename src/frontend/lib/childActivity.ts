// Rolling a sub-issue's activity up to its parent.
//
// Linear does not bump a parent's `updatedAt` when a child moves. A card whose
// three sub-issues were all worked on today is, as far as `updatedAt` is
// concerned, untouched — so "recent activity" hides exactly the parents whose
// work is most alive. Measured on a live workspace: of the parents with a child
// updated in the last 90 days, two of three had an older `updatedAt` than their
// newest child.
//
// Costs nothing to fix. `children` already rides along in the issue payload as
// a list of identifiers, and each child is itself a row in the same array, so
// the newest child timestamp is a lookup rather than a request. That is also
// the limit, and it is the same one `linkTouch.ts` has: a child outside the
// loaded set is invisible here, and the parent keeps its raw `updatedAt` rather
// than being reported as something false.
//
// One level only. A grandchild's activity reaches its own parent, not the
// grandparent. Deeper roll-up would need a traversal with cycle protection for
// a case Linear's own UI does not model either.

import type { NormalizedIssue } from '@shared/types.js'

type ChildSource = Pick<NormalizedIssue, 'identifier' | 'updatedAt' | 'children'>

/** identifier → newest `updatedAt` among that issue's loaded children. */
export type ChildActivityIndex = Map<string, string>

export const EMPTY_CHILD_ACTIVITY_INDEX: ChildActivityIndex = new Map()

export function buildChildActivityIndex(issues: readonly ChildSource[]): ChildActivityIndex {
  const byId = new Map<string, ChildSource>()
  for (const i of issues) byId.set(i.identifier, i)

  const out: ChildActivityIndex = new Map()
  for (const issue of issues) {
    if (issue.children.length === 0) continue
    let newest: string | undefined
    for (const childId of issue.children) {
      const child = byId.get(childId)
      if (!child) continue
      // String compare, not Date: these are ISO-8601 UTC strings from the same
      // source, so lexical order is chronological order and parsing every one
      // of them would be work for nothing.
      if (newest === undefined || child.updatedAt > newest) newest = child.updatedAt
    }
    if (newest !== undefined) out.set(issue.identifier, newest)
  }
  return out
}

/**
 * `buildChildActivityIndex` memoized on the array it was given — same contract
 * and same reasoning as `getLinkTouchIndex`: the filter pass runs six times per
 * keystroke through leave-one-out counting, and keying on array identity gets
 * one build per data load without threading the index through every view.
 */
const memo = new WeakMap<readonly ChildSource[], ChildActivityIndex>()

export function getChildActivityIndex(issues: readonly ChildSource[]): ChildActivityIndex {
  const hit = memo.get(issues)
  if (hit) return hit
  const built = buildChildActivityIndex(issues)
  memo.set(issues, built)
  return built
}
