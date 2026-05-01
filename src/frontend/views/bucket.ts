import type { Edge, Node } from 'reactflow'
import type { ViewDefinition } from './types'
import { applyFilters } from './filters'
import { getPrimaryLabel } from '../lib/labelSchema'

export const bucketView: ViewDefinition = {
  id: 'bucket',
  label: 'Bucket',
  description: 'Issues grouped by primary label. No edges.',
  build({ data, schema, filters, staleDays, myUserName }) {
    const issues = applyFilters(data.issues, filters, staleDays, myUserName)
    const groups = new Map<string, { id: string; name: string; color: string; count: number }>()
    let unclassified = 0
    for (const i of issues) {
      const lab = getPrimaryLabel(i, schema)
      if (lab) {
        const cur = groups.get(lab.id)
        if (cur) cur.count += 1
        else groups.set(lab.id, { id: lab.id, name: lab.name, color: lab.color, count: 1 })
      } else {
        unclassified += 1
      }
    }
    if (unclassified > 0) {
      groups.set('__unclassified', {
        id: '__unclassified',
        name: 'Unclassified',
        color: '#888',
        count: unclassified,
      })
    }
    const arr = [...groups.values()].sort((a, b) => b.count - a.count)
    const cellW = 220
    const cellH = 110
    const cols = Math.min(5, Math.max(1, Math.ceil(Math.sqrt(arr.length))))
    const nodes: Node[] = arr.map((g, i) => ({
      id: `bucket:${g.id}`,
      type: 'bucket',
      data: { bucket: g },
      position: { x: (i % cols) * (cellW + 20), y: Math.floor(i / cols) * (cellH + 20) },
      width: cellW,
      height: cellH,
    }))
    const edges: Edge[] = []
    return { nodes, edges }
  },
}
