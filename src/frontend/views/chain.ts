// Compute the connected component of issues over `blocks` edges (both
// directions, transitive) starting from a single root identifier.
//
// Used by the dependency view's "Isolate chain" mode: right-click an issue,
// pick "Isolate chain", and the view collapses to the full transitive set of
// blockers + things-it-blocks for that issue.

import type { NormalizedIssue } from '@shared/types.js'

export interface ChainResult {
  /** Identifiers of all issues in the connected component (incl. root). */
  members: Set<string>
  /** Identifiers referenced via `blocks` from chain members but NOT present
   * in the issue set — typically older Done/Canceled issues pruned by the
   * default `active+recent` backend scope. UI uses this count to offer a
   * "load older history" prompt. */
  dangling: Set<string>
}

export interface ChainOptions {
  /** When true, additionally include the 1-hop `related` neighbors of any
   * chain member. Doesn't recurse — we want context, not a full transitive
   * blow-up over `related` (which is bidirectional and densely connected
   * in many workspaces). */
  includeRelatedNeighbors?: boolean
}

export function computeChain(
  issues: NormalizedIssue[],
  rootId: string,
  opts: ChainOptions = {},
): ChainResult {
  const members = new Set<string>()
  const dangling = new Set<string>()
  const byId = new Map<string, NormalizedIssue>()
  for (const i of issues) byId.set(i.identifier, i)
  if (!byId.has(rootId)) return { members, dangling }

  // Forward: i.relations[type=blocks].targetIdentifier (i blocks target).
  // Reverse: build the inverse so we can walk "blocked by" upstream too.
  // Only links between cached issues go into reverse; dangling refs are
  // tracked separately so the UI can offer to extend the cache window.
  const reverse = new Map<string, string[]>()
  for (const i of issues) {
    for (const r of i.relations) {
      if (r.type !== 'blocks') continue
      if (!byId.has(r.targetIdentifier)) continue
      const list = reverse.get(r.targetIdentifier) ?? []
      list.push(i.identifier)
      reverse.set(r.targetIdentifier, list)
    }
  }

  const queue: string[] = [rootId]
  members.add(rootId)
  while (queue.length > 0) {
    const id = queue.shift()!
    const node = byId.get(id)
    if (node) {
      for (const r of node.relations) {
        if (r.type !== 'blocks') continue
        if (!byId.has(r.targetIdentifier)) {
          // Reference points outside cache — typically an older Done blocker
          // pruned by the default `active+recent` backend scope.
          dangling.add(r.targetIdentifier)
          continue
        }
        if (!members.has(r.targetIdentifier)) {
          members.add(r.targetIdentifier)
          queue.push(r.targetIdentifier)
        }
      }
    }
    for (const upstream of reverse.get(id) ?? []) {
      if (!members.has(upstream)) {
        members.add(upstream)
        queue.push(upstream)
      }
    }
  }

  // 1-hop `related` expansion (opt-in). Done after the blocks BFS so the
  // dangling set above only counts blocks-dangling — that's what the UI's
  // "Load full history" button uses, and we don't want related-only
  // references inflating that count.
  if (opts.includeRelatedNeighbors) {
    const blocksMembers = Array.from(members)
    for (const id of blocksMembers) {
      const node = byId.get(id)
      if (!node) continue
      for (const r of node.relations) {
        if (r.type !== 'related') continue
        if (!byId.has(r.targetIdentifier)) continue
        members.add(r.targetIdentifier)
      }
    }
  }

  return { members, dangling }
}
