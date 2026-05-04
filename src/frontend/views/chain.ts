// Compute the connected component of issues over `blocks` edges (both
// directions, transitive) starting from a single root identifier.
//
// Used by the dependency view's "Isolate chain" mode: right-click an issue,
// pick "Isolate chain", and the view collapses to the full transitive set of
// blockers + things-it-blocks for that issue.

import type { NormalizedIssue } from '@shared/types.js'

export function computeChain(issues: NormalizedIssue[], rootId: string): Set<string> {
  const result = new Set<string>()
  const byId = new Map<string, NormalizedIssue>()
  for (const i of issues) byId.set(i.identifier, i)
  if (!byId.has(rootId)) return result

  // Forward: i.relations[type=blocks].targetIdentifier (i blocks target).
  // Reverse: build the inverse so we can walk "blocked by" upstream too.
  const reverse = new Map<string, string[]>()
  for (const i of issues) {
    for (const r of i.relations) {
      if (r.type !== 'blocks') continue
      // Only add to reverse if both endpoints exist in the issue set;
      // dangling references from cache shouldn't produce ghost neighbors.
      if (!byId.has(r.targetIdentifier)) continue
      const list = reverse.get(r.targetIdentifier) ?? []
      list.push(i.identifier)
      reverse.set(r.targetIdentifier, list)
    }
  }

  const queue: string[] = [rootId]
  result.add(rootId)
  while (queue.length > 0) {
    const id = queue.shift()!
    const node = byId.get(id)
    if (node) {
      for (const r of node.relations) {
        if (r.type !== 'blocks') continue
        if (!byId.has(r.targetIdentifier)) continue
        if (!result.has(r.targetIdentifier)) {
          result.add(r.targetIdentifier)
          queue.push(r.targetIdentifier)
        }
      }
    }
    for (const upstream of reverse.get(id) ?? []) {
      if (!result.has(upstream)) {
        result.add(upstream)
        queue.push(upstream)
      }
    }
  }

  return result
}
