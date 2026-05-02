import type { Edge, Node } from 'reactflow'
import type { ViewDefinition } from './types'
import { issueNodeHeight } from './types'
import { applyFilters } from './filters'
import { getDesignDocsForIssue } from '../lib/labelSchema'
import { runDagre } from '../lib/layout'

export const designdocView: ViewDefinition = {
  id: 'designdoc',
  label: 'Design docs',
  description: 'Issues that have linked design-doc changes. Phase 3.',
  build({ data, filters, staleDays, myUserName, focusedId, density, search, measuredHeights }) {
    const visible = applyFilters(data.issues, filters, staleDays, myUserName, search).filter((i) => {
      const docs = getDesignDocsForIssue(i, data.designdocs)
      return docs.length > 0
    })
    const NODE_H = issueNodeHeight(density)
    const nodes: Node[] = visible.map((i) => ({
      id: i.identifier,
      type: 'issue',
      data: { issue: i, focused: focusedId === i.identifier },
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
