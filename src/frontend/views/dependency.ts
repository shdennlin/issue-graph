import type { Edge, Node } from 'reactflow'
import type { ViewDefinition } from './types'
import { runDagre } from '../lib/layout'
import { applyFilters } from './filters'

export const dependencyView: ViewDefinition = {
  id: 'dependency',
  label: 'Dependency',
  description: 'Issues + blocks edges. Best for "what should I work on next?".',
  build({ data, filters, staleDays, myUserName, focusedId }) {
    const issues = applyFilters(data.issues, filters, staleDays, myUserName)
    const ids = new Set(issues.map((i) => i.identifier))

    const nodes: Node[] = issues.map((i) => ({
      id: i.identifier,
      type: 'issue',
      data: { issue: i, focused: focusedId === i.identifier },
      position: { x: 0, y: 0 },
      width: 300,
      height: 100,
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

    const positioned = runDagre(nodes, edges, { direction: 'LR', nodeWidth: 300, nodeHeight: 100 })
    return { nodes: positioned, edges }
  },
}
