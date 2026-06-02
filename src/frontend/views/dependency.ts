import type { Edge, Node } from 'reactflow'
import type { ViewDefinition } from './types'
import { issueNodeHeight } from './types'
import { runDagre } from '../lib/layout'
import { applyFilters } from './filters'
import { computeChains } from './chain'
import { computeConnectivity } from './connectivity'

export const dependencyView: ViewDefinition = {
  id: 'dependency',
  label: 'Dependency',
  description: 'Issues + blocks edges. Best for "what should I work on next?".',
  build({ data, filters, staleDays, myUserName, selection, focusedId, chainRootIds, chainDepthUp, chainDepthDown, showRelated, density, search, measuredHeights }) {
    // Chain isolation: when roots are set, show their connected component over
    // `blocks` edges (both directions, transitive) — bypassing other filters
    // so an off-state blocker doesn't fragment the chain.
    let issues
    if (chainRootIds.length > 0) {
      const { members } = computeChains(data.issues, chainRootIds, {
        includeRelatedNeighbors: showRelated,
        maxUpstream: chainDepthUp,
        maxDownstream: chainDepthDown,
      })
      issues = data.issues.filter((i) => members.has(i.identifier))
    } else {
      issues = applyFilters(data.issues, filters, staleDays, myUserName, search)
    }
    const ids = new Set(issues.map((i) => i.identifier))
    const NODE_H = issueNodeHeight(density)

    // Connectivity counts (cache-wide). Reading from the full data.issues
    // set so the badge says "this is a hub" globally, even when chain mode
    // hides some of the connections from view.
    const conn = computeConnectivity(data.issues)

    // Build edges first so we can compute view-bound connectivity counts
    // (what's actually rendered) before constructing node data. Two passes
    // is cheap (O(V+E) each) and keeps node-data immutable.
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
            // Dashed gray, no arrowhead — visual signal that this is a
            // weaker, bidirectional connection vs. directed `blocks` arrows.
            // markerEnd: undefined explicitly overrides the arrowhead set in
            // GraphCanvas's defaultEdgeOptions; without this the default
            // arrow leaks through and makes related look directional.
            style: { strokeDasharray: '6 4', stroke: 'var(--fg-muted)', strokeWidth: 1.4, opacity: 0.7 },
            markerEnd: undefined,
            data: { relationType: 'related' },
          })
        }
      }
    }

    // View-bound counts: count edges actually rendered above. When chain
    // mode hides connections, this differs from `conn` (cache-wide) and
    // IssueNode tooltip surfaces both numbers so the user understands
    // why "this card has 5 blockers" but only 2 lines are drawn.
    const visibleConn = new Map<string, { out: number; in: number; related: number }>()
    for (const i of issues) visibleConn.set(i.identifier, { out: 0, in: 0, related: 0 })
    for (const e of edges) {
      const type = (e.data as { relationType?: 'blocks' | 'related' } | undefined)?.relationType
      if (type === 'blocks') {
        visibleConn.get(e.source)!.out += 1
        visibleConn.get(e.target)!.in += 1
      } else if (type === 'related') {
        visibleConn.get(e.source)!.related += 1
        visibleConn.get(e.target)!.related += 1
      }
    }

    const nodes: Node[] = issues.map((i) => ({
      id: i.identifier,
      type: 'issue',
      data: {
        issue: i,
        focused: focusedId === i.identifier,
        selected: selection.includes(i.identifier),
        // Marks the root issue(s) when chain isolation is active so IssueNode
        // can render a ring/star accent — useful when you've drilled into a
        // chain and need to see at a glance which issue(s) you started from.
        isChainRoot: chainRootIds.includes(i.identifier),
        connectivity: conn.get(i.identifier),
        visibleConnectivity: visibleConn.get(i.identifier),
      },
      position: { x: 0, y: 0 },
      width: 320,
      // Prefer real measured height if we have it (post-paint re-layout pass),
      // otherwise fall back to the density estimate. Dagre uses this directly.
      height: measuredHeights?.get(i.identifier) ?? NODE_H,
    }))

    const positioned = runDagre(nodes, edges, { direction: 'LR', nodeWidth: 320, nodeHeight: NODE_H })
    return { nodes: positioned, edges }
  },
}
