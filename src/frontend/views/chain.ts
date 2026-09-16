// Compute the connected component of issues over `blocks` edges (both
// directions, transitive) starting from one or more root identifiers.
//
// Used by the "Isolate chain" mode: right-click an issue (or multi-select a
// set of issues) and the view collapses to the full transitive set of
// blockers + things-they-block. With multiple roots the result is the UNION
// of each root's component — computed in a single BFS by seeding every root
// into the same queue, so overlapping components de-dupe for free.

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
  /** When true, additionally include the 1-hop parent and children of any
   * chain member. Deliberately NOT part of the blocks BFS: hierarchy is a
   * structural axis orthogonal to dependency, so it has no meaningful reading
   * under maxUpstream/maxDownstream, and walking it transitively would defeat
   * chain isolation — one sub-issue would drag in its parent, every sibling,
   * and each sibling's own blocks component. */
  includeHierarchyNeighbors?: boolean
  /** Max upstream hops (blockers) to walk from the nearest root. `null`/
   * `undefined` = unbounded. 0 = roots only (no blockers). */
  maxUpstream?: number | null
  /** Max downstream hops (things the roots block, transitively) to walk from
   * the nearest root. `null`/`undefined` = unbounded. 0 = roots only. */
  maxDownstream?: number | null
}

/** Single-root chain — thin wrapper over {@link computeChains}. */
export function computeChain(
  issues: NormalizedIssue[],
  rootId: string,
  opts: ChainOptions = {},
): ChainResult {
  return computeChains(issues, [rootId], opts)
}

export function computeChains(
  issues: NormalizedIssue[],
  rootIds: string[],
  opts: ChainOptions = {},
): ChainResult {
  const members = new Set<string>()
  const dangling = new Set<string>()
  const byId = new Map<string, NormalizedIssue>()
  for (const i of issues) byId.set(i.identifier, i)

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

  // Seed every present root. Roots outside the cache are skipped; with
  // multiple roots the union falls out of the shared `members` set.
  const seeds: string[] = []
  for (const rootId of rootIds) {
    if (!byId.has(rootId)) continue
    if (members.has(rootId)) continue
    members.add(rootId)
    seeds.push(rootId)
  }

  const upLimit = opts.maxUpstream ?? Infinity
  const downLimit = opts.maxDownstream ?? Infinity

  if (upLimit === Infinity && downLimit === Infinity) {
    // ── Unbounded: full connected component over `blocks` (both directions).
    // This is the default and preserves the original behavior exactly: a node
    // reachable through any mix of blocker/blocked-by edges is included.
    const queue: string[] = [...seeds]
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
  } else {
    // ── Depth-limited: expand blockers and blocked-by independently, each as
    // a pure-directional BFS seeded at all roots (so depth = hops to nearest
    // root). Mixed up-then-down sibling paths are intentionally excluded —
    // "N levels of blockers / dependents" means N directional hops, not
    // arbitrary connected nodes. FIFO ordering visits each node at its
    // minimal depth first.

    // Downstream: things the roots block, transitively (forward edges).
    if (downLimit > 0) {
      const visited = new Set<string>(seeds)
      const queue: Array<[string, number]> = seeds.map((id) => [id, 0])
      while (queue.length > 0) {
        const [id, depth] = queue.shift()!
        if (depth >= downLimit) continue
        const node = byId.get(id)
        if (!node) continue
        for (const r of node.relations) {
          if (r.type !== 'blocks') continue
          if (!byId.has(r.targetIdentifier)) {
            dangling.add(r.targetIdentifier)
            continue
          }
          if (!visited.has(r.targetIdentifier)) {
            visited.add(r.targetIdentifier)
            members.add(r.targetIdentifier)
            queue.push([r.targetIdentifier, depth + 1])
          }
        }
      }
    }

    // Upstream: blockers of the roots, transitively (reverse edges). The
    // reverse map only holds cached↔cached links, so no dangling arises here.
    if (upLimit > 0) {
      const visited = new Set<string>(seeds)
      const queue: Array<[string, number]> = seeds.map((id) => [id, 0])
      while (queue.length > 0) {
        const [id, depth] = queue.shift()!
        if (depth >= upLimit) continue
        for (const upstream of reverse.get(id) ?? []) {
          if (!visited.has(upstream)) {
            visited.add(upstream)
            members.add(upstream)
            queue.push([upstream, depth + 1])
          }
        }
      }
    }
  }

  // Both opt-in expansions below run after the blocks BFS, so the dangling
  // set above only counts blocks-dangling — that's what the UI's "Load full
  // history" button uses, and we don't want related-only or hierarchy-only
  // references inflating that count.
  //
  // They share one snapshot of the blocks-only membership so each is exactly
  // 1 hop from the dependency chain, never 1 hop from the other's additions.
  const blocksMembers =
    opts.includeRelatedNeighbors || opts.includeHierarchyNeighbors ? Array.from(members) : []

  if (opts.includeRelatedNeighbors) {
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

  // 1-hop hierarchy expansion (opt-in). Non-recursive by the same reasoning
  // as `related`: we want the context of "this chain item is part of a larger
  // breakdown", not the whole tree. Siblings are therefore excluded — reaching
  // one needs a second hop (member → parent → parent's other children).
  if (opts.includeHierarchyNeighbors) {
    for (const id of blocksMembers) {
      const node = byId.get(id)
      if (!node) continue
      if (node.parent && byId.has(node.parent)) members.add(node.parent)
      for (const c of node.children) {
        if (byId.has(c)) members.add(c)
      }
    }
  }

  return { members, dangling }
}
