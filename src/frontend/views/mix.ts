import type { Edge, Node } from 'reactflow'
import type { ViewDefinition } from './types'
import { issueNodeHeight } from './types'
import { applyFilters } from './filters'
import { getPrimaryLabel } from '../lib/labelSchema'

const PADDING = 30
const HEADER = 32
const NODE_W = 280
const GAP_Y = 14
const GAP_X = 30
const CONTAINER_W = NODE_W + PADDING * 2

export const mixView: ViewDefinition = {
  id: 'mix',
  label: 'Mix',
  description: 'Buckets as containers + issues inside. Cross-bucket edges highlighted.',
  build({ data, schema, filters, staleDays, myUserName, focusedId, density, search }) {
    const NODE_H = issueNodeHeight(density)
    const issues = applyFilters(data.issues, filters, staleDays, myUserName, search)

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

    // Wrap buckets into a grid (auto-pick column count based on bucket count, capped
    // 1..4). Each row starts below the tallest container of the previous row, so
    // a giant bucket like central(16) doesn't push the next row down absurdly.
    const COLS = Math.max(1, Math.min(4, Math.ceil(Math.sqrt(ordered.length))))
    const ROW_GAP = 30
    const nodes: Node[] = []
    const issueToBucket = new Map<string, string>()
    let rowY = 0
    let rowMaxH = 0
    ordered.forEach(([key, b], idx) => {
      const col = idx % COLS
      if (col === 0 && idx > 0) {
        rowY += rowMaxH + ROW_GAP
        rowMaxH = 0
      }
      const containerHeight = HEADER + PADDING * 2 + b.issues.length * (NODE_H + GAP_Y)
      rowMaxH = Math.max(rowMaxH, containerHeight)
      const containerId = `bucket:${key}`
      const xOffset = col * (CONTAINER_W + GAP_X)
      nodes.push({
        id: containerId,
        type: 'mixedContainer',
        data: { bucket: { id: key, name: b.name, color: b.color, count: b.issues.length } },
        position: { x: xOffset, y: rowY },
        width: CONTAINER_W,
        height: containerHeight,
        style: { width: CONTAINER_W, height: containerHeight },
      })
      b.issues.forEach((iss, i) => {
        const id = iss.identifier
        nodes.push({
          id,
          type: 'issue',
          data: { issue: iss, focused: focusedId === id },
          parentNode: containerId,
          extent: 'parent',
          position: { x: PADDING, y: HEADER + i * (NODE_H + GAP_Y) },
          width: NODE_W,
          height: NODE_H,
        })
        issueToBucket.set(id, key)
      })
    })

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
