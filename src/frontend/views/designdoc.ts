import type { Edge, Node } from 'reactflow'
import type { ViewDefinition } from './types'
import { issueNodeHeight } from './types'
import { applyFilters } from './filters'
import { computeChains } from './chain'
import { getDesignDocsForIssue } from '../lib/labelSchema'
import { runDagre } from '../lib/layout'
import { computeConnectivity } from './connectivity'
import { computeHierarchyCounts } from './hierarchy'

export const designdocView: ViewDefinition = {
  id: 'designdoc',
  label: 'Design docs',
  description: 'Issues that have linked design-doc changes. Phase 3.',
  build({ data, filters, staleDays, myUserName, selection, focusedId, chainRootIds, chainDepthUp, chainDepthDown, showRelated, density, search, measuredHeights }) {
    // Chain isolation: when roots are set, replace user filters with the
    // chain's connected component. The "must have a design doc" constraint
    // below still applies — it's part of the view's identity (a chain
    // member without docs simply isn't visible here; switch views to see
    // the whole chain).
    let baseIssues
    if (chainRootIds.length > 0) {
      const { members } = computeChains(data.issues, chainRootIds, {
        includeRelatedNeighbors: showRelated,
        maxUpstream: chainDepthUp,
        maxDownstream: chainDepthDown,
      })
      baseIssues = data.issues.filter((i) => members.has(i.identifier))
    } else {
      baseIssues = applyFilters(data.issues, filters, staleDays, myUserName, search)
    }
    const visible = baseIssues.filter((i) => {
      const docs = getDesignDocsForIssue(i, data.designdocs)
      return docs.length > 0
    })
    const NODE_H = issueNodeHeight(density)
    const conn = computeConnectivity(data.issues)
    const hier = computeHierarchyCounts(data.issues)
    const nodes: Node[] = visible.map((i) => ({
      id: i.identifier,
      type: 'issue',
      data: {
        issue: i,
        focused: focusedId === i.identifier,
        selected: selection.includes(i.identifier),
        isChainRoot: chainRootIds.includes(i.identifier),
        connectivity: conn.get(i.identifier),
        hierarchy: hier.get(i.identifier),
      },
      position: { x: 0, y: 0 },
      width: 320,
      // Use measured DOM height when available so dagre lays out around the
      // real card size (long titles + chip stacks). Falls back to density
      // estimate on first paint, before measurement.
      height: measuredHeights?.get(i.identifier) ?? NODE_H,
    }))
    const ids = new Set(visible.map((i) => i.identifier))
    const edges: Edge[] = []
    for (const i of visible) {
      for (const r of i.relations) {
        if (r.type === 'blocks' && ids.has(r.targetIdentifier)) {
          edges.push({ id: `${i.identifier}->${r.targetIdentifier}`, source: i.identifier, target: r.targetIdentifier })
        }
      }
    }
    return { nodes: runDagre(nodes, edges, { direction: 'LR', nodeWidth: 320, nodeHeight: NODE_H }), edges }
  },
}
