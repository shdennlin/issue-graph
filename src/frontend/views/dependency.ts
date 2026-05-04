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
  build({ data, filters, staleDays, myUserName, focusedId, chainRootId, density, search, measuredHeights }) {
    // Chain isolation: when a root is set, show its connected component over
    // `blocks` edges (both directions, transitive) — bypassing other filters
    // so an off-state blocker doesn't fragment the chain.
    let issues
    if (chainRootId) {
      const chainIds = computeChain(data.issues, chainRootId)
      issues = data.issues.filter((i) => chainIds.has(i.identifier))
    } else {
      issues = applyFilters(data.issues, filters, staleDays, myUserName, search)
    }
    const ids = new Set(issues.map((i) => i.identifier))
    const NODE_H = issueNodeHeight(density)

    const nodes: Node[] = issues.map((i) => ({
      id: i.identifier,
      type: 'issue',
      data: { issue: i, focused: focusedId === i.identifier },
      position: { x: 0, y: 0 },
      width: 320,
      // Prefer real measured height if we have it (post-paint re-layout pass),
      // otherwise fall back to the density estimate. Dagre uses this directly.
      height: measuredHeights?.get(i.identifier) ?? NODE_H,
    }))

    const edges: Edge[] = []
    for (const i of issues) {
      for (const r of i.relations) {
        if (r.type !== 'blocks') continue
        if (!ids.has(r.targetIdentifier)) continue
        edges.push({
          id: `${i.identifier}->${r.targetIdentifier}`,
          source: i.identifier,
          target: r.targetIdentifier,
          markerEnd: { type: 'arrowclosed' as any },
        })
      }
    }

    const positioned = runDagre(nodes, edges, { direction: 'LR', nodeWidth: 320, nodeHeight: NODE_H })
    return { nodes: positioned, edges }
  },
}
