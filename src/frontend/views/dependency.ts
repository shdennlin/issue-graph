import type { Edge, Node } from 'reactflow'
import type { ViewDefinition } from './types'
import { issueNodeHeight } from './types'
import { runDagre } from '../lib/layout'
import { applyFilters } from './filters'
import { computeChain } from './chain'

export const dependencyView: ViewDefinition = {
  id: 'dependency',
  label: 'Dependency',
  description: 'Issues + blocks edges. Best for "what should I work on next?".',
  build({ data, filters, staleDays, myUserName, focusedId, chainRootId, showRelated, density, search, measuredHeights }) {
    // Chain isolation: when a root is set, show its connected component over
    // `blocks` edges (both directions, transitive) — bypassing other filters
    // so an off-state blocker doesn't fragment the chain.
    let issues
    if (chainRootId) {
      const { members } = computeChain(data.issues, chainRootId, {
        includeRelatedNeighbors: showRelated,
      })
      issues = data.issues.filter((i) => members.has(i.identifier))
    } else {
      issues = applyFilters(data.issues, filters, staleDays, myUserName, search)
    }
    const ids = new Set(issues.map((i) => i.identifier))
    const NODE_H = issueNodeHeight(density)

    const nodes: Node[] = issues.map((i) => ({
      id: i.identifier,
      type: 'issue',
      data: {
        issue: i,
        focused: focusedId === i.identifier,
        // Marks the root issue when chain isolation is active so IssueNode
        // can render a ring/star accent — useful when you've drilled into a
        // chain and need to see at a glance which issue you started from.
        isChainRoot: chainRootId === i.identifier,
      },
      position: { x: 0, y: 0 },
      width: 320,
      // Prefer real measured height if we have it (post-paint re-layout pass),
      // otherwise fall back to the density estimate. Dagre uses this directly.
      height: measuredHeights?.get(i.identifier) ?? NODE_H,
    }))

    const edges: Edge[] = []
    // `related` is bidirectional in Linear — emit only one edge per
    // unordered pair to avoid drawing it twice when both endpoints declare
    // the relation. Track via a sorted-pair key.
    const seenRelated = new Set<string>()
    for (const i of issues) {
      for (const r of i.relations) {
        if (!ids.has(r.targetIdentifier)) continue
        if (r.type === 'blocks') {
          edges.push({
            id: `${i.identifier}->${r.targetIdentifier}`,
            source: i.identifier,
            target: r.targetIdentifier,
            markerEnd: { type: 'arrowclosed' as any },
            data: { relationType: 'blocks' },
          })
        } else if (r.type === 'related' && showRelated) {
          const a = i.identifier
          const b = r.targetIdentifier
          const key = a < b ? `${a}~${b}` : `${b}~${a}`
          if (seenRelated.has(key)) continue
          seenRelated.add(key)
          edges.push({
            id: `rel:${key}`,
            source: a,
            target: b,
            // Dashed gray, no arrow — visual signal that this is a weaker,
            // bidirectional connection vs. the directed `blocks` arrows.
            style: { strokeDasharray: '6 4', stroke: 'var(--fg-muted)', strokeWidth: 1.4, opacity: 0.7 },
            data: { relationType: 'related' },
          })
        }
      }
    }

    const positioned = runDagre(nodes, edges, { direction: 'LR', nodeWidth: 320, nodeHeight: NODE_H })
    return { nodes: positioned, edges }
  },
}
