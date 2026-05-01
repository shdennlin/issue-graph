import type { Edge, Node } from 'reactflow'
import type { ViewDefinition } from './types'
import { applyFilters } from './filters'
import { getPrimaryLabel } from '../lib/labelSchema'

const PADDING = 30
const HEADER = 32
const NODE_W = 280
const NODE_H = 100
const GAP_Y = 14
const GAP_X = 30
const CONTAINER_W = NODE_W + PADDING * 2

export const mixView: ViewDefinition = {
  id: 'mix',
  label: 'Mix',
  description: 'Buckets as containers + issues inside. Cross-bucket edges highlighted.',
  build({ data, schema, filters, staleDays, myUserName, focusedId }) {
    const issues = applyFilters(data.issues, filters, staleDays, myUserName)

    const buckets = new Map<string, { name: string; color: string; issues: typeof issues }>()
    for (const i of issues) {
      const lab = getPrimaryLabel(i, schema)
      const key = lab?.id ?? '__unclassified'
      const name = lab?.name ?? 'Unclassified'
      const color = lab?.color ?? '#888'
      if (!buckets.has(key)) buckets.set(key, { name, color, issues: [] })
      buckets.get(key)!.issues.push(i)
    }

    const ordered = [...buckets.entries()].sort((a, b) => b[1].issues.length - a[1].issues.length)

    const nodes: Node[] = []
    const issueToBucket = new Map<string, string>()
    let xOffset = 0
    for (const [key, b] of ordered) {
      const containerHeight = HEADER + PADDING * 2 + b.issues.length * (NODE_H + GAP_Y)
      const containerId = `bucket:${key}`
      nodes.push({
        id: containerId,
        type: 'mixedContainer',
        data: { bucket: { id: key, name: b.name, color: b.color, count: b.issues.length } },
        position: { x: xOffset, y: 0 },
        width: CONTAINER_W,
        height: containerHeight,
        style: { width: CONTAINER_W, height: containerHeight },
      })
      b.issues.forEach((iss, idx) => {
        const id = iss.identifier
        nodes.push({
          id,
          type: 'issue',
          data: { issue: iss, focused: focusedId === id },
          parentNode: containerId,
          extent: 'parent',
          position: { x: PADDING, y: HEADER + idx * (NODE_H + GAP_Y) },
          width: NODE_W,
          height: NODE_H,
        })
        issueToBucket.set(id, key)
      })
      xOffset += CONTAINER_W + GAP_X
    }

    const issueIds = new Set(issues.map((i) => i.identifier))
    const edges: Edge[] = []
    for (const i of issues) {
      for (const r of i.relations) {
        if (r.type !== 'blocks') continue
        if (!issueIds.has(r.targetIdentifier)) continue
        const cross = issueToBucket.get(i.identifier) !== issueToBucket.get(r.targetIdentifier)
        edges.push({
          id: `${i.identifier}->${r.targetIdentifier}`,
          source: i.identifier,
          target: r.targetIdentifier,
          className: cross ? 'cross-bucket-edge' : undefined,
          data: { crossBucket: cross },
        })
      }
    }

    return { nodes, edges }
  },
}
